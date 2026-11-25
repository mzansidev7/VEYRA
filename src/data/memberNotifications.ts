import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";
import { getNotificationSettings } from "./notificationSettings";
import { supabaseClient } from "../lib/supabaseClient";

const DEVICE_TOKEN_KEY = "veyra:notification-device-token:v1:";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type MemberNotification = {
  id: string;
  title: string;
  body: string;
  from_name: string;
  link_url: string | null;
  category: "updates" | "matches" | "messages" | "activity" | "account";
  created_at: string;
  read_at: string | null;
};

export function addMemberNotificationResponseListener(
  onOpen: (linkUrl: string | null) => void,
) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    const linkUrl = data?.linkUrl;
    onOpen(isSafeHttpsUrl(linkUrl) ? new URL(linkUrl).toString() : null);
  });
}

export function addMemberNotificationDeepLinkListener(
  onOpen: (linkUrl: string | null) => void,
) {
  let active = true;
  let lastHandledUrl: string | null = null;
  let resetHandledUrlTimer: ReturnType<typeof setTimeout> | null = null;
  const handleUrl = (url: string | null) => {
    if (!active || !url || url === lastHandledUrl) return;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return;
    }
    if (
      parsedUrl.protocol !== "veyra:" ||
      parsedUrl.hostname !== "member-notification"
    ) {
      return;
    }

    lastHandledUrl = url;
    if (resetHandledUrlTimer) clearTimeout(resetHandledUrlTimer);
    resetHandledUrlTimer = setTimeout(() => {
      lastHandledUrl = null;
      resetHandledUrlTimer = null;
    }, 3000);
    const linkUrl = parsedUrl.searchParams.get("linkUrl");
    onOpen(isSafeHttpsUrl(linkUrl) ? new URL(linkUrl).toString() : null);
  };

  const subscription = Linking.addEventListener("url", ({ url }) => {
    handleUrl(url);
  });
  void Linking.getInitialURL()
    .then((url) => handleUrl(url ?? null))
    .catch((error: unknown) => {
      console.error("Could not read the initial VEYRA notification link.", error);
    });

  return {
    remove() {
      active = false;
      subscription.remove();
      if (resetHandledUrlTimer) clearTimeout(resetHandledUrlTimer);
    },
  };
}

export function addMemberNotificationReceivedListener(onReceive: () => void) {
  return Notifications.addNotificationReceivedListener(onReceive);
}

export function createMemberNotificationDeepLink(linkUrl?: string | null): string {
  const query = isSafeHttpsUrl(linkUrl)
    ? `?linkUrl=${encodeURIComponent(new URL(linkUrl).toString())}`
    : "";
  return `veyra://member-notification${query}`;
}

export async function openMemberNotificationLink(linkUrl: string): Promise<void> {
  if (!isSafeHttpsUrl(linkUrl)) {
    throw new Error("This notification link is invalid.");
  }
  await Linking.openURL(new URL(linkUrl).toString());
}

export async function registerPushNotifications(
  userId: string,
  requestPermission = true,
): Promise<"registered" | "disabled" | "unsupported" | "permission-denied"> {
  if (
    Platform.OS === "web" ||
    !Device.isDevice ||
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  ) {
    return "unsupported";
  }
  const settings = await getNotificationSettings(userId);
  if (!settings.pushEnabled) return "disabled";
  const client = getSupabaseClient();
  if (Platform.OS === "android") {
    await Promise.all(
      [
        ["veyra_matches", "Matches", "New matches and connection activity."],
        ["veyra_messages", "Messages", "New messages and voice messages."],
        ["veyra_activity", "Activity", "Likes and profile activity."],
        ["veyra_account", "Account updates", "Verification and account updates."],
        ["veyra_updates", "VEYRA updates", "Product news and announcements."],
      ].map(([id, name, description]) =>
        Notifications.setNotificationChannelAsync(id, {
          name,
          description,
          importance: Notifications.AndroidImportance.DEFAULT,
          sound: "default",
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#DDA8B8",
        }),
      ),
    );
  }
  const currentPermission = await Notifications.getPermissionsAsync();
  const permission = currentPermission.granted
    ? currentPermission
    : requestPermission
    ? await Notifications.requestPermissionsAsync()
    : currentPermission;
  if (!permission.granted) return "permission-denied";

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== "string" || !projectId) {
    throw new Error("Push notifications are not configured for this app build.");
  }
  const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenResult.data;
  const { error } = await client.from("user_notification_devices").upsert(
    {
      user_id: userId,
      expo_push_token: token,
      platform: Platform.OS,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "expo_push_token" },
  );
  if (error) {
    throw new Error(`Could not register this device for notifications: ${error.message}`);
  }
  try {
    await AsyncStorage.setItem(`${DEVICE_TOKEN_KEY}${userId}`, token);
  } catch (cacheError) {
    const { error: cleanupError } = await client
      .from("user_notification_devices")
      .delete()
      .eq("user_id", userId)
      .eq("expo_push_token", token);
    if (cleanupError) {
      throw new Error(
        `This device registered for push, but its local registration could not be saved or removed: ${cleanupError.message}`,
        { cause: cacheError },
      );
    }
    throw new Error("This device's push registration could not be saved locally.", {
      cause: cacheError,
    });
  }
  return "registered";
}

export async function removePushNotificationRegistration(
  userId: string,
): Promise<void> {
  const token = await AsyncStorage.getItem(`${DEVICE_TOKEN_KEY}${userId}`);
  if (!token) return;
  const { error } = await getSupabaseClient()
    .from("user_notification_devices")
    .delete()
    .eq("user_id", userId)
    .eq("expo_push_token", token);
  if (error) {
    throw new Error(`Could not remove this device's notification registration: ${error.message}`);
  }
  await AsyncStorage.removeItem(`${DEVICE_TOKEN_KEY}${userId}`);
}

export async function clearPushNotificationRegistrationCache(
  userId: string,
): Promise<void> {
  await AsyncStorage.removeItem(`${DEVICE_TOKEN_KEY}${userId}`);
}

export async function getMemberNotifications(): Promise<MemberNotification[]> {
  const { data, error } = await getSupabaseClient().rpc(
    "get_my_member_notifications",
    { p_limit: 50 },
  );
  if (error) throw new Error(`Could not load notifications: ${error.message}`);
  if (!Array.isArray(data)) {
    throw new Error("The notification inbox response was invalid.");
  }
  return data.map((notification, index) => {
    if (
      typeof notification !== "object" ||
      notification === null ||
      typeof notification.id !== "string" ||
      typeof notification.title !== "string" ||
      typeof notification.body !== "string" ||
      typeof notification.from_name !== "string" ||
      (notification.link_url !== null &&
        (typeof notification.link_url !== "string" ||
          !isSafeHttpsUrl(notification.link_url))) ||
      !isMemberNotificationCategory(notification.category) ||
      typeof notification.created_at !== "string" ||
      (notification.read_at !== null && typeof notification.read_at !== "string")
    ) {
      throw new Error(`Notification data is invalid at row ${index + 1}.`);
    }
    return notification as MemberNotification;
  });
}

function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.length > 0 &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function isMemberNotificationCategory(
  value: unknown,
): value is MemberNotification["category"] {
  return value === "updates" ||
    value === "matches" ||
    value === "messages" ||
    value === "activity" ||
    value === "account";
}

export async function getUnreadMemberNotificationCount(): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc(
    "get_my_unread_member_notification_count",
  );
  if (error) {
    throw new Error(`Could not load unread notification count: ${error.message}`);
  }
  if (typeof data !== "number" || !Number.isSafeInteger(data) || data < 0) {
    throw new Error("The unread notification count response was invalid.");
  }
  return data;
}

export async function markMemberNotificationRead(id: string): Promise<void> {
  const { error } = await getSupabaseClient().rpc(
    "mark_my_member_notification_read",
    { p_notification_id: id },
  );
  if (error) throw new Error(`Could not update notification status: ${error.message}`);
}

function getSupabaseClient() {
  if (!supabaseClient) {
    throw new Error("Supabase is not configured for notifications.");
  }
  return supabaseClient;
}

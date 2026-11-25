import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

type MemberNotificationPayload = {
  id: string;
  category: "updates" | "matches" | "messages" | "activity" | "account";
  title: string;
  body: string;
  linkUrl?: string | null;
};

export async function presentMemberNotification(
  notification: MemberNotificationPayload,
): Promise<void> {
  if (Platform.OS === "web") return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: notification.title,
      body: notification.body,
      sound: "default",
      data: {
        notificationId: notification.id,
        ...(isSafeHttpsUrl(notification.linkUrl)
          ? { linkUrl: new URL(notification.linkUrl).toString() }
          : {}),
      },
    },
    trigger: null,
  });
}

function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

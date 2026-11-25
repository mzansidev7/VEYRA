import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { presentMemberNotification } from "./notificationPresentation";

const BACKGROUND_NOTIFICATION_TASK = "VEYRA_MEMBER_NOTIFICATION_BACKGROUND";

type PushNotificationData = {
  id: string;
  type: "staff_announcement" | "member_event";
  category: "updates" | "matches" | "messages" | "activity" | "account";
  title: string;
  body: string;
  linkUrl?: string | null;
};

TaskManager.defineTask<Notifications.NotificationTaskPayload>(
  BACKGROUND_NOTIFICATION_TASK,
  async ({ data, error }) => {
    if (error) {
      console.error("Background notification task failed.", error);
      return Notifications.BackgroundNotificationTaskResult.Failed;
    }

    if (isNotificationResponse(data)) {
      return Notifications.BackgroundNotificationTaskResult.NoData;
    }

    try {
      const payload = decodePushNotificationData(data);
      if (!payload) {
        return Notifications.BackgroundNotificationTaskResult.NoData;
      }

      await presentMemberNotification(payload);
      return Notifications.BackgroundNotificationTaskResult.NewData;
    } catch (taskError) {
      console.error("Could not present the incoming VEYRA notification.", taskError);
      return Notifications.BackgroundNotificationTaskResult.Failed;
    }
  },
);

if (
  Platform.OS !== "web" &&
  Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
) {
  void Notifications.registerTaskAsync(BACKGROUND_NOTIFICATION_TASK).catch(
    (error: unknown) => {
      console.error("Could not register the background notification task.", error);
    },
  );
}

function isNotificationResponse(
  data: Notifications.NotificationTaskPayload,
): data is Notifications.NotificationResponse {
  return "actionIdentifier" in data;
}

function decodePushNotificationData(
  taskPayload: Exclude<
    Notifications.NotificationTaskPayload,
    Notifications.NotificationResponse
  >,
): PushNotificationData | null {
  const rawData = taskPayload.data.payload;
  if (typeof rawData !== "string") return null;

  const parsed: unknown = JSON.parse(rawData);
  if (!isRecord(parsed)) {
    throw new Error("The notification payload must be an object.");
  }
  if (
    typeof parsed.id !== "string" ||
    typeof parsed.type !== "string" ||
    typeof parsed.category !== "string" ||
    typeof parsed.title !== "string" ||
    typeof parsed.body !== "string" ||
    (parsed.linkUrl !== undefined && parsed.linkUrl !== null &&
      typeof parsed.linkUrl !== "string")
  ) {
    throw new Error("The notification payload is missing required fields.");
  }

  if (parsed.type !== "staff_announcement" && parsed.type !== "member_event") {
    return null;
  }

  const categories = [
    "updates",
    "matches",
    "messages",
    "activity",
    "account",
  ] as const;
  const category = categories.find((value) => value === parsed.category);
  if (!category) {
    throw new Error("The notification category is not supported.");
  }

  return {
    id: parsed.id,
    type: parsed.type,
    category,
    title: parsed.title.slice(0, 100),
    body: parsed.body.slice(0, 1000),
    linkUrl: parsed.linkUrl,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

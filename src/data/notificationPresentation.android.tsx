import { Column, Row, Text } from "@expo/ui/jetpack-compose";
import { paddingAll } from "@expo/ui/jetpack-compose/modifiers";
import { createCustomNotification } from "expo-widgets";
import { createMemberNotificationDeepLink } from "./memberNotifications";

type MemberNotificationPayload = {
  id: string;
  category: "updates" | "matches" | "messages" | "activity" | "account";
  title: string;
  body: string;
  linkUrl?: string | null;
};

const channelByCategory: Record<MemberNotificationPayload["category"], string> =
  {
    updates: "veyra_updates",
    matches: "veyra_matches",
    messages: "veyra_messages",
    activity: "veyra_activity",
    account: "veyra_account",
  };

const veyraNotification = createCustomNotification<MemberNotificationPayload>(
  "VeyraMemberNotification",
  (notification) => {
    "widget";

    const title = notification.title || "VEYRA";
    const body = notification.body || "Open VEYRA to view your notification.";

    return {
      collapsed: (
        <Row modifiers={[paddingAll(14)]}>
          <Column verticalArrangement={{ spacedBy: 3 }}>
            <Text
              color="#766A75"
              style={{
                fontSize: 10,
                fontWeight: "700",
                letterSpacing: 1.2,
              }}
            >
              VEYRA
            </Text>
            <Text
              color="#291D2A"
              maxLines={1}
              overflow="ellipsis"
              style={{ fontSize: 15, fontWeight: "600" }}
            >
              {title}
            </Text>
            <Text
              color="#514651"
              maxLines={1}
              overflow="ellipsis"
              style={{ fontSize: 12 }}
            >
              {body}
            </Text>
          </Column>
        </Row>
      ),
      expanded: (
        <Column
          modifiers={[paddingAll(16)]}
          verticalArrangement={{ spacedBy: 6 }}
        >
          <Text
            color="#766A75"
            style={{
              fontSize: 10,
              fontWeight: "700",
              letterSpacing: 1.2,
            }}
          >
            VEYRA
          </Text>
          <Text color="#291D2A" style={{ fontSize: 16, fontWeight: "600" }}>
            {title}
          </Text>
          <Text
            color="#514651"
            maxLines={4}
            overflow="ellipsis"
            style={{ fontSize: 14 }}
          >
            {body}
          </Text>
        </Column>
      ),
      headsUp: (
        <Row modifiers={[paddingAll(14)]}>
          <Column verticalArrangement={{ spacedBy: 3 }}>
            <Text
              color="#766A75"
              style={{
                fontSize: 10,
                fontWeight: "700",
                letterSpacing: 1.2,
              }}
            >
              VEYRA
            </Text>
            <Text
              color="#291D2A"
              maxLines={2}
              overflow="ellipsis"
              style={{ fontSize: 14, fontWeight: "600" }}
            >
              {title}
            </Text>
            <Text
              color="#514651"
              maxLines={2}
              overflow="ellipsis"
              style={{ fontSize: 12 }}
            >
              {body}
            </Text>
          </Column>
        </Row>
      ),
    };
  },
);

export async function presentMemberNotification(
  notification: MemberNotificationPayload,
): Promise<void> {
  await veyraNotification.post(notification, {
    id: notification.id,
    channelId: channelByCategory[notification.category],
    title: notification.title,
    text: notification.body,
    color: "#291D2A",
    url: createMemberNotificationDeepLink(notification.linkUrl),
  });
}

import { AppState } from "react-native";
import { useEffect, useState } from "react";
import { refreshPrivacyData } from "./privacySettings";
import { supabaseClient } from "../lib/supabaseClient";

export function startAppPresence(
  userId: string,
  onError: (error: Error) => void,
): () => void {
  const client = supabaseClient;
  if (!client) {
    onError(new Error("Online status is unavailable because Supabase is not configured."));
    return () => {};
  }

  const channel = client.channel(`user-presence:${userId}`, {
    config: { private: true, presence: { key: userId } },
  });
  let canShareOnlineStatus = false;
  let isActive = AppState.currentState === "active";
  let isSubscribed = false;
  let disposed = false;
  let privacyRevision = 0;

  const updatePresence = async () => {
    if (disposed || !isSubscribed) return;
    try {
      const result =
        isActive && canShareOnlineStatus
          ? await channel.track({ onlineAt: new Date().toISOString() })
          : await channel.untrack();
      if (result !== "ok") {
        onError(new Error("Could not update your online status."));
      }
    } catch (cause) {
      onError(
        cause instanceof Error
          ? cause
          : new Error("Could not update your online status."),
      );
    }
  };

  const refreshVisibility = async () => {
    const revision = privacyRevision;
    try {
      const { settings } = await refreshPrivacyData(userId);
      if (disposed || revision !== privacyRevision) return;
      canShareOnlineStatus = settings.showOnlineStatus;
      await updatePresence();
    } catch (cause) {
      if (!disposed) {
        onError(
          cause instanceof Error
            ? cause
            : new Error("Could not load online status privacy settings."),
        );
      }
    }
  };

  channel.on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "user_privacy_settings",
      filter: `user_id=eq.${userId}`,
    },
    (payload) => {
      privacyRevision += 1;
      if (payload.eventType === "DELETE") {
        canShareOnlineStatus = false;
        void updatePresence();
        return;
      }
      if (
        !isRecord(payload.new) ||
        typeof payload.new.show_online_status !== "boolean"
      ) {
        onError(new Error("The updated online visibility setting was invalid."));
        return;
      }
      canShareOnlineStatus = payload.new.show_online_status;
      void updatePresence();
    },
  );

  channel.subscribe((status, error) => {
    if (status === "SUBSCRIBED") {
      isSubscribed = true;
      void refreshVisibility();
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      isSubscribed = false;
      onError(
        new Error(
          error?.message ??
            "Could not connect to online status. Apply the online presence migration and verify Realtime is enabled.",
        ),
      );
    }
  });

  const appStateSubscription = AppState.addEventListener(
    "change",
    (nextState) => {
      isActive = nextState === "active";
      if (isActive) {
        void refreshVisibility();
      } else {
        void updatePresence();
      }
    },
  );

  return () => {
    disposed = true;
    appStateSubscription.remove();
    void client.removeChannel(channel);
  };
}

export function useOnlineStatuses(
  viewerId: string,
  targetUserIds: readonly string[],
): { onlineUserIds: ReadonlySet<string>; error: string } {
  const [onlineUserIds, setOnlineUserIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [error, setError] = useState("");
  const targetKey = Array.from(
    new Set(targetUserIds.filter((id) => id && id !== viewerId)),
  )
    .sort()
    .join(",");

  useEffect(() => {
    const client = supabaseClient;
    const targetIds = targetKey ? targetKey.split(",") : [];
    setOnlineUserIds(new Set());
    setError("");
    if (!client || !targetIds.length) return;

    let active = true;
    const channels = targetIds.map((targetUserId) => {
      const channel = client.channel(`user-presence:${targetUserId}`, {
        config: { private: true, presence: { key: viewerId } },
      });
      const syncPresence = () => {
        if (!active) return;
        const isOnline = Boolean(channel.presenceState()[targetUserId]?.length);
        setOnlineUserIds((current) => {
          if (current.has(targetUserId) === isOnline) return current;
          const next = new Set(current);
          if (isOnline) {
            next.add(targetUserId);
          } else {
            next.delete(targetUserId);
          }
          return next;
        });
      };

      channel.on("presence", { event: "sync" }, syncPresence);
      channel.subscribe((status, subscribeError) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          syncPresence();
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT"
        ) {
          setError(
            subscribeError?.message ??
              "Could not connect to online status. Apply the online presence migration and verify Realtime is enabled.",
          );
        }
      });
      return channel;
    });

    return () => {
      active = false;
      channels.forEach((channel) => void client.removeChannel(channel));
    };
  }, [targetKey, viewerId]);

  return { onlineUserIds, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { AppState } from "react-native";
import { useEffect, useState } from "react";
import { refreshPrivacyData } from "./privacySettings";
import { supabaseClient } from "../lib/supabaseClient";

type PresenceListener = (isOnline: boolean, error: string | null) => void;
type PresenceChannel = {
  channel: ReturnType<NonNullable<typeof supabaseClient>["channel"]>;
  listeners: Set<PresenceListener>;
  isOnline: boolean;
  error: string | null;
};

const presenceChannels = new Map<string, PresenceChannel>();

function observeUserPresence(
  client: NonNullable<typeof supabaseClient>,
  viewerId: string,
  targetUserId: string,
  listener: PresenceListener,
): () => void {
  let entry = presenceChannels.get(targetUserId);
  const isNew = !entry;
  if (!entry) {
    entry = {
      channel: client.channel(`user-presence:${targetUserId}`, {
        config: { private: true, presence: { key: viewerId } },
      }),
      listeners: new Set(),
      isOnline: false,
      error: null,
    };
    presenceChannels.set(targetUserId, entry);
  }

  entry.listeners.add(listener);
  listener(entry.isOnline, entry.error);

  if (isNew) {
    const newEntry = entry;
    const syncPresence = () => {
      newEntry.isOnline = Boolean(
        newEntry.channel.presenceState()[targetUserId]?.length,
      );
      newEntry.error = null;
      newEntry.listeners.forEach((notify) => notify(newEntry.isOnline, null));
    };

    newEntry.channel.on("presence", { event: "sync" }, syncPresence);
    newEntry.channel.subscribe((status, subscribeError) => {
      if (status === "SUBSCRIBED") {
        syncPresence();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        newEntry.isOnline = false;
        newEntry.error =
          subscribeError?.message ??
          "Could not connect to online status. Apply the online presence migration and verify Realtime is enabled.";
        newEntry.listeners.forEach((notify) =>
          notify(false, newEntry.error),
        );
      }
    });
  }

  return () => {
    const current = presenceChannels.get(targetUserId);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      presenceChannels.delete(targetUserId);
      void client.removeChannel(current.channel);
    }
  };
}

export function startAppPresence(
  userId: string,
  onError: (error: Error | null) => void,
): () => void {
  const client = supabaseClient;
  if (!client) {
    onError(
      new Error(
        "Online status is unavailable because Supabase is not configured.",
      ),
    );
    return () => {};
  }

  let channel: ReturnType<typeof client.channel> | null = null;
  let canShareOnlineStatus = false;
  let isActive = AppState.currentState === "active";
  let isSubscribed = false;
  let disposed = false;
  let privacyRevision = 0;

  const updatePresence = async () => {
    if (disposed || !isSubscribed || !channel) return;
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
    if (disposed) return;
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

  const startChannel = async () => {
    try {
      const {
        data: { session },
        error,
      } = await client.auth.getSession();
      if (error) {
        throw new Error(`Could not verify your session: ${error.message}`);
      }
      if (!session || session.user.id !== userId) {
        throw new Error("Sign in again to use online status.");
      }
      await client.realtime.setAuth(session.access_token);
      if (disposed) return;

      channel = client.channel(`user-presence:${userId}`, {
        config: { private: true, presence: { key: userId } },
      });
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
            onError(
              new Error("The updated online visibility setting was invalid."),
            );
            return;
          }
          canShareOnlineStatus = payload.new.show_online_status;
          void updatePresence();
        },
      );
      channel.subscribe((status, subscribeError) => {
        if (status === "SUBSCRIBED") {
          isSubscribed = true;
          onError(null);
          void refreshVisibility();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          isSubscribed = false;
          onError(
            new Error(
              subscribeError?.message ??
                "Could not connect to online status. Apply the online presence migration and verify Realtime is enabled.",
            ),
          );
        }
      });
    } catch (cause) {
      if (!disposed) {
        onError(
          cause instanceof Error
            ? cause
            : new Error("Could not initialize your online status."),
        );
      }
    }
  };
  void startChannel();

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
    if (channel) void client.removeChannel(channel);
  };
}

export function useOnlineStatuses(
  viewerId: string,
  targetUserIds: readonly string[],
): { onlineUserIds: ReadonlySet<string>; error: string } {
  const [onlineUserIds, setOnlineUserIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [failedUserIds, setFailedUserIds] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const targetKey = Array.from(
    new Set(targetUserIds.filter((id) => id && id !== viewerId)),
  )
    .sort()
    .join(",");

  useEffect(() => {
    const client = supabaseClient;
    const targetIds = targetKey ? targetKey.split(",") : [];
    setOnlineUserIds(new Set());
    setFailedUserIds(new Map());
    if (!client || !targetIds.length) return;

    let active = true;
    let removeListeners: (() => void)[] = [];
    const subscribe = async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await client.auth.getSession();
        if (sessionError) {
          throw new Error(
            `Could not verify your session: ${sessionError.message}`,
          );
        }
        if (!session || session.user.id !== viewerId) {
          throw new Error("Sign in again to view online status.");
        }
        await client.realtime.setAuth(session.access_token);
        if (!active) return;

        removeListeners = targetIds.map((targetUserId) =>
          observeUserPresence(
            client,
            viewerId,
            targetUserId,
            (isOnline, channelError) => {
              if (!active) return;
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
              setFailedUserIds((current) => {
                if (!channelError) {
                  if (!current.has(targetUserId)) return current;
                  const next = new Map(current);
                  next.delete(targetUserId);
                  return next;
                }
                return new Map(current).set(targetUserId, channelError);
              });
            },
          ),
        );
      } catch (cause) {
        if (!active) return;
        const errorMessage =
          cause instanceof Error
            ? cause.message
            : "Could not initialize online status.";
        setFailedUserIds(
          new Map(targetIds.map((targetId) => [targetId, errorMessage])),
        );
      }
    };
    void subscribe();

    return () => {
      active = false;
      removeListeners.forEach((removeListener) => removeListener());
    };
  }, [targetKey, viewerId]);

  const error = Array.from(failedUserIds.values())[0] ?? "";
  return { onlineUserIds, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

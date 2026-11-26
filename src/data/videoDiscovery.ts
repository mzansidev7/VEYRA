import { supabaseClient } from "../lib/supabaseClient";

export type VideoDiscoveryState =
  | "idle"
  | "searching"
  | "pending_acceptance"
  | "accepted"
  | "connected"
  | "declined"
  | "ended"
  | "cancelled"
  | "expired";

export type VideoDiscoveryParticipant = {
  userId: string;
  name: string;
  imageUrl: string | null;
  city: string | null;
  identityVerified: boolean;
};

export type VideoDiscoveryStatus = {
  state: VideoDiscoveryState;
  source: "discovery" | "match" | null;
  sessionId: string | null;
  queueId: string | null;
  expiresAt: string | null;
  myAccepted: boolean | null;
  otherAccepted: boolean | null;
  wasConnected: boolean;
  otherParticipant: VideoDiscoveryParticipant | null;
};

export type VideoCallToken = {
  sessionId: string;
  roomName: string;
  serverUrl: string;
  token: string;
  tokenExpiresInSeconds: number;
};

export type VideoDiscoveryHistoryItem = {
  sessionId: string;
  endedAt: string;
  participant: VideoDiscoveryParticipant;
};

type VideoDiscoveryOperation =
  | "availability"
  | "join"
  | "match-call"
  | "cancel"
  | "respond"
  | "status"
  | "history"
  | "call-token"
  | "call-connected"
  | "end-call"
  | "decision"
  | "report";

const SESSION_STATES = new Set<VideoDiscoveryState>([
  "pending_acceptance",
  "accepted",
  "connected",
  "declined",
  "ended",
  "cancelled",
  "expired",
]);

export async function setVideoDiscoveryAvailability(
  enabled: boolean,
): Promise<void> {
  const data = await invokeVideoDiscovery("availability", {
    enabled,
    timezone: getLocalTimezone(),
  });
  if (!isRecord(data) || data.enabled !== enabled) {
    throw new Error("The Video Discovery availability response was invalid.");
  }
}

export async function getVideoDiscoveryAvailability(): Promise<boolean> {
  const data = await invokeVideoDiscovery("availability");
  if (!isRecord(data) || typeof data.enabled !== "boolean") {
    throw new Error("The Video Discovery availability response was invalid.");
  }
  return data.enabled;
}

export async function joinVideoDiscovery(): Promise<VideoDiscoveryStatus> {
  return normalizeStatus(
    await invokeVideoDiscovery("join", { timezone: getLocalTimezone() }),
  );
}

export async function requestVideoCallWithMatch(
  matchId: string,
): Promise<VideoDiscoveryStatus> {
  return normalizeStatus(
    await invokeVideoDiscovery("match-call", { matchId }),
  );
}

export async function cancelVideoDiscoverySearch(): Promise<VideoDiscoveryStatus> {
  return normalizeStatus(await invokeVideoDiscovery("cancel"));
}

export async function respondToVideoDiscovery(
  sessionId: string,
  accept: boolean,
): Promise<VideoDiscoveryStatus> {
  return normalizeStatus(
    await invokeVideoDiscovery("respond", { sessionId, accept }),
  );
}

export async function getVideoDiscoveryStatus(
  sessionId?: string,
): Promise<VideoDiscoveryStatus> {
  return normalizeStatus(
    await invokeVideoDiscovery("status", sessionId ? { sessionId } : {}),
  );
}

export async function getVideoDiscoveryHistory(): Promise<
  VideoDiscoveryHistoryItem[]
> {
  const data = await invokeVideoDiscovery("history");
  if (!isRecord(data) || !Array.isArray(data.history)) {
    throw new Error("The Video Discovery history response was invalid.");
  }
  return data.history.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.sessionId !== "string" ||
      typeof item.endedAt !== "string"
    ) {
      throw new Error("A Video Discovery history item was invalid.");
    }
    return {
      sessionId: item.sessionId,
      endedAt: item.endedAt,
      participant: normalizeParticipant(item.participant),
    };
  });
}

export async function getVideoCallToken(
  sessionId: string,
): Promise<VideoCallToken> {
  const data = await invokeVideoDiscovery("call-token", {
    sessionId,
    timezone: getLocalTimezone(),
  });
  if (
    !isRecord(data) ||
    typeof data.sessionId !== "string" ||
    typeof data.roomName !== "string" ||
    typeof data.serverUrl !== "string" ||
    !data.serverUrl.startsWith("wss://") ||
    typeof data.token !== "string" ||
    !Number.isInteger(data.tokenExpiresInSeconds) ||
    data.tokenExpiresInSeconds !== 600
  ) {
    throw new Error("The LiveKit authorization response was invalid.");
  }
  return {
    sessionId: data.sessionId,
    roomName: data.roomName,
    serverUrl: data.serverUrl,
    token: data.token,
    tokenExpiresInSeconds: data.tokenExpiresInSeconds,
  };
}

export async function confirmVideoDiscoveryCallConnected(
  sessionId: string,
): Promise<boolean> {
  const data = await invokeVideoDiscovery("call-connected", { sessionId });
  if (
    !isRecord(data) ||
    data.sessionId !== sessionId ||
    typeof data.connected !== "boolean" ||
    (data.state !== "accepted" && data.state !== "connected")
  ) {
    throw new Error("The video connection response was invalid.");
  }
  return data.connected;
}

export async function endVideoDiscoveryCall(
  sessionId: string,
): Promise<void> {
  const data = await invokeVideoDiscovery("end-call", { sessionId });
  if (
    !isRecord(data) ||
    data.state !== "ended" ||
    data.sessionId !== sessionId
  ) {
    throw new Error("The video call could not be ended.");
  }
}

export async function submitVideoDiscoveryDecision(
  sessionId: string,
  action: "like" | "pass",
): Promise<{ matched: boolean }> {
  const data = await invokeVideoDiscovery("decision", { sessionId, action });
  if (
    !isRecord(data) ||
    data.success !== true ||
    typeof data.matched !== "boolean"
  ) {
    throw new Error("The video decision response was invalid.");
  }
  return { matched: data.matched };
}

export async function reportVideoDiscoveryUser(
  sessionId: string,
  reason: "inappropriate" | "harassment" | "spam" | "fake_profile" | "other",
): Promise<void> {
  const data = await invokeVideoDiscovery("report", { sessionId, reason });
  if (!isRecord(data) || data.success !== true) {
    throw new Error("The Video Discovery report response was invalid.");
  }
}

export function subscribeToVideoDiscoverySession(
  sessionId: string,
  onChange: (status: VideoDiscoveryState) => void,
  onError: (error: Error) => void,
): () => void {
  const client = getClient();
  const channel = client
    .channel(`video-discovery-session:${sessionId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "video_discovery_sessions",
        filter: `id=eq.${sessionId}`,
      },
      ({ new: row }) => {
        if (!isRecord(row) || !isVideoDiscoveryState(row.status)) {
          onError(new Error("The updated Video Discovery session was invalid."));
          return;
        }
        onChange(row.status);
      },
    )
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        onError(
          new Error(
            error?.message ??
              "Could not connect to Video Discovery session updates.",
          ),
        );
      }
    });

  return () => {
    void client.removeChannel(channel);
  };
}

async function invokeVideoDiscovery(
  operation: VideoDiscoveryOperation,
  values: Record<string, unknown> = {},
): Promise<unknown> {
  const { data, error } = await getClient().functions.invoke<unknown>(
    "video-discovery",
    { body: { operation, ...values } },
  );
  if (error) {
    throw new Error(
      `Video Discovery failed: ${await getFunctionErrorMessage(error)}`,
    );
  }
  return data;
}

function normalizeStatus(value: unknown): VideoDiscoveryStatus {
  if (
    !isRecord(value) ||
    !isVideoDiscoveryState(value.state) ||
    !isOptionalString(value.sessionId) ||
    !isOptionalString(value.queueId) ||
    !isOptionalString(value.expiresAt) ||
    !isOptionalBoolean(value.myAccepted) ||
    !isOptionalBoolean(value.otherAccepted) ||
    (value.source !== undefined &&
      value.source !== null &&
      value.source !== "discovery" &&
      value.source !== "match") ||
    typeof value.wasConnected !== "boolean"
  ) {
    throw new Error("The Video Discovery status response was invalid.");
  }

  return {
    state: value.state,
    source: value.source === "discovery" || value.source === "match"
      ? value.source
      : null,
    sessionId: value.sessionId,
    queueId: value.queueId,
    expiresAt: value.expiresAt,
    myAccepted: value.myAccepted,
    otherAccepted: value.otherAccepted,
    wasConnected: value.wasConnected,
    otherParticipant:
      value.otherParticipant === undefined ||
      value.otherParticipant === null
        ? null
        : normalizeParticipant(value.otherParticipant),
  };
}

function normalizeParticipant(value: unknown): VideoDiscoveryParticipant {
  if (
    !isRecord(value) ||
    typeof value.userId !== "string" ||
    typeof value.name !== "string" ||
    !isOptionalString(value.imageUrl) ||
    !isOptionalString(value.city) ||
    typeof value.identityVerified !== "boolean"
  ) {
    throw new Error("The Video Discovery participant was invalid.");
  }
  return {
    userId: value.userId,
    name: value.name,
    imageUrl: value.imageUrl,
    city: value.city,
    identityVerified: value.identityVerified,
  };
}

function getClient() {
  if (!supabaseClient) {
    throw new Error("Supabase is not configured. Video Discovery is unavailable.");
  }
  return supabaseClient;
}

async function getFunctionErrorMessage(error: {
  message: string;
  context?: unknown;
}): Promise<string> {
  if (isResponseLike(error.context)) {
    const body = await error.context.clone().text().catch(() => "");
    if (body) {
      try {
        const parsed: unknown = JSON.parse(body);
        if (isRecord(parsed) && typeof parsed.error === "string") {
          return parsed.error;
        }
      } catch {
        return `HTTP ${error.context.status}: ${body.slice(0, 500)}`;
      }
      return `HTTP ${error.context.status}: ${body.slice(0, 500)}`;
    }
    return `HTTP ${error.context.status}: ${error.message}`;
  }
  return error.message;
}

function getLocalTimezone(): string {
  try {
    return (
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Johannesburg"
    );
  } catch {
    return "Africa/Johannesburg";
  }
}

function isVideoDiscoveryState(value: unknown): value is VideoDiscoveryState {
  return (
    value === "idle" ||
    value === "searching" ||
    (typeof value === "string" &&
      SESSION_STATES.has(value as VideoDiscoveryState))
  );
}

function isOptionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isOptionalBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResponseLike(
  value: unknown,
): value is Response & { clone: () => Response; text: () => Promise<string> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof value.status === "number" &&
    "clone" in value &&
    typeof value.clone === "function" &&
    "text" in value &&
    typeof value.text === "function"
  );
}

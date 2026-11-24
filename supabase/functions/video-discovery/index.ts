import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import { AccessToken, RoomServiceClient } from "npm:livekit-server-sdk@2.20.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_TIMEZONE = "Africa/Johannesburg";
const SESSION_SELECT =
  "id,user_one_id,user_two_id,initiated_by,status,user_one_accepted,user_two_accepted,created_at,expires_at,accepted_at,connected_at,ended_at,end_reason";

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type VideoDiscoveryDatabase = {
  public: {
    Tables: {
      dating_profiles: Table<{ user_id: string; profile: Json }>;
      user_privacy_settings: Table<{
        user_id: string;
        show_age: boolean;
        show_city: boolean;
        show_verification_badge: boolean;
        discoverable: boolean;
        show_in_explore: boolean;
        timezone: string | null;
        video_discovery_enabled: boolean;
      }>;
      user_verifications: Table<{
        user_id: string;
        identity_verification_status: string | null;
      }>;
      video_discovery_queue: Table<{
        id: string;
        user_id: string;
        status: "searching" | "matched" | "cancelled" | "expired";
        session_id: string | null;
        queued_at: string;
        expires_at: string;
        updated_at: string;
      }>;
      video_discovery_sessions: Table<{
        id: string;
        user_one_id: string;
        user_two_id: string;
        initiated_by: string;
        status:
          | "pending_acceptance"
          | "accepted"
          | "declined"
          | "connected"
          | "ended"
          | "cancelled"
          | "expired";
        user_one_accepted: boolean | null;
        user_two_accepted: boolean | null;
        created_at: string;
        expires_at: string;
        accepted_at: string | null;
        connected_at: string | null;
        ended_at: string | null;
        end_reason:
          | "user_ended"
          | "cancelled"
          | "declined"
          | "expired"
          | "blocked"
          | "reported"
          | null;
      }>;
      discovery_actions: Table<{
        user_id: string;
        target_user_id: string;
        action: string;
        source: string;
      }>;
    };
    Views: { [_ in never]: never };
    Functions: {
      set_video_discovery_availability: {
        Args: { p_user_id: string; p_enabled: boolean; p_timezone: string };
        Returns: boolean;
      };
      join_video_discovery_queue: {
        Args: { p_user_id: string; p_timezone: string };
        Returns: Json;
      };
      cancel_video_discovery_search: {
        Args: { p_user_id: string };
        Returns: Json;
      };
      respond_to_video_discovery_session: {
        Args: {
          p_user_id: string;
          p_session_id: string;
          p_accept: boolean;
        };
        Returns: Json;
      };
      video_discovery_pair_is_eligible: {
        Args: {
          p_user_id: string;
          p_candidate_id: string;
          p_timezone: string;
        };
        Returns: boolean;
      };
      record_video_discovery_decision: {
        Args: {
          p_user_id: string;
          p_session_id: string;
          p_action: string;
        };
        Returns: Json;
      };
      report_video_discovery_user: {
        Args: {
          p_user_id: string;
          p_session_id: string;
          p_reason: string;
        };
        Returns: Json;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type Table<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

type VideoDiscoveryClient = SupabaseClient<VideoDiscoveryDatabase>;

type VideoSession = {
  id: string;
  user_one_id: string;
  user_two_id: string;
  initiated_by: string;
  status: string;
  user_one_accepted: boolean | null;
  user_two_accepted: boolean | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  connected_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Authentication is required." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse(
      { error: "Video Discovery is not configured." },
      500,
    );
  }

  const authClient = createClient<VideoDiscoveryDatabase>(
    supabaseUrl,
    anonKey,
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ error: "Your session is invalid or expired." }, 401);
  }

  const body = await readRequestBody(request);
  if (!body) {
    return jsonResponse({ error: "The request body must be valid JSON." }, 400);
  }

  const adminClient = createClient<VideoDiscoveryDatabase>(
    supabaseUrl,
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const timezone = getTimezone(body.timezone);

  try {
    switch (body.operation) {
      case "availability":
        return await setAvailability(adminClient, user.id, body, timezone);
      case "join":
        return await joinQueue(adminClient, user.id, timezone);
      case "cancel":
        return await cancelSearch(adminClient, user.id);
      case "respond":
        return await respondToSession(adminClient, user.id, body);
      case "status":
        return await getSessionStatus(adminClient, user.id, body.sessionId);
      case "call-token":
        return await getCallToken(adminClient, user.id, body, timezone);
      case "call-connected":
        return await markCallConnected(adminClient, user.id, body);
      case "end-call":
        return await endCall(adminClient, user.id, body);
      case "decision":
        return await saveDecision(adminClient, user.id, body);
      case "report":
        return await reportUser(adminClient, user.id, body);
      default:
        return jsonResponse(
          { error: "Unsupported Video Discovery operation." },
          400,
        );
    }
  } catch (error) {
    console.error(
      "Video Discovery operation failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return jsonResponse(
      {
        error: error instanceof Error
          ? error.message
          : "Video Discovery could not complete the request.",
      },
      500,
    );
  }
});

async function setAvailability(
  client: VideoDiscoveryClient,
  userId: string,
  body: Record<string, unknown>,
  timezone: string,
): Promise<Response> {
  if (body.enabled === undefined) {
    const { data, error } = await client
      .from("user_privacy_settings")
      .select("video_discovery_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `Could not load Video Discovery availability: ${error.message}`,
      );
    }
    return jsonResponse(
      { enabled: data?.video_discovery_enabled ?? false },
      200,
    );
  }
  if (typeof body.enabled !== "boolean") {
    return jsonResponse(
      { error: "Choose whether Video Discovery is enabled." },
      400,
    );
  }
  const { data, error } = await client.rpc(
    "set_video_discovery_availability",
    {
      p_user_id: userId,
      p_enabled: body.enabled,
      p_timezone: timezone,
    },
  );
  if (error) return jsonResponse({ error: error.message }, 409);
  if (data !== body.enabled) {
    return jsonResponse(
      { error: "The availability setting could not be confirmed." },
      500,
    );
  }
  return jsonResponse({ enabled: data }, 200);
}

async function joinQueue(
  client: VideoDiscoveryClient,
  userId: string,
  timezone: string,
): Promise<Response> {
  const { data, error } = await client.rpc("join_video_discovery_queue", {
    p_user_id: userId,
    p_timezone: timezone,
  });
  if (error) return jsonResponse({ error: error.message }, 409);
  if (!isRecord(data) || typeof data.state !== "string") {
    throw new Error("The Video Discovery queue response was invalid.");
  }

  if (data.state === "session") {
    if (!isUuid(data.session_id)) {
      throw new Error("The Video Discovery session response was invalid.");
    }
    return jsonResponse(await addOtherParticipant(client, data, userId), 200);
  }
  if (
    data.state !== "searching" ||
    !isUuid(data.queue_id) ||
    typeof data.expires_at !== "string"
  ) {
    throw new Error("The Video Discovery queue response was invalid.");
  }
  return jsonResponse({
    state: "searching",
    sessionId: null,
    queueId: data.queue_id,
    expiresAt: data.expires_at,
    myAccepted: null,
    otherAccepted: null,
    wasConnected: false,
    otherParticipant: null,
  }, 200);
}

async function cancelSearch(
  client: VideoDiscoveryClient,
  userId: string,
): Promise<Response> {
  const { data, error } = await client.rpc("cancel_video_discovery_search", {
    p_user_id: userId,
  });
  if (error) return jsonResponse({ error: error.message }, 409);
  if (!isRecord(data) || typeof data.state !== "string") {
    throw new Error("The Video Discovery cancellation response was invalid.");
  }
  if (isUuid(data.session_id)) {
    return jsonResponse(await addOtherParticipant(client, data, userId), 200);
  }
  return jsonResponse({
    state: data.state,
    sessionId: null,
    queueId: null,
    expiresAt: null,
    myAccepted: null,
    otherAccepted: null,
    wasConnected: false,
    otherParticipant: null,
  }, 200);
}

async function respondToSession(
  client: VideoDiscoveryClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  if (!isUuid(body.sessionId) || typeof body.accept !== "boolean") {
    return jsonResponse(
      { error: "The Video Discovery response is invalid." },
      400,
    );
  }

  const { data, error } = await client.rpc(
    "respond_to_video_discovery_session",
    {
      p_user_id: userId,
      p_session_id: body.sessionId,
      p_accept: body.accept,
    },
  );
  if (error) return jsonResponse({ error: error.message }, 409);
  if (!isRecord(data)) {
    throw new Error("The Video Discovery response was invalid.");
  }
  return jsonResponse(
    await addOtherParticipant(client, data, userId),
    200,
  );
}

async function getSessionStatus(
  client: VideoDiscoveryClient,
  userId: string,
  sessionId: unknown,
): Promise<Response> {
  if (sessionId !== undefined && !isUuid(sessionId)) {
    return jsonResponse(
      { error: "The Video Discovery session is invalid." },
      400,
    );
  }

  let query = client
    .from("video_discovery_sessions")
    .select(SESSION_SELECT)
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`);

  if (typeof sessionId === "string") {
    query = query.eq("id", sessionId);
  } else {
    query = query
      .in("status", ["pending_acceptance", "accepted", "connected"])
      .order("created_at", { ascending: false })
      .limit(1);
  }

  const { data: session, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`Could not load the video session: ${error.message}`);
  }
  if (session) {
    return jsonResponse(
      await addOtherParticipant(client, session, userId),
      200,
    );
  }
  if (typeof sessionId === "string") {
    return jsonResponse(
      { error: "This Video Discovery session is unavailable." },
      404,
    );
  }

  const { data: endedSession, error: endedError } = await client
    .from("video_discovery_sessions")
    .select(SESSION_SELECT)
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .eq("status", "ended")
    .not("connected_at", "is", null)
    .neq("end_reason", "reported")
    .order("ended_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (endedError) {
    throw new Error(
      `Could not load the completed video session: ${endedError.message}`,
    );
  }
  if (endedSession) {
    const otherUserId = endedSession.user_one_id === userId
      ? endedSession.user_two_id
      : endedSession.user_one_id;
    const { data: savedDecision, error: decisionError } = await client
      .from("discovery_actions")
      .select("user_id")
      .eq("user_id", userId)
      .eq("target_user_id", otherUserId)
      .eq("source", "video_discovery")
      .maybeSingle();
    if (decisionError) {
      throw new Error(
        `Could not check the video decision: ${decisionError.message}`,
      );
    }
    if (!savedDecision) {
      return jsonResponse(
        await addOtherParticipant(client, endedSession, userId),
        200,
      );
    }
  }
  return getQueueStatus(client, userId);
}

async function getQueueStatus(
  client: VideoDiscoveryClient,
  userId: string,
): Promise<Response> {
  const { data, error } = await client
    .from("video_discovery_queue")
    .select("id,status,expires_at")
    .eq("user_id", userId)
    .eq("status", "searching")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) {
    throw new Error(`Could not load the search status: ${error.message}`);
  }
  return jsonResponse(
    data
      ? {
        state: "searching",
        sessionId: null,
        queueId: data.id,
        expiresAt: data.expires_at,
        myAccepted: null,
        otherAccepted: null,
        wasConnected: false,
        otherParticipant: null,
      }
      : {
        state: "idle",
        sessionId: null,
        queueId: null,
        expiresAt: null,
        myAccepted: null,
        otherAccepted: null,
        wasConnected: false,
        otherParticipant: null,
      },
    200,
  );
}

async function getCallToken(
  client: VideoDiscoveryClient,
  userId: string,
  body: Record<string, unknown>,
  timezone: string,
): Promise<Response> {
  if (!isUuid(body.sessionId)) {
    return jsonResponse(
      { error: "The Video Discovery session is invalid." },
      400,
    );
  }

  const { data: session, error } = await client
    .from("video_discovery_sessions")
    .select(SESSION_SELECT)
    .eq("id", body.sessionId)
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not verify the video session: ${error.message}`);
  }
  if (!session) {
    return jsonResponse(
      { error: "This Video Discovery session is unavailable." },
      404,
    );
  }
  if (
    session.status !== "accepted" &&
    session.status !== "connected"
  ) {
    return jsonResponse(
      { error: "Both people must accept before the call can start." },
      409,
    );
  }
  if (
    session.user_one_accepted !== true ||
    session.user_two_accepted !== true ||
    Date.parse(session.expires_at) <= Date.now()
  ) {
    return jsonResponse(
      { error: "This accepted video invitation has expired." },
      409,
    );
  }

  const otherUserId = session.user_one_id === userId
    ? session.user_two_id
    : session.user_one_id;
  await assertPairStillEligible(client, userId, otherUserId, timezone);

  const { apiKey, apiSecret, serverUrl, roomService } =
    getLiveKitConfiguration();
  const roomName = `veyra-video-${session.id}`;
  const renewedExpiration = new Date(Date.now() + 30 * 60 * 1_000)
    .toISOString();
  const { data: activeSession, error: updateError } = await client
    .from("video_discovery_sessions")
    .update({ expires_at: renewedExpiration })
    .eq("id", session.id)
    .in("status", ["accepted", "connected"])
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (updateError) {
    throw new Error(
      `Could not extend the video session: ${updateError.message}`,
    );
  }
  if (!activeSession) {
    return jsonResponse(
      { error: "This video session is no longer active." },
      409,
    );
  }
  await ensureRoom(roomService, roomName);

  const accessToken = new AccessToken(apiKey, apiSecret, {
    identity: userId,
    ttl: "10m",
  });
  accessToken.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: false,
    canSubscribe: true,
  });
  const token = await accessToken.toJwt();

  return jsonResponse(
    {
      sessionId: session.id,
      roomName,
      serverUrl,
      token,
      tokenExpiresInSeconds: 600,
    },
    200,
  );
}

async function markCallConnected(
  client: VideoDiscoveryClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  if (!isUuid(body.sessionId)) {
    return jsonResponse(
      { error: "The Video Discovery session is invalid." },
      400,
    );
  }
  const { data: session, error } = await client
    .from("video_discovery_sessions")
    .select(SESSION_SELECT)
    .eq("id", body.sessionId)
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not verify the video session: ${error.message}`);
  }
  if (!session) {
    return jsonResponse(
      { error: "This Video Discovery session is unavailable." },
      404,
    );
  }
  if (
    (session.status !== "accepted" && session.status !== "connected") ||
    Date.parse(session.expires_at) <= Date.now()
  ) {
    return jsonResponse({ error: "This video session is not active." }, 409);
  }

  const { roomService } = getLiveKitConfiguration();
  const participants = await roomService.listParticipants(
    `veyra-video-${session.id}`,
  );
  const joinedUserIds = new Set(
    participants.map((participant) => participant.identity),
  );
  if (
    !joinedUserIds.has(session.user_one_id) ||
    !joinedUserIds.has(session.user_two_id)
  ) {
    return jsonResponse(
      { state: session.status, sessionId: session.id, connected: false },
      200,
    );
  }

  const { data: connectedSession, error: updateError } = await client
    .from("video_discovery_sessions")
    .update({
      status: "connected",
      connected_at: session.connected_at ?? new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
    })
    .eq("id", session.id)
    .gt("expires_at", new Date().toISOString())
    .in("status", ["accepted", "connected"])
    .select("id")
    .maybeSingle();
  if (updateError) {
    throw new Error(
      `Could not activate the video session: ${updateError.message}`,
    );
  }
  if (!connectedSession) {
    return jsonResponse(
      { error: "This video session is no longer active." },
      409,
    );
  }
  return jsonResponse(
    { state: "connected", sessionId: session.id, connected: true },
    200,
  );
}

async function endCall(
  client: VideoDiscoveryClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  if (!isUuid(body.sessionId)) {
    return jsonResponse(
      { error: "The Video Discovery session is invalid." },
      400,
    );
  }
  const { data: session, error } = await client
    .from("video_discovery_sessions")
    .select(SESSION_SELECT)
    .eq("id", body.sessionId)
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not verify the video session: ${error.message}`);
  }
  if (!session) {
    return jsonResponse(
      { error: "This Video Discovery session is unavailable." },
      404,
    );
  }

  if (
    session.status === "pending_acceptance" ||
    session.status === "accepted" ||
    session.status === "connected"
  ) {
    const { error: updateError } = await client
      .from("video_discovery_sessions")
      .update({
        status: "ended",
        end_reason: "user_ended",
        ended_at: new Date().toISOString(),
      })
      .eq("id", session.id)
      .in("status", ["pending_acceptance", "accepted", "connected"]);
    if (updateError) {
      throw new Error(
        `Could not end the video session: ${updateError.message}`,
      );
    }
  } else if (session.status !== "ended") {
    return jsonResponse(
      { error: "This video call is not active." },
      409,
    );
  }

  if (
    session.connected_at ||
    (session.status === "accepted" && hasLiveKitConfiguration())
  ) {
    const roomName = `veyra-video-${session.id}`;
    await deleteRoomIfPresent(getLiveKitConfiguration().roomService, roomName);
  }
  await updateQueuesAfterCallEnd(client, session, userId);
  return jsonResponse({ state: "ended", sessionId: session.id }, 200);
}

async function updateQueuesAfterCallEnd(
  client: VideoDiscoveryClient,
  session: VideoSession,
  endingUserId: string,
): Promise<void> {
  const { data: queueEntries, error: queueError } = await client
    .from("video_discovery_queue")
    .select("id,user_id")
    .eq("session_id", session.id);
  if (queueError) {
    throw new Error(`Could not update the search queue: ${queueError.message}`);
  }

  await Promise.all(
    (queueEntries ?? []).map(async (queue) => {
      const { data: privacy, error: privacyError } = await client
        .from("user_privacy_settings")
        .select("video_discovery_enabled")
        .eq("user_id", queue.user_id)
        .maybeSingle();
      if (privacyError) {
        throw new Error(
          `Could not check Video Discovery availability: ${privacyError.message}`,
        );
      }
      if (!privacy) {
        throw new Error(
          "A participant's Video Discovery settings are unavailable.",
        );
      }
      const shouldResumeSearch = queue.user_id !== endingUserId &&
        privacy.video_discovery_enabled;
      const { error: updateError } = await client
        .from("video_discovery_queue")
        .update({
          status: shouldResumeSearch ? "searching" : "cancelled",
          session_id: null,
          ...(shouldResumeSearch
            ? {
              queued_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 3 * 60 * 1_000).toISOString(),
            }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", queue.id)
        .eq("session_id", session.id);
      if (updateError) {
        throw new Error(
          `Could not update the search queue: ${updateError.message}`,
        );
      }
    }),
  );
}

async function saveDecision(
  client: VideoDiscoveryClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  if (
    !isUuid(body.sessionId) ||
    (body.action !== "like" && body.action !== "pass")
  ) {
    return jsonResponse(
      { error: "Choose Like or Pass after the video conversation." },
      400,
    );
  }
  const { data, error } = await client.rpc(
    "record_video_discovery_decision",
    {
      p_user_id: userId,
      p_session_id: body.sessionId,
      p_action: body.action,
    },
  );
  if (error) return jsonResponse({ error: error.message }, 409);
  if (
    !isRecord(data) ||
    data.success !== true ||
    typeof data.matched !== "boolean"
  ) {
    throw new Error("The video decision response was invalid.");
  }
  return jsonResponse(data, 200);
}

async function reportUser(
  client: VideoDiscoveryClient,
  userId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const allowedReasons = [
    "inappropriate",
    "harassment",
    "spam",
    "fake_profile",
    "other",
  ];
  if (
    !isUuid(body.sessionId) ||
    typeof body.reason !== "string" ||
    !allowedReasons.includes(body.reason)
  ) {
    return jsonResponse(
      { error: "Choose a valid reason for reporting this member." },
      400,
    );
  }
  const { data, error } = await client.rpc("report_video_discovery_user", {
    p_user_id: userId,
    p_session_id: body.sessionId,
    p_reason: body.reason,
  });
  if (error) return jsonResponse({ error: error.message }, 409);
  if (!isRecord(data) || data.success !== true) {
    throw new Error("The Video Discovery report response was invalid.");
  }
  if (data.room_active === true && hasLiveKitConfiguration()) {
    await deleteRoomIfPresent(
      getLiveKitConfiguration().roomService,
      `veyra-video-${body.sessionId}`,
    );
  }
  return jsonResponse({ success: true }, 200);
}

async function addOtherParticipant(
  client: VideoDiscoveryClient,
  response: Record<string, unknown>,
  userId: string,
): Promise<Record<string, unknown>> {
  const sessionId = isUuid(response.session_id)
    ? response.session_id
    : isUuid(response.id)
    ? response.id
    : null;
  if (!sessionId) return response;
  const { data: session, error } = await client
    .from("video_discovery_sessions")
    .select(SESSION_SELECT)
    .eq("id", sessionId)
    .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not load the video session: ${error.message}`);
  }
  if (!session) {
    throw new Error("This Video Discovery session is unavailable.");
  }

  const otherUserId = session.user_one_id === userId
    ? session.user_two_id
    : session.user_one_id;
  const otherAccepted = session.user_one_id === otherUserId
    ? session.user_one_accepted
    : session.user_two_accepted;
  return {
    state: session.status,
    sessionId: session.id,
    queueId: null,
    expiresAt: session.expires_at,
    myAccepted: session.user_one_id === userId
      ? session.user_one_accepted
      : session.user_two_accepted,
    otherAccepted,
    wasConnected: session.connected_at !== null &&
      session.end_reason !== "reported" &&
      session.end_reason !== "blocked",
    otherParticipant: await getOtherParticipant(client, otherUserId),
  };
}

async function getOtherParticipant(
  client: VideoDiscoveryClient,
  userId: string,
): Promise<Record<string, unknown>> {
  const [profileResult, privacyResult, verificationResult] = await Promise.all([
    client
      .from("dating_profiles")
      .select("profile")
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("user_privacy_settings")
      .select("show_age,show_city,show_verification_badge")
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("user_verifications")
      .select("identity_verification_status")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (profileResult.error) {
    throw new Error(
      `Could not load the video profile: ${profileResult.error.message}`,
    );
  }
  if (privacyResult.error) {
    throw new Error(
      `Could not load video profile privacy: ${privacyResult.error.message}`,
    );
  }
  if (verificationResult.error) {
    throw new Error(
      `Could not load video verification: ${verificationResult.error.message}`,
    );
  }
  if (!isRecord(profileResult.data?.profile)) {
    throw new Error("The other Video Discovery profile is unavailable.");
  }

  const profile = profileResult.data.profile;
  const details = isRecord(profile.profile) ? profile.profile : {};
  const privacy = privacyResult.data;
  const photos = Array.isArray(details.photos) ? details.photos : [];
  const photoPath = photos.find(
    (photo): photo is string =>
      typeof photo === "string" && photo.startsWith(`${userId}/`),
  );
  let imageUrl: string | null = null;
  if (photoPath) {
    const { data, error } = await client.storage
      .from("profile-photos")
      .createSignedUrl(photoPath, 60 * 60);
    if (error) {
      throw new Error(
        `Could not prepare the video profile photo: ${error.message}`,
      );
    }
    imageUrl = data.signedUrl;
  }

  return {
    userId,
    name: typeof details.nickname === "string" && details.nickname.trim()
      ? details.nickname.trim()
      : "VEYRA member",
    imageUrl,
    city: privacy?.show_city === false && privacy !== null
      ? null
      : typeof details.city === "string"
      ? details.city
      : null,
    identityVerified: privacy?.show_verification_badge !== false &&
      verificationResult.data?.identity_verification_status === "verified",
  };
}

async function assertPairStillEligible(
  client: VideoDiscoveryClient,
  userId: string,
  otherUserId: string,
  timezone: string,
): Promise<void> {
  const { data, error } = await client.rpc(
    "video_discovery_pair_is_eligible",
    {
      p_user_id: userId,
      p_candidate_id: otherUserId,
      p_timezone: timezone,
    },
  );
  if (error) {
    throw new Error(`Could not confirm video eligibility: ${error.message}`);
  }
  if (data !== true) {
    throw new Error("This video connection is no longer available.");
  }
}

function getLiveKitConfiguration(): {
  apiKey: string;
  apiSecret: string;
  serverUrl: string;
  roomService: RoomServiceClient;
} {
  const serverUrl = Deno.env.get("LIVEKIT_URL");
  const apiKey = Deno.env.get("LIVEKIT_API_KEY");
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!serverUrl || !apiKey || !apiSecret) {
    throw new Error(
      "Video calling is not configured. Contact VEYRA support.",
    );
  }
  const parsedUrl = new URL(serverUrl);
  if (
    parsedUrl.protocol !== "wss:" ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error("The LiveKit server URL is invalid.");
  }
  const apiHost = `https://${parsedUrl.host}`;
  return {
    apiKey,
    apiSecret,
    serverUrl,
    roomService: new RoomServiceClient(apiHost, apiKey, apiSecret),
  };
}

function hasLiveKitConfiguration(): boolean {
  return Boolean(
    Deno.env.get("LIVEKIT_URL") &&
      Deno.env.get("LIVEKIT_API_KEY") &&
      Deno.env.get("LIVEKIT_API_SECRET"),
  );
}

async function ensureRoom(
  roomService: RoomServiceClient,
  roomName: string,
): Promise<void> {
  const existingRooms = await roomService.listRooms([roomName]);
  if (existingRooms.some((room) => room.name === roomName)) return;

  try {
    await roomService.createRoom({
      name: roomName,
      maxParticipants: 2,
      emptyTimeout: 60,
      departureTimeout: 30,
    });
  } catch (createError) {
    const roomsAfterCreate = await roomService.listRooms([roomName]);
    if (roomsAfterCreate.some((room) => room.name === roomName)) return;
    throw createError;
  }
}

async function deleteRoomIfPresent(
  roomService: RoomServiceClient,
  roomName: string,
): Promise<void> {
  const rooms = await roomService.listRooms([roomName]);
  if (!rooms.some((room) => room.name === roomName)) return;
  await roomService.deleteRoom(roomName);
}

function getTimezone(value: unknown): string {
  return typeof value === "string" && value.length <= 100
    ? value
    : DEFAULT_TIMEZONE;
}

async function readRequestBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > 16_384) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 16_384) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(
        value,
      )
  );
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

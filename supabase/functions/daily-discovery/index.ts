import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const DEFAULT_TIMEZONE = "Africa/Johannesburg";
const PHOTO_URL_TTL_SECONDS = 86400;

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "GET" && request.method !== "POST") {
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
    return jsonResponse({ error: "Discovery is not configured." }, 500);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ error: "Your session is invalid or expired." }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authSessionId = getAuthSessionId(authorization);

  if (request.method === "GET") {
    const url = new URL(request.url);
    const messageId = url.searchParams.get("message_id");
    const attachmentIndexValue = url.searchParams.get("attachment_index");
    const attachmentIndex =
      attachmentIndexValue === null ? 0 : Number(attachmentIndexValue);
    if (!messageId || !isUuid(messageId)) {
      return jsonResponse({ error: "A valid message ID is required." }, 400);
    }
    if (
      !Number.isInteger(attachmentIndex) ||
      attachmentIndex < 0 ||
      attachmentIndex > 4
    ) {
      return jsonResponse(
        { error: "A valid attachment index is required." },
        400,
      );
    }
    if (!authSessionId) {
      return jsonResponse(
        { error: "Your session is invalid or expired." },
        401,
      );
    }
    return await openViewOnceMedia(
      adminClient,
      user.id,
      authSessionId,
      messageId,
      attachmentIndex,
    );
  }

  const body = await readRequestBody(request);
  if (!body) {
    return jsonResponse({ error: "The request body must be valid JSON." }, 400);
  }

  if (body.operation === "chat-lock-pin-status") {
    const { data, error } = await adminClient.rpc("has_chat_lock_pin", {
      p_user_id: user.id,
    });
    if (error) {
      return jsonResponse(
        { error: "Lock Chats settings could not be loaded." },
        500,
      );
    }
    return jsonResponse({ configured: data === true }, 200);
  }

  if (body.operation === "locked-chat-access-revoke") {
    if (!authSessionId) {
      return jsonResponse(
        { error: "Your session is invalid or expired." },
        401,
      );
    }
    const { error } = await adminClient.rpc("revoke_chat_lock_access", {
      p_user_id: user.id,
      p_auth_session_id: authSessionId,
    });
    if (error) {
      return jsonResponse(
        { error: "Locked Chats access could not be revoked." },
        500,
      );
    }
    return jsonResponse({ revoked: true }, 200);
  }

  if (body.operation === "chat-lock-pin-reset") {
    if (
      typeof body.pin !== "string" ||
      !/^[0-9]{6}$/.test(body.pin) ||
      typeof body.password !== "string" ||
      body.password.length === 0 ||
      body.password.length > 1024
    ) {
      return jsonResponse(
        { error: "Enter your account password and a valid six-digit PIN." },
        400,
      );
    }
    if (!user.email) {
      return jsonResponse(
        {
          error:
            "A verified email and password are required to reset your PIN.",
        },
        400,
      );
    }

    const reauthenticationClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: reauthenticated, error: reauthenticationError } =
      await reauthenticationClient.auth.signInWithPassword({
        email: user.email,
        password: body.password,
      });
    if (reauthenticationError || reauthenticated.user?.id !== user.id) {
      return jsonResponse(
        { error: "Your account password could not be verified." },
        401,
      );
    }
    if (!reauthenticated.session) {
      return jsonResponse(
        {
          error:
            "Additional account verification is required to reset your PIN.",
        },
        401,
      );
    }

    const { error: resetError } = await adminClient.rpc("set_chat_lock_pin", {
      p_user_id: user.id,
      p_pin: body.pin,
      p_recent_auth: true,
    });
    if (resetError) {
      return jsonResponse({ error: resetError.message }, 400);
    }
    return jsonResponse({ saved: true }, 200);
  }

  if (body.operation === "chat-lock-pin-set") {
    if (typeof body.pin !== "string" || !/^[0-9]{6}$/.test(body.pin)) {
      return jsonResponse(
        { error: "Enter a valid six-digit Lock Chats PIN." },
        400,
      );
    }
    const recentAuth = hasRecentAuthentication(authorization);
    const { error } = await adminClient.rpc("set_chat_lock_pin", {
      p_user_id: user.id,
      p_pin: body.pin,
      p_recent_auth: recentAuth,
    });
    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }
    return jsonResponse({ saved: true }, 200);
  }

  if (body.operation === "cleanup-expired-view-once") {
    const cleanupError = await cleanupExpiredViewOnceMedia(adminClient);
    if (cleanupError) {
      return jsonResponse({ error: cleanupError }, 500);
    }
    return jsonResponse({ cleaned: true }, 200);
  }

  if (body.operation === "delete-message-for-everyone") {
    const messageId = body.message_id;
    if (
      typeof messageId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        messageId,
      )
    ) {
      return jsonResponse({ error: "A valid message ID is required." }, 400);
    }

    const { data: message, error: messageLookupError } = await adminClient
      .from("messages")
      .select("conversation_id")
      .eq("id", messageId)
      .maybeSingle();
    if (messageLookupError) {
      return jsonResponse({ error: "The message could not be verified." }, 500);
    }
    if (message) {
      if (!authSessionId) {
        return jsonResponse(
          { error: "This conversation is not available." },
          403,
        );
      }
      try {
        if (
          !(await hasChatConversationAccess(
            adminClient,
            user.id,
            authSessionId,
            message.conversation_id,
          ))
        ) {
          return jsonResponse(
            { error: "This conversation is not available." },
            403,
          );
        }
      } catch {
        return jsonResponse(
          { error: "Could not verify conversation access." },
          500,
        );
      }
    }

    const { data, error } = await adminClient.rpc(
      "delete_conversation_message_for_everyone",
      { p_message_id: messageId, p_actor_id: user.id },
    );
    if (error) return jsonResponse({ error: error.message }, 400);
    if (
      !isRecord(data) ||
      data.deleted !== true ||
      typeof data.reported !== "boolean" ||
      !Array.isArray(data.media_paths) ||
      !data.media_paths.every((path) => typeof path === "string")
    ) {
      return jsonResponse(
        { error: "The message deletion response was invalid." },
        500,
      );
    }

    const mediaPaths = data.media_paths as string[];
    if (data.reported && mediaPaths.length > 0) {
      for (const sourcePath of mediaPaths) {
        const fileName = sourcePath.split("/").at(-1);
        if (!fileName || fileName.includes("..")) {
          return jsonResponse(
            {
              deleted: true,
              cleanup_pending: true,
              error: "Could not preserve reported media evidence securely.",
            },
            500,
          );
        }
        const evidencePath = `${messageId}/${fileName}`;
        const { data: media, error: downloadError } = await adminClient.storage
          .from("chat-attachments")
          .download(sourcePath);
        if (downloadError) {
          return jsonResponse(
            {
              deleted: true,
              cleanup_pending: true,
              error: `The message was deleted, but reported media evidence could not be preserved: ${downloadError.message}`,
            },
            500,
          );
        }
        const { error: copyError } = await adminClient.storage
          .from("chat-report-evidence")
          .upload(evidencePath, media, {
            upsert: true,
            contentType: media.type || undefined,
          });
        if (copyError) {
          return jsonResponse(
            {
              deleted: true,
              cleanup_pending: true,
              error: `The message was deleted, but reported media evidence could not be preserved: ${copyError.message}`,
            },
            500,
          );
        }
        const { error: evidenceRecordError } = await adminClient
          .from("conversation_message_report_evidence")
          .upsert(
            {
              message_id: messageId,
              source_path: sourcePath,
              evidence_path: evidencePath,
            },
            { onConflict: "message_id,source_path" },
          );
        if (evidenceRecordError) {
          return jsonResponse(
            {
              deleted: true,
              cleanup_pending: true,
              error: `Reported media was copied but its evidence record could not be saved: ${evidenceRecordError.message}`,
            },
            500,
          );
        }
      }
    }

    if (mediaPaths.length > 0) {
      const { error: storageError } = await adminClient.storage
        .from("chat-attachments")
        .remove(mediaPaths);
      if (storageError) {
        return jsonResponse(
          {
            deleted: true,
            cleanup_pending: true,
            error: `The message was deleted, but its media could not be removed yet: ${storageError.message}`,
          },
          500,
        );
      }

      const { error: cleanupError } = await adminClient
        .from("conversation_message_media_cleanup")
        .update({ cleaned_at: new Date().toISOString() })
        .eq("message_id", messageId)
        .in("object_path", mediaPaths);
      if (cleanupError) {
        return jsonResponse(
          {
            deleted: true,
            cleanup_pending: true,
            error: `The message was deleted and its media removed, but cleanup could not be recorded: ${cleanupError.message}`,
          },
          500,
        );
      }
    }

    const viewOnceCleanupError = await cleanupExpiredViewOnceMedia(adminClient);
    if (viewOnceCleanupError) {
      return jsonResponse(
        {
          deleted: true,
          cleanup_pending: true,
          error: viewOnceCleanupError,
        },
        500,
      );
    }

    return jsonResponse({ deleted: true, cleanup_pending: false }, 200);
  }

  if (body.operation === "chemistry-feed") {
    const timezone =
      typeof body.timezone === "string" && body.timezone.length <= 100
        ? body.timezone
        : DEFAULT_TIMEZONE;
    const { data, error } = await adminClient.rpc("get_my_chemistry_feed", {
      p_user_id: user.id,
      p_timezone: timezone,
    });
    if (error) return jsonResponse({ error: error.message }, 400);

    try {
      if (!isRecord(data) || !Array.isArray(data.connections)) {
        throw new Error("The Chemistry response was invalid.");
      }
      const connections = await Promise.all(
        data.connections.map(async (entry) => {
          if (
            !isRecord(entry) ||
            !isRecord(entry.other_profile) ||
            !Array.isArray(entry.sessions)
          ) {
            throw new Error("A Chemistry connection was invalid.");
          }
          const [person] = await signCards(adminClient, [entry.other_profile]);
          const sessions = await Promise.all(
            entry.sessions.map(async (session) => {
              if (
                !isRecord(session) ||
                (session.status !== "active" &&
                  session.status !== "completed") ||
                typeof session.activity_key !== "string"
              ) {
                throw new Error("A Chemistry session was invalid.");
              }
              if (session.status === "completed") {
                return { ...session, questions: [] };
              }
              if (!Number.isInteger(session.current_question_position)) {
                throw new Error(
                  "An active Chemistry session position was invalid.",
                );
              }
              const currentPosition =
                session.current_question_position as number;
              const groupStart =
                currentPosition <= 3 ? 1 : currentPosition <= 6 ? 4 : 7;
              const groupEnd = Math.min(
                groupStart + (groupStart === 7 ? 3 : 2),
                10,
              );
              const [questionResult, responseResult] = await Promise.all([
                adminClient
                  .from("chemistry_questions")
                  .select("id,position,prompt,choices")
                  .eq("activity_key", session.activity_key)
                  .gte("position", groupStart)
                  .lte("position", groupEnd)
                  .order("position"),
                adminClient
                  .from("chemistry_responses")
                  .select("question_id,user_id")
                  .eq("session_id", session.id),
              ]);
              if (questionResult.error) {
                throw new Error(
                  `Could not load Chemistry questions: ${questionResult.error.message}`,
                );
              }
              if (responseResult.error) {
                throw new Error(
                  `Could not load Chemistry answer status: ${responseResult.error.message}`,
                );
              }
              const questions = questionResult.data ?? [];
              if (questions.length !== groupEnd - groupStart + 1) {
                throw new Error(
                  `The current Chemistry group should have ${groupEnd - groupStart + 1} questions.`,
                );
              }
              const responses = responseResult.data ?? [];
              const {
                question: _question,
                my_answer: _myAnswer,
                match_answer: _matchAnswer,
                ...sessionData
              } = session;
              return {
                ...sessionData,
                results: [],
                questions: questions.map((question: any) => ({
                  ...question,
                  my_answer_submitted: responses.some(
                    (response: any) =>
                      response.question_id === question.id &&
                      response.user_id === user.id,
                  ),
                  match_answer_submitted: responses.some(
                    (response: any) =>
                      response.question_id === question.id &&
                      response.user_id !== user.id,
                  ),
                })),
              };
            }),
          );
          return { ...entry, other_profile: person, sessions };
        }),
      );
      return jsonResponse({ ...data, connections }, 200);
    } catch (error) {
      return jsonResponse(
        {
          error:
            error instanceof Error
              ? `Could not prepare Chemistry profiles: ${error.message}`
              : "Could not prepare Chemistry profiles.",
        },
        500,
      );
    }
  }

  if (body.operation === "chat-feed" || body.operation === "locked-chat-feed") {
    const lockedOnly = body.operation === "locked-chat-feed";
    if (lockedOnly) {
      if (!authSessionId) {
        return jsonResponse(
          { error: "Your session is invalid or expired." },
          401,
        );
      }
      if (typeof body.pin !== "string" || !/^[0-9]{6}$/.test(body.pin)) {
        return jsonResponse(
          { error: "Enter a valid six-digit Lock Chats PIN." },
          400,
        );
      }
      const { data: pinMatches, error: pinError } = await adminClient.rpc(
        "verify_chat_lock_pin",
        { p_user_id: user.id, p_pin: body.pin },
      );
      if (pinError) {
        return jsonResponse({ error: pinError.message }, 429);
      }
      if (pinMatches !== true) {
        return jsonResponse({ error: "The Lock Chats PIN is incorrect." }, 401);
      }
    }

    const cleanupWarning = await cleanupExpiredViewOnceMedia(adminClient);
    const timezone =
      typeof body.timezone === "string" && body.timezone.length <= 100
        ? body.timezone
        : DEFAULT_TIMEZONE;
    const { data, error } = await adminClient.rpc("get_my_conversations", {
      p_user_id: user.id,
      p_timezone: timezone,
    });
    if (error) return jsonResponse({ error: error.message }, 400);

    try {
      if (
        !isRecord(data) ||
        !Array.isArray(data.conversations) ||
        !Array.isArray(data.new_matches)
      ) {
        throw new Error("The conversations response was invalid.");
      }
      const { data: lockedRows, error: lockedRowsError } = await adminClient
        .from("conversation_participants")
        .select("conversation_id,locked_at")
        .eq("user_id", user.id)
        .not("locked_at", "is", null);
      if (lockedRowsError) {
        throw new Error(
          `Could not prepare locked conversation visibility: ${lockedRowsError.message}`,
        );
      }
      const lockedAtByConversationId = new Map(
        (lockedRows ?? []).map((row: any) => [
          row.conversation_id,
          row.locked_at,
        ]),
      );
      const lockedConversationIds = new Set(lockedAtByConversationId.keys());
      const visibleConversationCards = data.conversations
        .filter(
          (conversation) =>
            isRecord(conversation) &&
            lockedConversationIds.has(
              conversation.conversation_id as string,
            ) === lockedOnly,
        )
        .map((conversation) =>
          lockedOnly && isRecord(conversation)
            ? {
                ...conversation,
                locked_at:
                  lockedAtByConversationId.get(
                    conversation.conversation_id as string,
                  ) ?? null,
              }
            : conversation,
        );
      const visibleNewMatchCards = data.new_matches.filter(
        (match) =>
          isRecord(match) &&
          !lockedConversationIds.has(match.conversation_id as string),
      );
      const lastMessageIds = visibleConversationCards.flatMap((conversation) =>
        isRecord(conversation) &&
        isRecord(conversation.last_message) &&
        typeof conversation.last_message.id === "string"
          ? [conversation.last_message.id]
          : [],
      );
      if (lastMessageIds.length > 0) {
        const { data: deletionStates, error: deletionStateError } =
          await adminClient
            .from("messages")
            .select("id, deleted_for_everyone_at")
            .in("id", lastMessageIds);
        if (deletionStateError) {
          throw new Error(
            `Could not prepare deleted message previews: ${deletionStateError.message}`,
          );
        }
        const deletedMessageIds = new Set(
          (deletionStates ?? [])
            .filter((message: any) => message.deleted_for_everyone_at !== null)
            .map((message: any) => message.id),
        );
        for (const conversation of visibleConversationCards) {
          if (
            !isRecord(conversation) ||
            !isRecord(conversation.last_message) ||
            !deletedMessageIds.has(conversation.last_message.id as string)
          ) {
            continue;
          }
          conversation.last_message = {
            ...conversation.last_message,
            body: "You deleted this message.",
            deleted_for_everyone: true,
          };
        }
      }
      const [conversations, newMatches] = await Promise.all([
        signConversationProfiles(adminClient, visibleConversationCards),
        signConversationProfiles(adminClient, visibleNewMatchCards),
      ]);
      if (lockedOnly) {
        const { error: accessGrantError } = await adminClient.rpc(
          "grant_chat_lock_access",
          { p_user_id: user.id, p_auth_session_id: authSessionId },
        );
        if (accessGrantError) {
          throw new Error(
            `Could not authorize this session to open Locked Chats: ${accessGrantError.message}`,
          );
        }
      }
      return jsonResponse(
        {
          conversations,
          new_matches: newMatches,
          cleanup_warning: cleanupWarning,
        },
        200,
      );
    } catch (error) {
      return jsonResponse(
        {
          error:
            error instanceof Error
              ? `Could not prepare conversation profiles: ${error.message}`
              : "Could not prepare conversation profiles.",
        },
        500,
      );
    }
  }

  if (body.operation === "likes-feed") {
    const timezone =
      typeof body.timezone === "string" && body.timezone.length <= 100
        ? body.timezone
        : DEFAULT_TIMEZONE;
    const { data, error } = await adminClient.rpc("get_likes_feed", {
      p_user_id: user.id,
      p_timezone: timezone,
    });
    if (error) return jsonResponse({ error: error.message }, 400);

    try {
      if (!isRecord(data)) throw new Error("The Likes response was invalid.");
      const [incoming, sent, matches] = await Promise.all([
        signCards(adminClient, data.incoming, true),
        signCards(adminClient, data.sent),
        signCards(adminClient, data.matches),
      ]);
      return jsonResponse({ incoming, sent, matches }, 200);
    } catch (error) {
      return jsonResponse(
        {
          error:
            error instanceof Error
              ? `Could not prepare Likes profiles: ${error.message}`
              : "Could not prepare Likes profiles.",
        },
        500,
      );
    }
  }

  if (body.operation === "profile-visitors-feed") {
    const timezone =
      typeof body.timezone === "string" && body.timezone.length <= 100
        ? body.timezone
        : DEFAULT_TIMEZONE;
    const { data, error } = await adminClient.rpc("get_profile_visitors", {
      p_user_id: user.id,
      p_timezone: timezone,
    });
    if (error) return jsonResponse({ error: error.message }, 400);

    try {
      const visitors = await signCards(adminClient, data);
      return jsonResponse({ visitors }, 200);
    } catch (error) {
      return jsonResponse(
        {
          error:
            error instanceof Error
              ? `Could not prepare profile visitors: ${error.message}`
              : "Could not prepare profile visitors.",
        },
        500,
      );
    }
  }

  if (body.operation === "record-profile-view") {
    if (typeof body.targetUserId !== "string" || !isUuid(body.targetUserId)) {
      return jsonResponse({ error: "The profile view is invalid." }, 400);
    }
    const { data, error } = await adminClient.rpc("record_profile_view", {
      p_viewer_id: user.id,
      p_viewed_user_id: body.targetUserId,
    });
    if (error) return jsonResponse({ error: error.message }, 409);
    if (typeof data !== "boolean") {
      return jsonResponse(
        { error: "The profile view response was invalid." },
        500,
      );
    }
    return jsonResponse({ success: true, recorded: data }, 200);
  }

  if (body.operation === "profile-visitor-decision") {
    if (
      typeof body.visitorId !== "string" ||
      !isUuid(body.visitorId) ||
      (body.action !== "like" && body.action !== "pass")
    ) {
      return jsonResponse({ error: "The visitor response is invalid." }, 400);
    }
    const { data, error } = await adminClient.rpc(
      "respond_to_profile_visitor",
      {
        p_user_id: user.id,
        p_visitor_id: body.visitorId,
        p_action: body.action,
      },
    );
    if (error) return jsonResponse({ error: error.message }, 409);
    return jsonResponse(data, 200);
  }

  if (body.operation === "received-like-decision") {
    if (
      typeof body.senderId !== "string" ||
      !isUuid(body.senderId) ||
      (body.action !== "like" && body.action !== "pass")
    ) {
      return jsonResponse(
        { error: "The incoming-like response is invalid." },
        400,
      );
    }
    const { data, error } = await adminClient.rpc("respond_to_received_like", {
      p_user_id: user.id,
      p_sender_id: body.senderId,
      p_action: body.action,
    });
    if (error) return jsonResponse({ error: error.message }, 409);
    return jsonResponse(data, 200);
  }

  if (body.operation === "feed") {
    const timezone =
      typeof body.timezone === "string" && body.timezone.length <= 100
        ? body.timezone
        : DEFAULT_TIMEZONE;
    const { data, error } = await adminClient.rpc("get_daily_five_feed", {
      p_user_id: user.id,
      p_timezone: timezone,
    });
    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }

    try {
      const feed = await signFeedPhotos(adminClient, data, user.id);
      return jsonResponse(feed, 200);
    } catch (error) {
      return jsonResponse(
        {
          error:
            error instanceof Error
              ? `Could not prepare Discovery photos: ${error.message}`
              : "Could not prepare Discovery photos.",
        },
        500,
      );
    }
  }

  if (body.operation === "explore-feed") {
    const radiusKm = body.radiusKm;
    const intention =
      typeof body.intention === "string" && body.intention.length <= 100
        ? body.intention
        : null;
    if (
      typeof radiusKm !== "number" ||
      !Number.isInteger(radiusKm) ||
      radiusKm < 5 ||
      radiusKm > 200
    ) {
      return jsonResponse(
        { error: "Explore radius must be between 5 and 200 km." },
        400,
      );
    }

    const { data, error } = await adminClient.rpc(
      "get_explore_feed_with_fallback",
      {
        p_user_id: user.id,
        p_timezone:
          typeof body.timezone === "string" && body.timezone.length <= 100
            ? body.timezone
            : DEFAULT_TIMEZONE,
        p_radius_km: radiusKm,
        p_intention: intention,
      },
    );
    if (error) return jsonResponse({ error: error.message }, 400);

    try {
      if (!isRecord(data) || !Array.isArray(data.profiles)) {
        throw new Error("The Explore response was invalid.");
      }
      const profiles = await signCards(adminClient, data.profiles, true);
      return jsonResponse({ ...data, profiles }, 200);
    } catch (error) {
      return jsonResponse(
        {
          error:
            error instanceof Error
              ? `Could not prepare Explore profiles: ${error.message}`
              : "Could not prepare Explore profiles.",
        },
        500,
      );
    }
  }

  if (body.operation === "explore-decide") {
    if (
      typeof body.targetUserId !== "string" ||
      !isUuid(body.targetUserId) ||
      !isDiscoveryAction(body.action) ||
      typeof body.radiusKm !== "number" ||
      !Number.isInteger(body.radiusKm) ||
      body.radiusKm < 5 ||
      body.radiusKm > 200
    ) {
      return jsonResponse({ error: "The Explore action is invalid." }, 400);
    }
    const intention =
      typeof body.intention === "string" && body.intention.length <= 100
        ? body.intention
        : null;
    const { data, error } = await adminClient.rpc("record_explore_action", {
      p_user_id: user.id,
      p_target_user_id: body.targetUserId,
      p_action: body.action,
      p_timezone:
        typeof body.timezone === "string" && body.timezone.length <= 100
          ? body.timezone
          : DEFAULT_TIMEZONE,
      p_radius_km: body.radiusKm,
      p_intention: intention,
    });
    if (error) return jsonResponse({ error: error.message }, 409);
    return jsonResponse(data, 200);
  }

  if (body.operation === "decide") {
    if (
      typeof body.recommendationId !== "string" ||
      !isUuid(body.recommendationId) ||
      !isDiscoveryAction(body.action)
    ) {
      return jsonResponse({ error: "The Discovery action is invalid." }, 400);
    }
    const { data, error } = await adminClient.rpc("record_daily_five_action", {
      p_user_id: user.id,
      p_recommendation_id: body.recommendationId,
      p_action: body.action,
    });
    if (error) {
      return jsonResponse({ error: error.message }, 409);
    }
    return jsonResponse(data, 200);
  }

  return jsonResponse({ error: "Unsupported Discovery operation." }, 400);
});

async function openViewOnceMedia(
  client: ReturnType<typeof createClient>,
  userId: string,
  authSessionId: string,
  messageId: string,
  attachmentIndex: number,
): Promise<Response> {
  const { data: message, error: messageLookupError } = await client
    .from("messages")
    .select("conversation_id")
    .eq("id", messageId)
    .maybeSingle();
  if (messageLookupError) {
    return jsonResponse({ error: "This attachment is not available." }, 500);
  }
  if (!message) {
    return jsonResponse({ error: "This attachment is not available." }, 403);
  }
  let canAccess: boolean;
  try {
    canAccess = await hasChatConversationAccess(
      client,
      userId,
      authSessionId,
      message.conversation_id,
    );
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not verify conversation access.",
      },
      500,
    );
  }
  if (!canAccess) {
    return jsonResponse({ error: "This attachment is not available." }, 403);
  }

  const { data, error } = await client.rpc("claim_view_once_message", {
    p_message_id: messageId,
    p_actor_id: userId,
    p_attachment_index: attachmentIndex,
  });
  if (error) return jsonResponse({ error: error.message }, 403);
  if (
    !isRecord(data) ||
    typeof data.object_path !== "string" ||
    (data.media_kind !== "image" &&
      data.media_kind !== "video" &&
      data.media_kind !== "audio")
  ) {
    return jsonResponse(
      { error: "The protected attachment was invalid." },
      500,
    );
  }

  const { data: media, error: downloadError } = await client.storage
    .from("chat-view-once")
    .download(data.object_path);
  if (downloadError) {
    return jsonResponse(
      {
        error:
          "This attachment was consumed when opening began, but its media could not be loaded.",
      },
      502,
    );
  }

  return new Response(media, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": "inline",
      "Content-Type": media.type || getViewOnceMimeType(data.media_kind),
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function hasChatConversationAccess(
  client: ReturnType<typeof createClient>,
  userId: string,
  authSessionId: string,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await client.rpc("can_access_chat_conversation", {
    p_user_id: userId,
    p_auth_session_id: authSessionId,
    p_conversation_id: conversationId,
  });
  if (error) {
    throw new Error(`Could not verify conversation access: ${error.message}`);
  }
  return data === true;
}

async function cleanupExpiredViewOnceMedia(
  client: ReturnType<typeof createClient>,
): Promise<string | null> {
  const { data, error } = await client.rpc("claim_expired_view_once_media", {
    p_limit: 100,
  });
  if (error) {
    return `Could not prepare expired View Once cleanup: ${error.message}`;
  }
  if (
    !Array.isArray(data) ||
    !data.every(
      (row) =>
        isRecord(row) &&
        typeof row.message_id === "string" &&
        typeof row.object_path === "string",
    )
  ) {
    return "The expired View Once cleanup response was invalid.";
  }

  for (const row of data) {
    const messageId = row.message_id as string;
    const objectPath = row.object_path as string;
    const { error: removeError } = await client.storage
      .from("chat-view-once")
      .remove([objectPath]);
    if (removeError) {
      const { error: retryError } = await client
        .from("conversation_view_once_media")
        .update({ cleanup_started_at: null })
        .eq("message_id", messageId)
        .eq("object_path", objectPath);
      if (retryError) {
        return `Could not remove expired View Once media (${removeError.message}) or queue its retry (${retryError.message}).`;
      }
      return `Could not remove expired View Once media: ${removeError.message}`;
    }

    const { error: updateError } = await client
      .from("conversation_view_once_media")
      .update({ cleaned_at: new Date().toISOString() })
      .eq("message_id", messageId)
      .eq("object_path", objectPath);
    if (updateError) {
      return `Expired View Once media was removed, but cleanup could not be recorded: ${updateError.message}`;
    }
  }
  return null;
}

function getViewOnceMimeType(kind: "image" | "video" | "audio"): string {
  if (kind === "image") return "image/jpeg";
  if (kind === "video") return "video/mp4";
  return "audio/mp4";
}

async function signFeedPhotos(
  client: ReturnType<typeof createClient>,
  value: unknown,
  viewerId: string,
): Promise<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error("The Daily 5 response was invalid.");
  }

  const recommendationsWithDistances = await addApproximateDistances(
    client,
    viewerId,
    value.recommendations,
  );
  const recommendations = await signCards(
    client,
    recommendationsWithDistances,
    true,
  );
  const likes = await signCards(client, value.likes);
  return {
    recommendations,
    likes,
    selected_count: value.selected_count,
    explored_count: value.explored_count,
    expires_at: value.expires_at,
  };
}

async function addApproximateDistances(
  client: ReturnType<typeof createClient>,
  viewerId: string,
  value: unknown,
): Promise<unknown[]> {
  if (!Array.isArray(value)) {
    throw new Error("The Daily 5 recommendations were invalid.");
  }
  if (value.length === 0) return value;
  const recommendations = value.filter(
    (entry): entry is Record<string, unknown> & { candidate_id: string } =>
      isRecord(entry) && typeof entry.candidate_id === "string",
  );
  if (recommendations.length !== value.length) {
    throw new Error("A Daily 5 recommendation was invalid.");
  }

  const candidateIds = recommendations.map((entry) => entry.candidate_id);
  const { data, error } = await client.rpc(
    "get_daily_five_approximate_distances",
    { p_viewer_id: viewerId, p_candidate_ids: candidateIds },
  );
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) {
    throw new Error("The Daily 5 distance response was invalid.");
  }
  const distanceRows = data.filter(
    (
      row,
    ): row is Record<string, unknown> & {
      candidate_id: string;
      distance_km: number;
    } =>
      isRecord(row) &&
      typeof row.candidate_id === "string" &&
      typeof row.distance_km === "number" &&
      Number.isInteger(row.distance_km) &&
      row.distance_km >= 0,
  );
  if (distanceRows.length !== data.length) {
    throw new Error("The Daily 5 distance response was invalid.");
  }
  const distances = new Map(
    distanceRows.map((row) => [row.candidate_id, row.distance_km]),
  );

  return recommendations.map((entry) => {
    const distanceKm = distances.get(entry.candidate_id);
    return distanceKm === undefined
      ? entry
      : { ...entry, distance_km: distanceKm };
  });
}

async function signCards(
  client: ReturnType<typeof createClient>,
  value: unknown,
  includeGender = false,
): Promise<Record<string, unknown>[]> {
  if (!Array.isArray(value)) {
    throw new Error("The profile list in the Daily 5 response was invalid.");
  }

  const entries = value.map((entry) => {
    if (!isRecord(entry) || typeof entry.candidate_id !== "string") {
      throw new Error("A Discovery profile was invalid.");
    }
    return { card: entry, candidateId: entry.candidate_id };
  });
  const genders = new Map<string, string>();
  if (includeGender && entries.length) {
    const candidateIds = [
      ...new Set(entries.map((entry) => entry.candidateId)),
    ];
    const { data: datingProfiles, error: profileError } = await client
      .from("dating_profiles")
      .select("user_id,profile")
      .in("user_id", candidateIds);
    if (profileError) {
      throw new Error(`Could not load profile gender: ${profileError.message}`);
    }
    for (const profile of datingProfiles ?? []) {
      if (typeof profile.user_id !== "string" || !isRecord(profile.profile)) {
        continue;
      }
      const profileDetails = isRecord(profile.profile.profile)
        ? profile.profile.profile
        : profile.profile;
      const gender =
        typeof profileDetails.gender === "string"
          ? profileDetails.gender.trim().toLowerCase()
          : "";
      if (gender === "man" || gender === "woman") {
        genders.set(profile.user_id, gender === "man" ? "Man" : "Woman");
      }
    }
  }

  return Promise.all(
    entries.map(async ({ card: entry, candidateId }) => {
      const {
        photo_path: photoPath,
        photo_paths: photoPaths,
        ...safeCard
      } = entry;
      const gender = genders.get(candidateId);
      const profileCard = {
        ...safeCard,
        gender:
          includeGender && (gender === "Man" || gender === "Woman")
            ? gender
            : null,
      };
      if (photoPaths !== undefined) {
        if (
          !Array.isArray(photoPaths) ||
          !photoPaths.every(
            (path) =>
              typeof path === "string" &&
              path.startsWith(`${entry.candidate_id}/`),
          )
        ) {
          throw new Error("A profile photo reference was invalid.");
        }
        const photos = await Promise.all(
          photoPaths.map(async (path) => {
            const { data, error } = await client.storage
              .from("profile-photos")
              .createSignedUrl(path, PHOTO_URL_TTL_SECONDS);
            if (error) throw new Error(error.message);
            return data.signedUrl;
          }),
        );
        return { ...profileCard, image: photos[0] ?? null, photos };
      }
      if (photoPath === null || photoPath === undefined) {
        return { ...profileCard, image: null };
      }
      if (
        typeof photoPath !== "string" ||
        !photoPath.startsWith(`${entry.candidate_id}/`)
      ) {
        throw new Error("A profile photo reference was invalid.");
      }

      const { data, error } = await client.storage
        .from("profile-photos")
        .createSignedUrl(photoPath, PHOTO_URL_TTL_SECONDS);
      if (error) {
        throw new Error(error.message);
      }
      return { ...profileCard, image: data.signedUrl };
    }),
  );
}

async function signConversationProfiles(
  client: ReturnType<typeof createClient>,
  value: unknown[],
): Promise<Record<string, unknown>[]> {
  return Promise.all(
    value.map(async (entry) => {
      if (!isRecord(entry) || !isRecord(entry.other_profile)) {
        throw new Error("A conversation profile was invalid.");
      }
      const [profile] = await signCards(client, [entry.other_profile]);
      return { ...entry, other_profile: profile };
    }),
  );
}

async function readRequestBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function hasRecentAuthentication(authorization: string): boolean {
  const token = authorization.slice("Bearer ".length);
  const payload = token.split(".")[1];
  if (!payload) return false;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const claims: unknown = JSON.parse(decoded);
    if (!isRecord(claims) || typeof claims.auth_time !== "number") return false;
    const ageSeconds = Date.now() / 1000 - claims.auth_time;
    return ageSeconds >= 0 && ageSeconds <= 5 * 60;
  } catch {
    return false;
  }
}

function getAuthSessionId(authorization: string): string | null {
  const token = authorization.slice("Bearer ".length);
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const claims: unknown = JSON.parse(decoded);
    return isRecord(claims) &&
      typeof claims.session_id === "string" &&
      isUuid(claims.session_id)
      ? claims.session_id
      : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDiscoveryAction(
  value: unknown,
): value is "like" | "superlike" | "pass" {
  return value === "like" || value === "superlike" || value === "pass";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

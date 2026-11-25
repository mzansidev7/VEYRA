import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_TIMEZONE = "Africa/Johannesburg";
const PHOTO_URL_TTL_SECONDS = 86400;

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

  const body = await readRequestBody(request);
  if (!body) {
    return jsonResponse({ error: "The request body must be valid JSON." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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
              const currentPosition = session.current_question_position as number;
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
                questions: questions.map((question) => ({
                  ...question,
                  my_answer_submitted: responses.some(
                    (response) =>
                      response.question_id === question.id &&
                      response.user_id === user.id,
                  ),
                  match_answer_submitted: responses.some(
                    (response) =>
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

  if (body.operation === "chat-feed") {
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
      const [conversations, newMatches] = await Promise.all([
        signConversationProfiles(adminClient, data.conversations),
        signConversationProfiles(adminClient, data.new_matches),
      ]);
      return jsonResponse(
        { conversations, new_matches: newMatches },
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
        signCards(adminClient, data.incoming),
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
    if (
      typeof body.targetUserId !== "string" ||
      !isUuid(body.targetUserId)
    ) {
      return jsonResponse({ error: "The profile view is invalid." }, 400);
    }
    const { data, error } = await adminClient.rpc("record_profile_view", {
      p_viewer_id: user.id,
      p_viewed_user_id: body.targetUserId,
    });
    if (error) return jsonResponse({ error: error.message }, 409);
    if (typeof data !== "boolean") {
      return jsonResponse({ error: "The profile view response was invalid." }, 500);
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
    const { data, error } = await adminClient.rpc(
      "respond_to_received_like",
      {
        p_user_id: user.id,
        p_sender_id: body.senderId,
        p_action: body.action,
      },
    );
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
      const profiles = await signCards(adminClient, data.profiles);
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
    const { data, error } = await adminClient.rpc(
      "record_daily_five_action",
      {
        p_user_id: user.id,
        p_recommendation_id: body.recommendationId,
        p_action: body.action,
      },
    );
    if (error) {
      return jsonResponse({ error: error.message }, 409);
    }
    return jsonResponse(data, 200);
  }

  return jsonResponse({ error: "Unsupported Discovery operation." }, 400);
});

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
    (
      entry,
    ): entry is Record<string, unknown> & { candidate_id: string } =>
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
): Promise<Record<string, unknown>[]> {
  if (!Array.isArray(value)) {
    throw new Error("The profile list in the Daily 5 response was invalid.");
  }

  return Promise.all(
    value.map(async (entry) => {
      if (!isRecord(entry) || typeof entry.candidate_id !== "string") {
        throw new Error("A Discovery profile was invalid.");
      }

      const {
        photo_path: photoPath,
        photo_paths: photoPaths,
        ...safeCard
      } = entry;
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
        return { ...safeCard, image: photos[0] ?? null, photos };
      }
      if (photoPath === null || photoPath === undefined) {
        return { ...safeCard, image: null };
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
      return { ...safeCard, image: data.signedUrl };
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

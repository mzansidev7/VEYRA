import { supabaseClient } from "../lib/supabaseClient";

export type DiscoveryAction = "like" | "superlike" | "pass";

export type CompatibilityBreakdown = {
  version: number;
  relationshipIntentions: number | null;
  coreValues: number | null;
  lifestyle: number | null;
  datingDNA: number | null;
  sharedInterests: number | null;
  communication: number | null;
};

export type DiscoveryPerson = {
  id: string;
  recommendationId?: string;
  name: string;
  age: number | null;
  city: string | null;
  occupation: string;
  bio: string;
  interests: string[];
  intentions: string[];
  image: string | null;
  photos?: string[];
  identityVerified: boolean;
  compatibilityScore: number | null;
  compatibilityConfidence: number | null;
  compatibilityBreakdown: CompatibilityBreakdown | null;
  compatibilityUnavailable: boolean;
  distanceKm: number | null;
  outOfRadius: boolean;
  action?: "like" | "superlike";
};

export type LikeStatus = "pending" | "matched";

export type LikeRecord = {
  id: string;
  person: DiscoveryPerson;
  createdAt: string;
  status: LikeStatus;
};

export type MatchRecord = {
  id: string;
  person: DiscoveryPerson;
  createdAt: string;
};

export type LikesFeed = {
  incoming: LikeRecord[];
  sent: LikeRecord[];
  matches: MatchRecord[];
};

export type DailyFiveFeed = {
  recommendations: DiscoveryPerson[];
  likes: DiscoveryPerson[];
  selectedCount: number;
  exploredCount: number;
  expiresAt: string;
};

export type ExploreFeed = {
  profiles: DiscoveryPerson[];
  remainingDecisions: number;
  dailyLimit: number;
  outOfRadius: boolean;
  resetAt: string;
};

export async function getLikesFeed(): Promise<LikesFeed> {
  const { data, error } = await getSupabaseClient().functions.invoke<unknown>(
    "daily-discovery",
    {
      body: {
        operation: "likes-feed",
        timezone: getLocalTimezone(),
      },
    },
  );
  if (error) {
    throw new Error(
      `Could not load Likes: ${await getFunctionErrorMessage(error)}`,
    );
  }
  return normalizeLikesFeed(data);
}

export async function respondToReceivedLike(
  senderId: string,
  action: "like" | "pass",
): Promise<{ matched: boolean }> {
  const { data, error } = await getSupabaseClient().functions.invoke<unknown>(
    "daily-discovery",
    {
      body: {
        operation: "received-like-decision",
        senderId,
        action,
      },
    },
  );
  if (error) {
    throw new Error(
      `Could not save your response: ${await getFunctionErrorMessage(error)}`,
    );
  }
  if (
    !isRecord(data) ||
    data.success !== true ||
    typeof data.matched !== "boolean"
  ) {
    throw new Error("The incoming-like response was invalid.");
  }
  return { matched: data.matched };
}

export async function getDailyFiveFeed(): Promise<DailyFiveFeed> {
  const client = getSupabaseClient();
  const { data, error } = await client.functions.invoke<unknown>(
    "daily-discovery",
    {
      body: {
        operation: "feed",
        timezone: getLocalTimezone(),
      },
    },
  );
  if (error) {
    throw new Error(
      `Could not load Daily 5: ${await getFunctionErrorMessage(error)}`,
    );
  }
  return normalizeDailyFiveFeed(data);
}

export async function saveDailyFiveDecision(
  recommendationId: string,
  action: DiscoveryAction,
): Promise<void> {
  const { error } = await getSupabaseClient().functions.invoke(
    "daily-discovery",
    {
      body: {
        operation: "decide",
        recommendationId,
        action,
      },
    },
  );
  if (error) {
    throw new Error(
      `Could not save your decision: ${await getFunctionErrorMessage(error)}`,
    );
  }
}

export async function getExploreFeed(
  radiusKm: number,
  intention: string | null,
): Promise<ExploreFeed> {
  const { data, error } = await getSupabaseClient()
    .functions.invoke<unknown>("daily-discovery", {
      body: {
        operation: "explore-feed",
        timezone: getLocalTimezone(),
        radiusKm,
        intention,
      },
    });
  if (error) {
    throw new Error(
      `Could not load Explore: ${await getFunctionErrorMessage(error)}`,
    );
  }
  if (
    !isRecord(data) ||
    !Number.isInteger(data.remaining_decisions) ||
    typeof data.remaining_decisions !== "number" ||
    data.remaining_decisions < 0 ||
    data.remaining_decisions > 20 ||
    data.daily_limit !== 20 ||
    typeof data.out_of_radius !== "boolean" ||
    typeof data.reset_at !== "string" ||
    Number.isNaN(Date.parse(data.reset_at))
  ) {
    throw new Error("The Explore feed response was invalid.");
  }
  return {
    profiles: normalizePeople(data.profiles, false, data.out_of_radius),
    remainingDecisions: data.remaining_decisions,
    dailyLimit: data.daily_limit,
    outOfRadius: data.out_of_radius,
    resetAt: data.reset_at,
  };
}

export async function saveExploreDecision(
  targetUserId: string,
  action: DiscoveryAction,
  radiusKm: number,
  intention: string | null,
): Promise<number> {
  const { data, error } = await getSupabaseClient().functions.invoke<unknown>(
    "daily-discovery",
    {
      body: {
        operation: "explore-decide",
        targetUserId,
        action,
        timezone: getLocalTimezone(),
        radiusKm,
        intention,
      },
    },
  );
  if (error) {
    throw new Error(
      `Could not save your Explore decision: ${await getFunctionErrorMessage(error)}`,
    );
  }
  if (
    !isRecord(data) ||
    !Number.isInteger(data.remaining_decisions) ||
    typeof data.remaining_decisions !== "number" ||
    data.remaining_decisions < 0 ||
    data.remaining_decisions > 20
  ) {
    throw new Error("The Explore decision response was invalid.");
  }
  return data.remaining_decisions;
}

function normalizeDailyFiveFeed(value: unknown): DailyFiveFeed {
  if (!isRecord(value)) {
    throw new Error("The Daily 5 response was invalid.");
  }
  const recommendations = normalizePeople(value.recommendations, true);
  const likes = normalizePeople(value.likes, false);
  const selectedCount = requireCount(value.selected_count);
  const exploredCount = requireCount(value.explored_count);
  if (
    typeof value.expires_at !== "string" ||
    Number.isNaN(Date.parse(value.expires_at))
  ) {
    throw new Error("The Daily 5 renewal time was invalid.");
  }
  return {
    recommendations,
    likes,
    selectedCount,
    exploredCount,
    expiresAt: value.expires_at,
  };
}

function normalizeLikesFeed(value: unknown): LikesFeed {
  if (
    !isRecord(value) ||
    !Array.isArray(value.incoming) ||
    !Array.isArray(value.sent) ||
    !Array.isArray(value.matches)
  ) {
    throw new Error("The Likes response was invalid.");
  }
  return {
    incoming: value.incoming.map((entry) => normalizeLikeRecord(entry)),
    sent: value.sent.map((entry) => normalizeLikeRecord(entry)),
    matches: value.matches.map((entry) => normalizeMatchRecord(entry)),
  };
}

function normalizeLikeRecord(value: unknown): LikeRecord {
  if (
    !isRecord(value) ||
    typeof value.like_id !== "string" ||
    (value.status !== "pending" && value.status !== "matched") ||
    typeof value.created_at !== "string" ||
    Number.isNaN(Date.parse(value.created_at))
  ) {
    throw new Error("A like in the Likes response was invalid.");
  }
  return {
    id: value.like_id,
    person: normalizePeople([value], false)[0],
    createdAt: value.created_at,
    status: value.status,
  };
}

function normalizeMatchRecord(value: unknown): MatchRecord {
  if (
    !isRecord(value) ||
    typeof value.match_id !== "string" ||
    value.status !== "active" ||
    typeof value.created_at !== "string" ||
    Number.isNaN(Date.parse(value.created_at))
  ) {
    throw new Error("A match in the Likes response was invalid.");
  }
  return {
    id: value.match_id,
    person: normalizePeople([value], false)[0],
    createdAt: value.created_at,
  };
}

function normalizePeople(
  value: unknown,
  requireRecommendationId: boolean,
  outOfRadius = false,
): DiscoveryPerson[] {
  if (!Array.isArray(value)) {
    throw new Error("The profile list in the Daily 5 response was invalid.");
  }
  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.candidate_id !== "string" ||
      typeof entry.nickname !== "string" ||
      (entry.age !== null && typeof entry.age !== "number") ||
      (entry.city !== null && typeof entry.city !== "string") ||
      typeof entry.bio !== "string" ||
      typeof entry.occupation !== "string" ||
      !isStringArray(entry.interests) ||
      !isStringArray(entry.intentions) ||
      (entry.image !== null && typeof entry.image !== "string") ||
      (entry.photos !== undefined && !isStringArray(entry.photos)) ||
      typeof entry.identity_verified !== "boolean" ||
      !isOptionalScore(entry.compatibility_score) ||
      !isOptionalScore(entry.compatibility_confidence)
    ) {
      throw new Error("A profile in the Daily 5 response was invalid.");
    }
    if (
      entry.distance_km !== undefined &&
      entry.distance_km !== null &&
      (typeof entry.distance_km !== "number" ||
        !Number.isInteger(entry.distance_km) ||
        entry.distance_km < 0)
    ) {
      throw new Error(
        "A profile distance in the Discovery response was invalid.",
      );
    }
    const compatibilityBreakdown = normalizeCompatibilityBreakdown(
      entry.compatibility_breakdown,
    );
    const photos = isStringArray(entry.photos) ? entry.photos : undefined;
    const compatibilityAvailable =
      entry.compatibility_score !== null &&
      entry.compatibility_confidence !== null &&
      compatibilityBreakdown !== null;

    if (
      requireRecommendationId &&
      typeof entry.recommendation_id !== "string"
    ) {
      throw new Error("A Daily 5 recommendation ID was missing.");
    }
    if (
      entry.action !== undefined &&
      entry.action !== "like" &&
      entry.action !== "superlike"
    ) {
      throw new Error("A saved Discovery action was invalid.");
    }

    return {
      id: entry.candidate_id,
      recommendationId:
        typeof entry.recommendation_id === "string"
          ? entry.recommendation_id
          : undefined,
      name: entry.nickname,
      age: entry.age,
      city: entry.city,
      occupation: entry.occupation,
      bio: entry.bio,
      interests: entry.interests,
      intentions: entry.intentions,
      image: entry.image,
      photos,
      identityVerified: entry.identity_verified,
      compatibilityScore: compatibilityAvailable
        ? entry.compatibility_score
        : null,
      compatibilityConfidence: compatibilityAvailable
        ? entry.compatibility_confidence
        : null,
      compatibilityBreakdown: compatibilityAvailable
        ? compatibilityBreakdown
        : null,
      compatibilityUnavailable:
        entry.compatibility_score !== null && !compatibilityAvailable,
      distanceKm:
        typeof entry.distance_km === "number" ? entry.distance_km : null,
      outOfRadius,
      action: entry.action,
    };
  });
}

function normalizeCompatibilityBreakdown(
  value: unknown,
): CompatibilityBreakdown | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    typeof value.version !== "number" ||
    !Number.isInteger(value.version) ||
    value.version < 1 ||
    !isOptionalScore(value.relationship_intentions) ||
    !isOptionalScore(value.core_values) ||
    !isOptionalScore(value.lifestyle) ||
    !isOptionalScore(value.dating_dna) ||
    !isOptionalScore(value.shared_interests) ||
    !isOptionalScore(value.communication)
  ) {
    return null;
  }
  return {
    version: value.version,
    relationshipIntentions: value.relationship_intentions,
    coreValues: value.core_values,
    lifestyle: value.lifestyle,
    datingDNA: value.dating_dna,
    sharedInterests: value.shared_interests,
    communication: value.communication,
  };
}

function requireCount(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 5
  ) {
    throw new Error("The Daily 5 count was invalid.");
  }
  return value;
}

function isOptionalScore(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 100)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
        if (isRecord(parsed) && typeof parsed.message === "string") {
          return `HTTP ${error.context.status}: ${parsed.message}`;
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

function getLocalTimezone(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timezone || "Africa/Johannesburg";
  } catch {
    return "Africa/Johannesburg";
  }
}

function getSupabaseClient() {
  if (!supabaseClient) {
    throw new Error("Supabase is not configured. Discovery is unavailable.");
  }
  return supabaseClient;
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  DiscoveryPerson,
  LikesFeed,
  LikeRecord,
  MatchRecord,
  ProfileVisitorRecord,
} from "../data/dailyDiscovery";

const LIKES_CACHE_KEY_PREFIX = "veyra:likes-feed:v1:";
const VISITORS_CACHE_KEY_PREFIX = "veyra:profile-visitors:v1:";

export async function getCachedLikesFeed(
  userId: string,
): Promise<LikesFeed | null> {
  const cached = await readCache(
    `${LIKES_CACHE_KEY_PREFIX}${encodeURIComponent(userId)}`,
  );
  if (cached === null) return null;
  if (!isLikesFeed(cached)) {
    throw new Error("Saved Likes cache is invalid.");
  }
  return cached;
}

export async function saveLikesFeedCache(
  userId: string,
  feed: LikesFeed,
): Promise<void> {
  await AsyncStorage.setItem(
    `${LIKES_CACHE_KEY_PREFIX}${encodeURIComponent(userId)}`,
    JSON.stringify(feed),
  );
}

export async function getCachedProfileVisitors(
  userId: string,
): Promise<ProfileVisitorRecord[] | null> {
  const cached = await readCache(
    `${VISITORS_CACHE_KEY_PREFIX}${encodeURIComponent(userId)}`,
  );
  if (cached === null) return null;
  if (!Array.isArray(cached) || !cached.every(isProfileVisitor)) {
    throw new Error("Saved profile visitors cache is invalid.");
  }
  return cached;
}

export async function saveProfileVisitorsCache(
  userId: string,
  visitors: ProfileVisitorRecord[],
): Promise<void> {
  await AsyncStorage.setItem(
    `${VISITORS_CACHE_KEY_PREFIX}${encodeURIComponent(userId)}`,
    JSON.stringify(visitors),
  );
}

export async function removeLikesTabCache(userId: string): Promise<void> {
  const encodedUserId = encodeURIComponent(userId);
  await AsyncStorage.multiRemove([
    `${LIKES_CACHE_KEY_PREFIX}${encodedUserId}`,
    `${VISITORS_CACHE_KEY_PREFIX}${encodedUserId}`,
  ]);
}

async function readCache(key: string): Promise<unknown | null> {
  const stored = await AsyncStorage.getItem(key);
  if (stored === null) return null;
  try {
    return JSON.parse(stored) as unknown;
  } catch (cause) {
    throw new Error("Saved Likes data could not be read.", { cause });
  }
}

function isLikesFeed(value: unknown): value is LikesFeed {
  return (
    isRecord(value) &&
    Array.isArray(value.incoming) &&
    value.incoming.every(isLikeRecord) &&
    Array.isArray(value.sent) &&
    value.sent.every(isLikeRecord) &&
    Array.isArray(value.matches) &&
    value.matches.every(isMatchRecord)
  );
}

function isLikeRecord(value: unknown): value is LikeRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    (value.status === "pending" || value.status === "matched") &&
    isDiscoveryPerson(value.person)
  );
}

function isMatchRecord(value: unknown): value is MatchRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.lastActivityAt === "string" &&
    isDiscoveryPerson(value.person)
  );
}

function isProfileVisitor(value: unknown): value is ProfileVisitorRecord {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.firstViewedAt === "string" &&
    typeof value.viewedAt === "string" &&
    typeof value.hasActiveMatch === "boolean" &&
    isDiscoveryPerson(value.person)
  );
}

function isDiscoveryPerson(value: unknown): value is DiscoveryPerson {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.accountCreatedAt === undefined ||
      typeof value.accountCreatedAt === "string") &&
    (value.recommendationId === undefined ||
      typeof value.recommendationId === "string") &&
    typeof value.name === "string" &&
    (value.gender === undefined ||
      value.gender === null ||
      typeof value.gender === "string") &&
    isNullableNumber(value.age) &&
    isNullableString(value.city) &&
    typeof value.occupation === "string" &&
    typeof value.bio === "string" &&
    isStringArray(value.interests) &&
    isStringArray(value.intentions) &&
    isNullableString(value.image) &&
    (value.photos === undefined || isStringArray(value.photos)) &&
    typeof value.identityVerified === "boolean" &&
    isNullableNumber(value.compatibilityScore) &&
    isNullableNumber(value.compatibilityConfidence) &&
    isCompatibilityBreakdown(value.compatibilityBreakdown) &&
    typeof value.compatibilityUnavailable === "boolean" &&
    isNullableNumber(value.distanceKm) &&
    typeof value.outOfRadius === "boolean" &&
    (value.action === undefined ||
      value.action === "like" ||
      value.action === "superlike")
  );
}

function isCompatibilityBreakdown(value: unknown): boolean {
  if (value === null) return true;
  return (
    isRecord(value) &&
    typeof value.version === "number" &&
    isNullableNumber(value.relationshipIntentions) &&
    isNullableNumber(value.coreValues) &&
    isNullableNumber(value.lifestyle) &&
    isNullableNumber(value.datingDNA) &&
    isNullableNumber(value.sharedInterests) &&
    isNullableNumber(value.communication)
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

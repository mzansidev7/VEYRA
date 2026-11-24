import AsyncStorage from "@react-native-async-storage/async-storage";

export type VerificationStatus =
  | "not_started"
  | "pending"
  | "verified"
  | "rejected"
  | "review_required";

export type VerificationData = {
  emailVerified: boolean;
  photoVerificationStatus: VerificationStatus;
  identityVerificationStatus: VerificationStatus;
  photoVerifiedAt: string | null;
  identityVerifiedAt: string | null;
};

export type CachedVerificationData = {
  data: VerificationData;
  isFresh: boolean;
};

export const DEFAULT_VERIFICATION_DATA: VerificationData = {
  emailVerified: false,
  photoVerificationStatus: "not_started",
  identityVerificationStatus: "not_started",
  photoVerifiedAt: null,
  identityVerifiedAt: null,
};

const CACHE_KEY_PREFIX = "veyra:verification:v2:";
const CACHE_MAX_AGE_MS = 5 * 60 * 1000;
const VERIFICATION_STATUSES: VerificationStatus[] = [
  "not_started",
  "pending",
  "verified",
  "rejected",
  "review_required",
];

export async function getCachedVerificationData(
  userId: string,
): Promise<CachedVerificationData | null> {
  const cached = await readCache(userId);
  if (!cached) return null;
  return {
    data: cached.data,
    isFresh: Date.now() - cached.cachedAt < CACHE_MAX_AGE_MS,
  };
}

export async function saveVerificationDataCache(
  userId: string,
  data: VerificationData,
): Promise<void> {
  await AsyncStorage.setItem(
    getCacheKey(userId),
    JSON.stringify({ data, cachedAt: Date.now() }),
  );
}

export async function removeVerificationDataCache(
  userId: string,
): Promise<void> {
  await AsyncStorage.removeItem(getCacheKey(userId));
}

async function readCache(
  userId: string,
): Promise<{ data: VerificationData; cachedAt: number } | null> {
  const stored = await AsyncStorage.getItem(getCacheKey(userId));
  if (stored === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (cause) {
    throw new Error("Saved verification cache could not be read.", { cause });
  }
  if (!isVerificationCache(parsed)) {
    throw new Error("Saved verification cache is invalid.");
  }
  return { data: parsed.data, cachedAt: parsed.cachedAt };
}

function getCacheKey(userId: string): string {
  return `${CACHE_KEY_PREFIX}${encodeURIComponent(userId)}`;
}

function isVerificationCache(
  value: unknown,
): value is { data: VerificationData; cachedAt: number } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    data?: Partial<VerificationData>;
    cachedAt?: unknown;
  };
  const data = candidate.data;
  return (
    typeof candidate.cachedAt === "number" &&
    typeof data === "object" &&
    data !== null &&
    typeof data.emailVerified === "boolean" &&
    VERIFICATION_STATUSES.includes(data.photoVerificationStatus as VerificationStatus) &&
    VERIFICATION_STATUSES.includes(
      data.identityVerificationStatus as VerificationStatus,
    ) &&
    (typeof data.photoVerifiedAt === "string" ||
      data.photoVerifiedAt === null) &&
    (typeof data.identityVerifiedAt === "string" ||
      data.identityVerifiedAt === null)
  );
}

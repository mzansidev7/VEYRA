import AsyncStorage from "@react-native-async-storage/async-storage";

export type PrivacySettings = {
  discoverable: boolean;
  showInDailyFive: boolean;
  showInExplore: boolean;
  showDistance: boolean;
  showOnlineStatus: boolean;
  showLastActive: boolean;
  showAge: boolean;
  showCity: boolean;
  showVoiceIntro: boolean;
  showCompatibilityScore: boolean;
  showVerificationBadge: boolean;
  incognitoMode: boolean;
  profileVisitorHistoryEnabled: boolean;
  readReceipts: boolean;
  allowProfileSharing: boolean;
  messagesFromMatchesOnly: boolean;
  allowVoiceMessages: boolean;
};

export type PrivacyListEntry = {
  userId: string;
  createdAt: string;
};

export type PrivacyData = {
  settings: PrivacySettings;
  blockedUsers: PrivacyListEntry[];
  hiddenProfiles: PrivacyListEntry[];
};

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  discoverable: true,
  showInDailyFive: true,
  showInExplore: true,
  showDistance: true,
  showOnlineStatus: false,
  showLastActive: false,
  showAge: true,
  showCity: true,
  showVoiceIntro: true,
  showCompatibilityScore: true,
  showVerificationBadge: true,
  incognitoMode: false,
  profileVisitorHistoryEnabled: true,
  readReceipts: true,
  allowProfileSharing: true,
  messagesFromMatchesOnly: true,
  allowVoiceMessages: true,
};

const PRIVACY_CACHE_KEY_PREFIX = "veyra:privacy-visibility:v1:";
const PRIVACY_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

export type CachedPrivacyData = {
  data: PrivacyData;
  isFresh: boolean;
};

export async function getPrivacySettingsCache(
  userId: string,
): Promise<CachedPrivacyData | null> {
  const cached = await readCache(userId);
  if (!cached) return null;
  return {
    data: cached.data,
    isFresh: Date.now() - cached.cachedAt < PRIVACY_CACHE_MAX_AGE_MS,
  };
}

export async function savePrivacySettingsCache(
  userId: string,
  data: PrivacyData,
): Promise<void> {
  await writeCache(userId, data);
}

export async function updatePrivacySettingsCache(
  userId: string,
  update: (data: PrivacyData) => PrivacyData,
): Promise<void> {
  const cached = await readCache(userId);
  if (!cached) return;
  await writeCache(userId, update(cached.data), cached.cachedAt);
}

export async function removePrivacySettingsCache(
  userId: string,
): Promise<void> {
  await AsyncStorage.removeItem(getCacheKey(userId));
}

async function readCache(
  userId: string,
): Promise<{ data: PrivacyData; cachedAt: number } | null> {
  const stored = await AsyncStorage.getItem(getCacheKey(userId));
  if (stored === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (cause) {
    throw new Error("Saved privacy settings cache could not be read.", {
      cause,
    });
  }
  if (!isPrivacyCache(parsed)) {
    throw new Error("Saved privacy settings cache is invalid.");
  }
  return {
    data: {
      ...parsed.data,
      settings: {
        ...DEFAULT_PRIVACY_SETTINGS,
        ...parsed.data.settings,
      },
    },
    cachedAt: parsed.cachedAt,
  };
}

async function writeCache(
  userId: string,
  data: PrivacyData,
  cachedAt = Date.now(),
): Promise<void> {
  await AsyncStorage.setItem(
    getCacheKey(userId),
    JSON.stringify({ data, cachedAt }),
  );
}

function getCacheKey(userId: string): string {
  return `${PRIVACY_CACHE_KEY_PREFIX}${encodeURIComponent(userId)}`;
}

function isPrivacyCache(
  value: unknown,
): value is { data: PrivacyData; cachedAt: number } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    data?: Partial<PrivacyData>;
    cachedAt?: unknown;
  };
  const settings = candidate.data?.settings;
  const isValidSettings =
    typeof settings === "object" &&
    settings !== null &&
    (Object.keys(DEFAULT_PRIVACY_SETTINGS) as (keyof PrivacySettings)[]).every(
      (key) =>
        key === "showInExplore"
          ? settings[key] === undefined || typeof settings[key] === "boolean"
          : typeof settings[key] === "boolean",
    );
  const isValidList = (entries: unknown): entries is PrivacyListEntry[] =>
    Array.isArray(entries) &&
    entries.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.userId === "string" &&
        typeof entry.createdAt === "string",
    );

  return (
    typeof candidate.cachedAt === "number" &&
    typeof candidate.data === "object" &&
    candidate.data !== null &&
    isValidSettings &&
    isValidList(candidate.data.blockedUsers) &&
    isValidList(candidate.data.hiddenProfiles)
  );
}
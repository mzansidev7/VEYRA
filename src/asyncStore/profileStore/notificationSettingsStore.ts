import AsyncStorage from "@react-native-async-storage/async-storage";

export type NotificationSettings = {
  pushEnabled: boolean;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  newLikes: boolean;
  newMatches: boolean;
  dailyFive: boolean;
  profileActivity: boolean;
  newMessages: boolean;
  voiceMessages: boolean;
  dateInvitations: boolean;
  datingReminders: boolean;
  upcomingDates: boolean;
  verificationUpdates: boolean;
  securityAlerts: true;
  productUpdates: boolean;
  promotions: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  showNotificationPreview: boolean;
};

export type NotificationBooleanSetting = Exclude<
  keyof NotificationSettings,
  "quietHoursStart" | "quietHoursEnd" | "securityAlerts"
>;

export type CachedNotificationSettings = {
  settings: NotificationSettings;
  isFresh: boolean;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  pushEnabled: true,
  emailEnabled: true,
  inAppEnabled: true,
  newLikes: true,
  newMatches: true,
  dailyFive: true,
  profileActivity: false,
  newMessages: true,
  voiceMessages: true,
  dateInvitations: true,
  datingReminders: false,
  upcomingDates: true,
  verificationUpdates: true,
  securityAlerts: true,
  productUpdates: true,
  promotions: true,
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  showNotificationPreview: true,
};

const CACHE_KEY_PREFIX = "veyra:notification-settings:v2:";
const CACHE_MAX_AGE_MS = 5 * 60 * 1000;

export async function getCachedNotificationSettings(
  userId: string,
): Promise<CachedNotificationSettings | null> {
  const cached = await readCache(userId);
  if (!cached) return null;
  return {
    settings: cached.settings,
    isFresh: Date.now() - cached.cachedAt < CACHE_MAX_AGE_MS,
  };
}

export async function saveNotificationSettingsCache(
  userId: string,
  settings: NotificationSettings,
): Promise<void> {
  await AsyncStorage.setItem(
    getCacheKey(userId),
    JSON.stringify({ settings, cachedAt: Date.now() }),
  );
}

export async function removeNotificationSettingsCache(
  userId: string,
): Promise<void> {
  await AsyncStorage.removeItem(getCacheKey(userId));
}

async function readCache(
  userId: string,
): Promise<{ settings: NotificationSettings; cachedAt: number } | null> {
  const stored = await AsyncStorage.getItem(getCacheKey(userId));
  if (stored === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (cause) {
    throw new Error("Saved notification settings cache could not be read.", {
      cause,
    });
  }
  if (!isNotificationSettingsCache(parsed)) {
    throw new Error("Saved notification settings cache is invalid.");
  }
  return { settings: parsed.settings, cachedAt: parsed.cachedAt };
}

function getCacheKey(userId: string): string {
  return `${CACHE_KEY_PREFIX}${encodeURIComponent(userId)}`;
}

function isNotificationSettingsCache(
  value: unknown,
): value is { settings: NotificationSettings; cachedAt: number } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    settings?: Partial<NotificationSettings>;
    cachedAt?: unknown;
  };
  const settings = candidate.settings;
  const booleanFields = (
    Object.keys(DEFAULT_NOTIFICATION_SETTINGS) as (keyof NotificationSettings)[]
  ).filter((key) => key !== "quietHoursStart" && key !== "quietHoursEnd");
  return (
    typeof candidate.cachedAt === "number" &&
    typeof settings === "object" &&
    settings !== null &&
    booleanFields.every((key) => typeof settings[key] === "boolean") &&
    settings.securityAlerts === true &&
    typeof settings.quietHoursStart === "string" &&
    typeof settings.quietHoursEnd === "string"
  );
}

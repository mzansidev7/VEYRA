import { supabaseClient } from "../lib/supabaseClient";
import {
  DEFAULT_PRIVACY_SETTINGS,
  getPrivacySettingsCache,
  removePrivacySettingsCache,
  savePrivacySettingsCache,
  updatePrivacySettingsCache,
  type PrivacyData,
  type PrivacySettings,
} from "../asyncStore/profileStore/privacySettingsStore";

const DATABASE_COLUMNS: Record<keyof PrivacySettings, string> = {
  discoverable: "discoverable",
  showInDailyFive: "show_in_daily_five",
  showInExplore: "show_in_explore",
  showDistance: "show_distance",
  showOnlineStatus: "show_online_status",
  showLastActive: "show_last_active",
  showAge: "show_age",
  showCity: "show_city",
  showVoiceIntro: "show_voice_intro",
  showCompatibilityScore: "show_compatibility_score",
  showVerificationBadge: "show_verification_badge",
  incognitoMode: "incognito_mode",
  profileVisitorHistoryEnabled: "profile_visitor_history_enabled",
  readReceipts: "read_receipts",
  allowProfileSharing: "allow_profile_sharing",
  messagesFromMatchesOnly: "messages_from_matches_only",
  allowVoiceMessages: "allow_voice_messages",
};

export async function getPrivacyData(userId: string): Promise<PrivacyData> {
  const cached = await getPrivacySettingsCache(userId);
  if (cached?.isFresh) return cached.data;

  return refreshPrivacyData(userId);
}

export async function getCachedPrivacyData(userId: string) {
  return getPrivacySettingsCache(userId);
}

export async function refreshPrivacyData(
  userId: string,
): Promise<PrivacyData> {
  const data = await fetchPrivacyDataFromServer(userId);
  await savePrivacySettingsCache(userId, data);
  return data;
}

async function fetchPrivacyDataFromServer(
  userId: string,
): Promise<PrivacyData> {
  const client = getSupabaseClient();
  const [settingsResult, blockedResult, hiddenResult] = await Promise.all([
    client
      .from("user_privacy_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("blocked_users")
      .select("blocked_id, created_at")
      .eq("blocker_id", userId)
      .order("created_at", { ascending: false }),
    client
      .from("hidden_profiles")
      .select("hidden_user_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  if (settingsResult.error) {
    throw new Error(
      `Could not load privacy settings: ${settingsResult.error.message}`,
    );
  }
  if (blockedResult.error) {
    throw new Error(
      `Could not load blocked users: ${blockedResult.error.message}`,
    );
  }
  if (hiddenResult.error) {
    throw new Error(
      `Could not load hidden profiles: ${hiddenResult.error.message}`,
    );
  }

  const data: PrivacyData = {
    settings: settingsResult.data
      ? mapDatabaseSettings(settingsResult.data)
      : DEFAULT_PRIVACY_SETTINGS,
    blockedUsers: blockedResult.data.map((entry) => ({
      userId: entry.blocked_id,
      createdAt: entry.created_at,
    })),
    hiddenProfiles: hiddenResult.data.map((entry) => ({
      userId: entry.hidden_user_id,
      createdAt: entry.created_at,
    })),
  };
  return data;
}

export async function savePrivacySettings(
  userId: string,
  settings: PrivacySettings,
): Promise<void> {
  const client = getSupabaseClient();
  const values = Object.fromEntries(
    Object.entries(DATABASE_COLUMNS).map(([field, column]) => [
      column,
      settings[field as keyof PrivacySettings],
    ]),
  );
  const { error } = await client.from("user_privacy_settings").upsert(
    {
      user_id: userId,
      ...values,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw new Error(`Could not save privacy settings: ${error.message}`);
  }
  await updatePrivacySettingsCache(userId, (data) => ({ ...data, settings }));
}

export async function blockUser(
  userId: string,
  blockedUserId: string,
): Promise<void> {
  if (userId === blockedUserId) {
    throw new Error("You cannot block your own account.");
  }
  const { error } = await getSupabaseClient()
    .from("blocked_users")
    .upsert(
      { blocker_id: userId, blocked_id: blockedUserId },
      { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`Could not block this user: ${error.message}`);
  await updatePrivacySettingsCache(userId, (data) => ({
    ...data,
    blockedUsers: addPrivacyListEntry(data.blockedUsers, blockedUserId),
  }));
}

export async function unblockUser(
  userId: string,
  blockedUserId: string,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("blocked_users")
    .delete()
    .eq("blocker_id", userId)
    .eq("blocked_id", blockedUserId);
  if (error) throw new Error(`Could not unblock this user: ${error.message}`);
  await updatePrivacySettingsCache(userId, (data) => ({
    ...data,
    blockedUsers: data.blockedUsers.filter(
      (entry) => entry.userId !== blockedUserId,
    ),
  }));
}

export async function hideProfile(
  userId: string,
  hiddenUserId: string,
): Promise<void> {
  if (userId === hiddenUserId) {
    throw new Error("You cannot hide your own profile.");
  }
  const { error } = await getSupabaseClient()
    .from("hidden_profiles")
    .upsert(
      { user_id: userId, hidden_user_id: hiddenUserId },
      { onConflict: "user_id,hidden_user_id", ignoreDuplicates: true },
    );
  if (error) throw new Error(`Could not hide this profile: ${error.message}`);
  await updatePrivacySettingsCache(userId, (data) => ({
    ...data,
    hiddenProfiles: addPrivacyListEntry(data.hiddenProfiles, hiddenUserId),
  }));
}

export async function unhideProfile(
  userId: string,
  hiddenUserId: string,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("hidden_profiles")
    .delete()
    .eq("user_id", userId)
    .eq("hidden_user_id", hiddenUserId);
  if (error) throw new Error(`Could not unhide this profile: ${error.message}`);
  await updatePrivacySettingsCache(userId, (data) => ({
    ...data,
    hiddenProfiles: data.hiddenProfiles.filter(
      (entry) => entry.userId !== hiddenUserId,
    ),
  }));
}

export async function deleteOwnAccount(): Promise<void> {
  const { error } = await getSupabaseClient().functions.invoke(
    "delete-account",
    { body: {} },
  );
  if (error) {
    throw new Error(`Could not delete your account: ${error.message}`);
  }
}

export async function removePrivacyCache(userId: string): Promise<void> {
  await removePrivacySettingsCache(userId);
}

function getSupabaseClient() {
  if (!supabaseClient) {
    throw new Error(
      "Supabase is not configured. Privacy settings are unavailable.",
    );
  }
  return supabaseClient;
}

function mapDatabaseSettings(data: Record<string, unknown>): PrivacySettings {
  return Object.fromEntries(
    Object.entries(DATABASE_COLUMNS).map(([field, column]) => [
      field,
      data[column] as boolean,
    ]),
  ) as PrivacySettings;
}

function addPrivacyListEntry(
  entries: PrivacyData["blockedUsers"],
  userId: string,
): PrivacyData["blockedUsers"] {
  if (entries.some((entry) => entry.userId === userId)) return entries;
  return [{ userId, createdAt: new Date().toISOString() }, ...entries];
}

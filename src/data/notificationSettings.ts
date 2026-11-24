import {
  DEFAULT_NOTIFICATION_SETTINGS,
  getCachedNotificationSettings as readCachedNotificationSettings,
  saveNotificationSettingsCache,
  type NotificationSettings,
} from "../asyncStore/profileStore/notificationSettingsStore";
import { supabaseClient } from "../lib/supabaseClient";

export async function getCachedNotificationSettings(userId: string) {
  return readCachedNotificationSettings(userId);
}

export async function getNotificationSettings(
  userId: string,
): Promise<NotificationSettings> {
  const cached = await readCachedNotificationSettings(userId);
  if (cached?.isFresh) return cached.settings;
  return refreshNotificationSettings(userId);
}

export async function refreshNotificationSettings(
  userId: string,
): Promise<NotificationSettings> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("user_notification_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load notification settings: ${error.message}`);
  }

  const settings: NotificationSettings = data
    ? {
        pushEnabled: data.push_enabled,
        emailEnabled: data.email_enabled,
        inAppEnabled: data.in_app_enabled,
        newLikes: data.new_likes,
        newMatches: data.new_matches,
        dailyFive: data.daily_five,
        profileActivity: data.profile_activity,
        newMessages: data.new_messages,
        voiceMessages: data.voice_messages,
        dateInvitations: data.date_invitations,
        datingReminders: data.dating_reminders,
        upcomingDates: data.upcoming_dates,
        verificationUpdates: data.verification_updates,
        securityAlerts: true,
        productUpdates: data.product_updates,
        promotions: data.promotions,
        quietHoursEnabled: data.quiet_hours_enabled,
        quietHoursStart: normalizeTime(data.quiet_hours_start, "22:00"),
        quietHoursEnd: normalizeTime(data.quiet_hours_end, "07:00"),
        showNotificationPreview: data.show_notification_preview,
      }
    : DEFAULT_NOTIFICATION_SETTINGS;

  await saveNotificationSettingsCache(userId, settings);
  return settings;
}

export async function saveNotificationSettings(
  userId: string,
  settings: NotificationSettings,
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("user_notification_settings")
    .upsert(
      {
        user_id: userId,
        push_enabled: settings.pushEnabled,
        email_enabled: settings.emailEnabled,
        in_app_enabled: settings.inAppEnabled,
        new_likes: settings.newLikes,
        new_matches: settings.newMatches,
        daily_five: settings.dailyFive,
        profile_activity: settings.profileActivity,
        new_messages: settings.newMessages,
        voice_messages: settings.voiceMessages,
        date_invitations: settings.dateInvitations,
        dating_reminders: settings.datingReminders,
        upcoming_dates: settings.upcomingDates,
        verification_updates: settings.verificationUpdates,
        security_alerts: true,
        product_updates: settings.productUpdates,
        promotions: settings.promotions,
        quiet_hours_enabled: settings.quietHoursEnabled,
        quiet_hours_start: settings.quietHoursStart,
        quiet_hours_end: settings.quietHoursEnd,
        show_notification_preview: settings.showNotificationPreview,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) {
    throw new Error(`Could not save notification settings: ${error.message}`);
  }
  await saveNotificationSettingsCache(userId, {
    ...settings,
    securityAlerts: true,
  });
}

function normalizeTime(value: string | null, fallback: string): string {
  if (!value) return fallback;
  return value.slice(0, 5);
}

function getSupabaseClient() {
  if (!supabaseClient) {
    throw new Error(
      "Supabase is not configured. Notification settings are unavailable.",
    );
  }
  return supabaseClient;
}

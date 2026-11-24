import { supabaseClient } from "../lib/supabaseClient";
import {
  DEFAULT_VERIFICATION_DATA,
  getCachedVerificationData as readCachedVerificationData,
  saveVerificationDataCache,
  type VerificationData,
} from "../asyncStore/profileStore/verificationSettingsStore";

export async function getCachedVerificationData(userId: string) {
  return readCachedVerificationData(userId);
}

export async function getVerificationData(
  userId: string,
): Promise<VerificationData> {
  const cached = await readCachedVerificationData(userId);
  if (cached?.isFresh) return cached.data;
  return refreshVerificationData(userId);
}

export async function refreshVerificationData(
  userId: string,
): Promise<VerificationData> {
  if (!supabaseClient) {
    throw new Error("Supabase is not configured. Verification status is unavailable.");
  }

  const { data, error } = await supabaseClient
    .from("user_verifications")
    .select(
      "email_verified, photo_verification_status, identity_verification_status, photo_verified_at, identity_verified_at",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load verification status: ${error.message}`);
  }

  const status: VerificationData = data
    ? {
        emailVerified: data.email_verified,
        photoVerificationStatus: data.photo_verification_status,
        identityVerificationStatus: data.identity_verification_status,
        photoVerifiedAt: data.photo_verified_at,
        identityVerifiedAt: data.identity_verified_at,
      }
    : DEFAULT_VERIFICATION_DATA;
  await saveVerificationDataCache(userId, status);
  return status;
}

export async function getVerifiedIdentityUserIds(
  userIds: readonly string[],
): Promise<Set<string>> {
  const uniqueUserIds = [...new Set(userIds)];
  if (!uniqueUserIds.length) return new Set();
  if (!supabaseClient) {
    throw new Error(
      "Supabase is not configured. Identity badge status is unavailable.",
    );
  }

  const { data, error } = await supabaseClient
    .from("verified_identity_badges")
    .select("user_id")
    .in("user_id", uniqueUserIds);

  if (error) {
    throw new Error(`Could not load identity badge status: ${error.message}`);
  }

  return new Set(data.map(({ user_id }) => user_id));
}

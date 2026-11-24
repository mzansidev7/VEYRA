import { supabaseClient } from "../lib/supabaseClient";
import { deleteLocalFile } from "../lib/localFile";
import {
  getLocalDatingProfile,
  normalizeLocalDatingProfile,
  saveLocalDatingProfile,
  type LocalDatingProfile,
} from "./localProfile";
import {
  isStorageReference,
  removeProfilePhotos,
  uploadProfilePhoto,
} from "./profilePhotos";
import {
  removeProfileVoiceIntros,
  uploadProfileVoiceIntro,
} from "./profileVoiceIntro";

export async function getDatingProfile(
  userId: string,
): Promise<LocalDatingProfile> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from("dating_profiles")
    .select(
      "profile, latitude, longitude, location_source, province, country, explore_radius_km",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not load your profile from the server: ${error.message}`,
    );
  }
  if (data) {
    const profile = normalizeDatabaseProfile(data);
    if (
      profile.profile.photos.some(
        (photo) =>
          !isStorageReference(photo) || !photo.startsWith(`${userId}/`),
      ) ||
      (profile.profile.voiceIntroUri &&
        (!isStorageReference(profile.profile.voiceIntroUri) ||
          !profile.profile.voiceIntroUri.startsWith(`${userId}/`)))
    ) {
      return saveDatingProfile(userId, profile);
    }
    return profile;
  }

  const localProfile = await getLocalDatingProfile(userId);
  return saveDatingProfile(userId, localProfile);
}

export async function saveDatingProfile(
  userId: string,
  profile: LocalDatingProfile,
): Promise<LocalDatingProfile> {
  const client = getSupabaseClient();
  const { data: previousData, error: previousError } = await client
    .from("dating_profiles")
    .select(
      "profile, latitude, longitude, location_source, province, country, explore_radius_km",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (previousError) {
    throw new Error(
      `Could not check your existing profile media: ${previousError.message}`,
    );
  }

  const previousProfile = previousData
    ? normalizeDatabaseProfile(previousData)
    : null;
  const uploadedPhotoPaths: string[] = [];
  const uploadedVoicePaths: string[] = [];
  const photoPaths: string[] = [];
  const localVoiceIntroUri = profile.profile.voiceIntroUri;
  let voiceIntroPath = profile.profile.voiceIntroUri;
  try {
    for (const reference of profile.profile.photos) {
      if (isStorageReference(reference)) {
        if (!reference.startsWith(`${userId}/`)) {
          throw new Error(
            "A profile photo reference does not belong to this account.",
          );
        }
        photoPaths.push(reference);
        continue;
      }
      const path = await uploadProfilePhoto(userId, reference);
      uploadedPhotoPaths.push(path);
      photoPaths.push(path);
    }
    if (voiceIntroPath && !isStorageReference(voiceIntroPath)) {
      voiceIntroPath = await uploadProfileVoiceIntro(userId, voiceIntroPath);
      uploadedVoicePaths.push(voiceIntroPath);
    } else if (voiceIntroPath && !voiceIntroPath.startsWith(`${userId}/`)) {
      throw new Error(
        "The voice introduction reference does not belong to this account.",
      );
    }
  } catch (cause) {
    try {
      await Promise.all([
        removeProfilePhotos(uploadedPhotoPaths),
        removeProfileVoiceIntros(uploadedVoicePaths),
      ]);
    } catch (cleanupError) {
      throw new Error(
        `${getErrorMessage(cause)} Some uploaded media could not be cleaned up: ${getErrorMessage(cleanupError)}`,
        { cause },
      );
    }
    throw cause;
  }

  const savedProfile: LocalDatingProfile = {
    ...profile,
    profile: {
      ...profile.profile,
      nickname: profile.profile.nickname.trim(),
      photos: photoPaths,
      voiceIntroUri: voiceIntroPath,
    },
  };

  const { location, preferences, ...profileDocument } = savedProfile;
  const { error } = await client
    .from("dating_profiles")
    .upsert(
      {
        user_id: userId,
        profile: {
          ...profileDocument,
          preferences: {
            ...preferences,
            exploreRadiusKm: preferences.exploreRadiusKm,
          },
        },
        latitude: location.latitude,
        longitude: location.longitude,
        location_source: location.source,
        province: savedProfile.profile.province,
        country: savedProfile.profile.country,
        explore_radius_km: preferences.exploreRadiusKm,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) {
    try {
      await Promise.all([
        removeProfilePhotos(uploadedPhotoPaths),
        removeProfileVoiceIntros(uploadedVoicePaths),
      ]);
    } catch (cleanupError) {
      throw new Error(
        `Could not save your profile to the server: ${error.message}. Some uploaded media could not be cleaned up: ${getErrorMessage(cleanupError)}`,
      );
    }
    if (error.code === "23505") {
      throw new Error("That nickname is already taken. Please choose another.");
    }
    throw new Error(
      `Could not save your profile to the server: ${error.message}`,
    );
  }
  await saveLocalDatingProfile(userId, savedProfile);

  const previousPhotoPaths =
    previousProfile?.profile.photos.filter(
      (reference) =>
        isStorageReference(reference) && reference.startsWith(`${userId}/`),
    ) ?? [];
  const retainedPhotoPaths = new Set(photoPaths);
  await removeProfilePhotos(
    previousPhotoPaths.filter((path) => !retainedPhotoPaths.has(path)),
  );
  const previousVoicePath = previousProfile?.profile.voiceIntroUri;
  if (
    previousVoicePath &&
    isStorageReference(previousVoicePath) &&
    previousVoicePath.startsWith(`${userId}/`) &&
    previousVoicePath !== voiceIntroPath
  ) {
    await removeProfileVoiceIntros([previousVoicePath]);
  }
  if (localVoiceIntroUri && !isStorageReference(localVoiceIntroUri)) {
    try {
      await deleteLocalFile(localVoiceIntroUri);
    } catch (cause) {
      throw new Error(
        `Your profile was saved, but the local voice recording could not be removed: ${getErrorMessage(cause)}`,
        { cause },
      );
    }
  }
  return savedProfile;
}

function normalizeDatabaseProfile(data: {
  profile: unknown;
  latitude: number | null;
  longitude: number | null;
  location_source: string;
  province: string;
  country: string;
  explore_radius_km: number;
}): LocalDatingProfile {
  if (!data.profile || typeof data.profile !== "object") {
    return normalizeLocalDatingProfile(data.profile);
  }
  const profile = data.profile as Record<string, unknown>;
  const storedProfile =
    profile.profile && typeof profile.profile === "object"
      ? (profile.profile as Record<string, unknown>)
      : {};
  const preferences =
    profile.preferences && typeof profile.preferences === "object"
      ? (profile.preferences as Record<string, unknown>)
      : {};
  return normalizeLocalDatingProfile({
    ...profile,
    profile: {
      ...storedProfile,
      province: data.province || storedProfile.province || "",
      country: data.country || storedProfile.country || "South Africa",
    },
    location: {
      latitude: data.latitude,
      longitude: data.longitude,
      source: data.location_source,
    },
    preferences: {
      ...preferences,
      exploreRadiusKm: data.explore_radius_km ?? 50,
    },
  });
}

function getSupabaseClient() {
  if (!supabaseClient) {
    throw new Error("Supabase is not configured. Profile sync is unavailable.");
  }
  return supabaseClient;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

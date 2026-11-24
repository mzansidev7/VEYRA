import { randomUUID } from "expo-crypto";
import { readLocalFile } from "../lib/localFile";
import { supabaseClient } from "../lib/supabaseClient";
import { isStorageReference } from "./profilePhotos";

const PROFILE_VOICE_BUCKET = "profile-voice-intros";
const SIGNED_URL_LIFETIME_SECONDS = 60 * 60;
const MAX_VOICE_INTRO_SIZE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_AUDIO_TYPES = [
  "audio/mp4",
  "audio/m4a",
  "audio/aac",
  "audio/wav",
  "audio/mpeg",
  "audio/3gpp",
  "audio/webm",
];

export async function uploadProfileVoiceIntro(
  userId: string,
  uri: string,
): Promise<string> {
  let data: Uint8Array;
  let fileType: string;
  try {
    ({ bytes: data, type: fileType } = await readLocalFile(uri));
  } catch (cause) {
    throw new Error(
      "The voice introduction could not be read from this device.",
      { cause },
    );
  }

  if (data.byteLength === 0) {
    throw new Error("The voice introduction is empty.");
  }
  if (data.byteLength > MAX_VOICE_INTRO_SIZE_BYTES) {
    throw new Error("Voice introductions must be 10 MB or smaller.");
  }

  const extension = getAudioExtension(uri);
  const contentType = getAudioContentType(fileType, extension);
  const path = `${userId}/${randomUUID()}.${extension}`;
  const { error } = await getSupabaseClient()
    .storage.from(PROFILE_VOICE_BUCKET)
    .upload(path, data, { contentType, upsert: false });

  if (error) {
    throw new Error(
      `Could not upload your voice introduction: ${error.message}`,
    );
  }
  return path;
}

export async function createProfileVoiceIntroUrl(
  reference: string,
): Promise<string> {
  if (!isStorageReference(reference)) return reference;
  const { data, error } = await getSupabaseClient()
    .storage.from(PROFILE_VOICE_BUCKET)
    .createSignedUrl(reference, SIGNED_URL_LIFETIME_SECONDS);

  if (error) {
    throw new Error(`Could not load your voice introduction: ${error.message}`);
  }
  return data.signedUrl;
}

export async function removeProfileVoiceIntros(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await getSupabaseClient()
    .storage.from(PROFILE_VOICE_BUCKET)
    .remove(paths);
  if (error) {
    throw new Error(
      `Could not remove an unused voice introduction: ${error.message}`,
    );
  }
}

function getAudioExtension(uri: string): string {
  const extension = uri
    .split(/[?#]/, 1)[0]
    .split(".")
    .pop()
    ?.toLowerCase();
  if (
    extension &&
    ["m4a", "mp4", "aac", "wav", "mp3", "3gp", "webm"].includes(extension)
  ) {
    return extension;
  }
  throw new Error("This voice recording format is not supported.");
}

function getAudioContentType(fileType: string, extension: string): string {
  const contentType = fileType.toLowerCase();
  if (SUPPORTED_AUDIO_TYPES.includes(contentType)) return contentType;

  const contentTypes: Record<string, string> = {
    m4a: "audio/mp4",
    mp4: "audio/mp4",
    aac: "audio/aac",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    "3gp": "audio/3gpp",
    webm: "audio/webm",
  };
  return contentTypes[extension];
}

function getSupabaseClient() {
  if (!supabaseClient) {
    throw new Error(
      "Supabase is not configured. Voice introduction storage is unavailable.",
    );
  }
  return supabaseClient;
}

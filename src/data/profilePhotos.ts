import { randomUUID } from "expo-crypto";
import { readLocalFile } from "../lib/localFile";
import { supabaseClient } from "../lib/supabaseClient";

const PROFILE_PHOTOS_BUCKET = "profile-photos";
const SIGNED_URL_LIFETIME_SECONDS = 60 * 60;
const MAX_PROFILE_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;

export async function uploadProfilePhoto(
  userId: string,
  uri: string,
): Promise<string> {
  const client = getSupabaseClient();
  let data: Uint8Array;
  let fileType: string;
  try {
    ({ bytes: data, type: fileType } = await readLocalFile(uri));
  } catch (cause) {
    throw new Error("A selected photo could not be read from this device.", {
      cause,
    });
  }
  const contentType = fileType.startsWith("image/")
    ? fileType
    : getContentType(uri);
  if (!contentType.startsWith("image/")) {
    throw new Error("Selected profile photos must be image files.");
  }
  if (data.byteLength === 0) {
    throw new Error("The selected profile photo is empty.");
  }
  if (data.byteLength > MAX_PROFILE_PHOTO_SIZE_BYTES) {
    throw new Error("Profile photos must be 10 MB or smaller.");
  }

  const extension = getFileExtension(uri, contentType);
  const path = `${userId}/${randomUUID()}.${extension}`;
  const { error } = await client.storage
    .from(PROFILE_PHOTOS_BUCKET)
    .upload(path, data, {
      contentType,
      upsert: false,
    });

  if (error) {
    throw new Error(`Could not upload a profile photo: ${error.message}`);
  }
  return path;
}

export async function createProfilePhotoUrls(
  references: string[],
): Promise<string[]> {
  const paths = references.filter(isStorageReference);
  if (!paths.length) return references;

  const { data, error } = await getSupabaseClient()
    .storage.from(PROFILE_PHOTOS_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_LIFETIME_SECONDS);

  if (error) {
    throw new Error(`Could not load profile photos: ${error.message}`);
  }

  const urlByPath = new Map<string, string>();
  for (const item of data) {
    if (!item.path || !item.signedUrl || item.error) {
      throw new Error(
        item.error ?? "A profile photo could not be accessed.",
      );
    }
    urlByPath.set(item.path, item.signedUrl);
  }

  return references.map((reference) => {
    if (!isStorageReference(reference)) return reference;
    const url = urlByPath.get(reference);
    if (!url) throw new Error("A profile photo could not be accessed.");
    return url;
  });
}

export async function removeProfilePhotos(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await getSupabaseClient()
    .storage.from(PROFILE_PHOTOS_BUCKET)
    .remove(paths);
  if (error) {
    throw new Error(`Could not remove unused profile photos: ${error.message}`);
  }
}

export function isStorageReference(reference: string): boolean {
  return !reference.includes("://") && !reference.startsWith("data:");
}

function getContentType(uri: string): string {
  const extension = getFileExtension(uri, "");
  const contentTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
  };
  return contentTypes[extension] ?? "application/octet-stream";
}

function getFileExtension(uri: string, contentType: string): string {
  const extension = uri
    .split(/[?#]/, 1)[0]
    .split(".")
    .pop()
    ?.toLowerCase();
  if (
    extension &&
    ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(extension)
  ) {
    return extension;
  }
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/heic") return "heic";
  if (contentType === "image/heif") return "heif";
  return "jpg";
}

function getSupabaseClient() {
  if (!supabaseClient) {
    throw new Error(
      "Supabase is not configured. Profile photo storage is unavailable.",
    );
  }
  return supabaseClient;
}

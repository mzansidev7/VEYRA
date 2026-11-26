import { supabaseClient } from "../lib/supabaseClient";

export type AppReleaseMedia = {
  kind: "image" | "video";
  url: string;
};

export type AppReleaseUpdate = {
  id: string;
  version: string;
  description: string;
  downloadUrl: string | null;
  media: AppReleaseMedia[];
  publishedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function parseRelease(value: unknown): AppReleaseUpdate {
  const downloadUrl = isRecord(value) ? value.download_url : undefined;
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.version !== "string" ||
    typeof value.description !== "string" ||
    (downloadUrl !== null && !isHttpsUrl(downloadUrl)) ||
    !Array.isArray(value.media) ||
    typeof value.published_at !== "string"
  ) {
    throw new Error("The latest release update response was invalid.");
  }

  const media = value.media.map((item, index) => {
    if (
      !isRecord(item) ||
      (item.kind !== "image" && item.kind !== "video") ||
      !isHttpsUrl(item.url)
    ) {
      throw new Error(`Release media is invalid at item ${index + 1}.`);
    }
    const kind: AppReleaseMedia["kind"] = item.kind;
    return { kind, url: item.url };
  });

  return {
    id: value.id,
    version: value.version,
    description: value.description,
    downloadUrl,
    media,
    publishedAt: value.published_at,
  };
}

export async function getAppReleases(): Promise<AppReleaseUpdate[]> {
  if (!supabaseClient) {
    throw new Error("Supabase is not configured for release updates.");
  }
  const { data, error } = await supabaseClient.rpc("get_app_release_updates");
  if (error) {
    throw new Error(`Could not load release updates: ${error.message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error("The release updates response was invalid.");
  }
  return data.map(parseRelease);
}

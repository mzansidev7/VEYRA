import { useEffect, useState } from "react";
import { createProfileVoiceIntroUrl } from "../../data/profileVoiceIntro";
import { isStorageReference } from "../../data/profilePhotos";

export function useProfileVoiceIntroUrl(reference: string) {
  const [url, setUrl] = useState(
    isStorageReference(reference) ? "" : reference,
  );
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const resolveUrl = () => {
      void createProfileVoiceIntroUrl(reference)
        .then((resolvedUrl) => {
          if (active) setUrl(resolvedUrl);
        })
        .catch((cause: unknown) => {
          if (!active) return;
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load your voice introduction.",
          );
        });
    };

    setUrl(isStorageReference(reference) ? "" : reference);
    setError("");
    resolveUrl();

    const refreshInterval = isStorageReference(reference)
      ? setInterval(resolveUrl, 50 * 60 * 1000)
      : undefined;

    return () => {
      active = false;
      if (refreshInterval) clearInterval(refreshInterval);
    };
  }, [reference]);

  return { url, error };
}

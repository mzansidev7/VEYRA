import { useEffect, useMemo, useState } from "react";
import { createProfilePhotoUrls } from "../../data/profilePhotos";

export function useProfilePhotoUrls(references: string[]) {
  const referencesKey = JSON.stringify(references);
  const stableReferences = useMemo(
    () => references.slice(),
    [referencesKey],
  );
  const [urls, setUrls] = useState(references);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setUrls(stableReferences);
    setError("");

    void createProfilePhotoUrls(stableReferences)
      .then((resolvedUrls) => {
        if (active) setUrls(resolvedUrls);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load profile photos.",
        );
      });

    return () => {
      active = false;
    };
  }, [stableReferences]);

  return { urls, error };
}

import type { LocalDatingProfile } from "../../data/localProfile";

type CompletionCheck = {
  label: string;
  complete: boolean;
};

export function getProfileCompletion(profile: LocalDatingProfile): {
  percentage: number;
  missingItems: string[];
} {
  const promptCount = [
    profile.profile.perfectSunday,
    profile.profile.greenFlag,
    profile.profile.wantToLearn,
    profile.profile.relationshipVision,
  ].filter((answer) => answer.trim()).length;

  const checks: CompletionCheck[] = [
    { label: "Add at least 3 photos", complete: profile.profile.photos.length >= 3 },
    { label: "Write a bio of at least 30 characters", complete: profile.profile.bio.trim().length >= 30 },
    { label: "Answer 3 profile prompts", complete: promptCount >= 3 },
    { label: "Add your occupation", complete: Boolean(profile.profile.occupation.trim()) },
    { label: "Add your education", complete: Boolean(profile.profile.education.trim()) },
    {
      label: "Complete lifestyle details",
      complete: Boolean(
        profile.profile.exercise &&
          profile.profile.smoking &&
          profile.profile.drinking &&
          profile.profile.children &&
          profile.profile.pets,
      ),
    },
    { label: "Choose your dating intentions", complete: profile.intentions.length > 0 },
    {
      label: "Complete your Dating DNA",
      complete:
        profile.datingDNA.relationshipGoals.length > 0 &&
        Boolean(profile.datingDNA.communicationStyle) &&
        profile.datingDNA.values.length > 0 &&
        Boolean(profile.datingDNA.idealWeekend.trim()),
    },
    {
      label: "Set your dating preferences",
      complete:
        profile.preferences.genders.length > 0 &&
        profile.preferences.minAge >= 18 &&
        profile.preferences.maxAge >= profile.preferences.minAge &&
        profile.preferences.maxAge <= 99,
    },
  ];

  const completedCount = checks.filter((check) => check.complete).length;
  return {
    percentage: Math.round((completedCount / checks.length) * 100),
    missingItems: checks
      .filter((check) => !check.complete)
      .map((check) => check.label),
  };
}

export function calculateProfileCompletion(
  profile: LocalDatingProfile,
): number {
  return getProfileCompletion(profile).percentage;
}

import AsyncStorage from "@react-native-async-storage/async-storage";

export type LocalDatingProfile = {
  version: 1;
  intentions: string[];
  profile: {
    nickname: string;
    birthday: string;
    gender: string;
    photos: string[];
    city: string;
    province: string;
    country: string;
    bio: string;
    interests: string[];
    occupation: string;
    education: string;
    height: string;
    languages: string;
    exercise: string;
    smoking: string;
    drinking: string;
    children: string;
    pets: string;
    perfectSunday: string;
    greenFlag: string;
    wantToLearn: string;
    relationshipVision: string;
    voiceIntroUri: string;
  };
  location: {
    latitude: number | null;
    longitude: number | null;
    source: "manual" | "gps";
  };
  datingDNA: {
    relationshipGoals: string[];
    communicationStyle: string;
    values: string[];
    idealWeekend: string;
  };
  preferences: {
    genders: string[];
    minAge: number;
    maxAge: number;
    exploreRadiusKm: number;
  };
};

export type OnboardingStep =
  | "intentions"
  | "profile"
  | "dna"
  | "preferences"
  | "complete";

const PROFILE_KEY_PREFIX = "veyra:dating-profile:v1:";

export function createEmptyLocalProfile(): LocalDatingProfile {
  return {
    version: 1,
    intentions: [],
    profile: {
      nickname: "",
      birthday: "",
      gender: "",
      photos: [],
      city: "",
      province: "",
      country: "South Africa",
      bio: "",
      interests: [],
      occupation: "",
      education: "",
      height: "",
      languages: "",
      exercise: "",
      smoking: "",
      drinking: "",
      children: "",
      pets: "",
      perfectSunday: "",
      greenFlag: "",
      wantToLearn: "",
      relationshipVision: "",
      voiceIntroUri: "",
    },
    location: {
      latitude: null,
      longitude: null,
      source: "manual",
    },
    datingDNA: {
      relationshipGoals: [],
      communicationStyle: "",
      values: [],
      idealWeekend: "",
    },
    preferences: {
      genders: [],
      minAge: 18,
      maxAge: 45,
      exploreRadiusKm: 50,
    },
  };
}

export async function getLocalDatingProfile(
  userId: string,
): Promise<LocalDatingProfile> {
  const stored = await AsyncStorage.getItem(getProfileKey(userId));
  if (stored === null) return createEmptyLocalProfile();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (error) {
    throw new Error("Your saved profile data could not be read.", {
      cause: error,
    });
  }
  return normalizeLocalDatingProfile(parsed);
}

export function normalizeLocalDatingProfile(
  value: unknown,
): LocalDatingProfile {
  if (!isStoredLocalDatingProfile(value)) {
    throw new Error(
      "Your saved profile data is invalid. Sign out and contact support.",
    );
  }
  const { name: legacyName, ...storedProfile } = value.profile;
  return {
    ...value,
    location: {
      latitude: value.location?.latitude ?? null,
      longitude: value.location?.longitude ?? null,
      source: value.location?.source === "gps" ? "gps" : "manual",
    },
    profile: {
      ...storedProfile,
      nickname:
        value.profile.nickname?.trim() || legacyName?.trim() || "",
      province: value.profile.province ?? "",
      country: value.profile.country ?? "South Africa",
      interests: value.profile.interests ?? [],
      occupation: value.profile.occupation ?? "",
      education: value.profile.education ?? "",
      height: value.profile.height ?? "",
      languages: value.profile.languages ?? "",
      exercise: value.profile.exercise ?? "",
      smoking: value.profile.smoking ?? "",
      drinking: value.profile.drinking ?? "",
      children: value.profile.children ?? "",
      pets: value.profile.pets ?? "",
      perfectSunday: value.profile.perfectSunday ?? "",
      greenFlag: value.profile.greenFlag ?? "",
      wantToLearn: value.profile.wantToLearn ?? "",
      relationshipVision: value.profile.relationshipVision ?? "",
      voiceIntroUri: value.profile.voiceIntroUri ?? "",
    },
    preferences: {
      ...value.preferences,
      exploreRadiusKm: value.preferences.exploreRadiusKm ?? 50,
    },
  };
}

export async function saveLocalDatingProfile(
  userId: string,
  profile: LocalDatingProfile,
): Promise<void> {
  await AsyncStorage.setItem(getProfileKey(userId), JSON.stringify(profile));
}

export async function removeLocalDatingProfile(userId: string): Promise<void> {
  await AsyncStorage.removeItem(getProfileKey(userId));
}

export function getNextOnboardingStep(
  profile: LocalDatingProfile,
): OnboardingStep {
  if (profile.intentions.length === 0) return "intentions";
  if (
    !profile.profile.nickname.trim() ||
    !isAdultBirthday(profile.profile.birthday) ||
    !profile.profile.gender ||
    profile.profile.photos.length === 0 ||
    !profile.profile.city.trim() ||
    !profile.profile.bio.trim()
  ) {
    return "profile";
  }
  if (
    profile.datingDNA.relationshipGoals.length === 0 ||
    !profile.datingDNA.communicationStyle ||
    profile.datingDNA.values.length === 0 ||
    !profile.datingDNA.idealWeekend.trim()
  ) {
    return "dna";
  }
  if (
    profile.preferences.genders.length === 0 ||
    profile.preferences.minAge < 18 ||
    profile.preferences.maxAge < profile.preferences.minAge ||
    profile.preferences.maxAge > 99
  ) {
    return "preferences";
  }
  return "complete";
}

export function isAdultBirthday(value: string): boolean {
  const age = getAgeFromBirthday(value);
  return age !== null && age >= 18;
}

export function getAgeFromBirthday(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  const [year, month, day] = value.split("-").map(Number);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const beforeBirthday =
    today.getMonth() < date.getMonth() ||
    (today.getMonth() === date.getMonth() && today.getDate() < date.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function getProfileKey(userId: string): string {
  return `${PROFILE_KEY_PREFIX}${encodeURIComponent(userId)}`;
}

type StoredLocalDatingProfile = Omit<LocalDatingProfile, "profile"> & {
  profile: Omit<
    LocalDatingProfile["profile"],
    | "interests"
    | "occupation"
    | "education"
    | "height"
    | "languages"
    | "exercise"
    | "smoking"
    | "drinking"
    | "children"
    | "pets"
    | "perfectSunday"
    | "greenFlag"
    | "wantToLearn"
    | "relationshipVision"
    | "voiceIntroUri"
    | "nickname"
  > &
    { nickname?: string; name?: string } &
    Partial<
      Pick<
        LocalDatingProfile["profile"],
        | "interests"
        | "occupation"
        | "education"
        | "height"
        | "languages"
        | "exercise"
        | "smoking"
        | "drinking"
        | "children"
        | "pets"
        | "perfectSunday"
        | "greenFlag"
        | "wantToLearn"
        | "relationshipVision"
        | "voiceIntroUri"
      >
    >;
};

function isStoredLocalDatingProfile(
  value: unknown,
): value is StoredLocalDatingProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<LocalDatingProfile> & {
    profile?: Partial<LocalDatingProfile["profile"]> & { name?: string };
  };
  return (
    profile.version === 1 &&
    Array.isArray(profile.intentions) &&
    (typeof profile.profile?.nickname === "string" ||
      typeof profile.profile?.name === "string") &&
    typeof profile.profile?.birthday === "string" &&
    typeof profile.profile?.gender === "string" &&
    Array.isArray(profile.profile?.photos) &&
    typeof profile.profile?.city === "string" &&
    isOptionalString(profile.profile.province) &&
    isOptionalString(profile.profile.country) &&
    typeof profile.profile?.bio === "string" &&
    (profile.profile.interests === undefined ||
      (Array.isArray(profile.profile.interests) &&
        profile.profile.interests.every(
          (interest) => typeof interest === "string",
        ))) &&
    isOptionalString(profile.profile.occupation) &&
    isOptionalString(profile.profile.education) &&
    isOptionalString(profile.profile.height) &&
    isOptionalString(profile.profile.languages) &&
    isOptionalString(profile.profile.exercise) &&
    isOptionalString(profile.profile.smoking) &&
    isOptionalString(profile.profile.drinking) &&
    isOptionalString(profile.profile.children) &&
    isOptionalString(profile.profile.pets) &&
    isOptionalString(profile.profile.perfectSunday) &&
    isOptionalString(profile.profile.greenFlag) &&
    isOptionalString(profile.profile.wantToLearn) &&
    isOptionalString(profile.profile.relationshipVision) &&
    isOptionalString(profile.profile.voiceIntroUri) &&
    Array.isArray(profile.datingDNA?.relationshipGoals) &&
    typeof profile.datingDNA?.communicationStyle === "string" &&
    Array.isArray(profile.datingDNA?.values) &&
    typeof profile.datingDNA?.idealWeekend === "string" &&
    Array.isArray(profile.preferences?.genders) &&
    typeof profile.preferences?.minAge === "number" &&
    typeof profile.preferences?.maxAge === "number" &&
    (profile.preferences.exploreRadiusKm === undefined ||
      typeof profile.preferences.exploreRadiusKm === "number") &&
    (profile.location === undefined ||
      (typeof profile.location === "object" &&
        profile.location !== null &&
        (profile.location.latitude === null ||
          typeof profile.location.latitude === "number") &&
        (profile.location.longitude === null ||
          typeof profile.location.longitude === "number") &&
        (profile.location.source === "manual" ||
          profile.location.source === "gps")))
  );
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

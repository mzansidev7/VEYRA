import { useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  getAgeFromBirthday,
  isAdultBirthday,
  type LocalDatingProfile,
  type OnboardingStep,
} from "../data/localProfile";
import { useProfilePhotoUrls } from "../components/profile/useProfilePhotoUrls";
import { systemColors, type SystemColors } from "../systemColors";
import VeyraLoader from "../reusables/VeyraLoader";
import { BirthdayField } from "./BirthdayField";
import { CityPicker } from "./CityPicker";

type Props = {
  initialProfile: LocalDatingProfile;
  onSave: (profile: LocalDatingProfile) => Promise<LocalDatingProfile>;
  onComplete: () => void;
  initialStep?: Exclude<OnboardingStep, "complete">;
  onCancel?: () => void;
  onAgeRestricted?: () => Promise<void>;
};

const STEPS: Exclude<OnboardingStep, "complete">[] = [
  "intentions",
  "profile",
  "dna",
  "preferences",
];
const INTENTIONS = [
  { label: "Meaningful connection", icon: "♡" },
  { label: "A genuine relationship", icon: "✦" },
  { label: "Taking things slowly", icon: "◷" },
  { label: "Growing together", icon: "↗" },
];
const GENDERS = ["Woman", "Man", "Non-binary", "Self-describe"];
const RELATIONSHIP_GOALS = [
  "Long-term partnership",
  "Marriage",
  "Still figuring it out",
];
const COMMUNICATION_STYLES = [
  "Quality time",
  "Words that mean something",
  "Thoughtful gestures",
  "Open conversations",
];
const VALUES = [
  "Kindness",
  "Curiosity",
  "Family",
  "Adventure",
  "Emotional honesty",
  "A sense of humor",
];
const PREFERENCE_GENDERS = ["Women", "Men", "Non-binary people"];
const PROFILE_INTERESTS = [
  "Art",
  "Books",
  "Cooking",
  "Culture",
  "Fitness",
  "Food",
  "Hiking",
  "Live music",
  "Nature",
  "Travel",
  "Volunteering",
  "Wellness",
];
const LIFESTYLE_OPTIONS = [
  "No",
  "Sometimes",
  "Yes",
  "Prefer not to say",
];
const CHILDREN_OPTIONS = [
  "Have children",
  "Want children",
  "Don't want children",
  "Prefer not to say",
];
const PET_OPTIONS = [
  "Have pets",
  "Love pets",
  "No pets",
  "Prefer not to say",
];
const VOICE_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: "document" as const,
};

export function OnboardingFlow({
  initialProfile,
  onSave,
  onComplete,
  initialStep,
  onCancel,
  onAgeRestricted,
}: Props) {
  const colorScheme = useColorScheme();
  const colors = systemColors[colorScheme === "dark" ? "dark" : "light"];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 250);
  const recordingStarted = useRef(false);
  const voiceIntroUriRef = useRef(initialProfile.profile.voiceIntroUri);
  const [profile, setProfile] = useState(initialProfile);
  const [step, setStep] = useState<Exclude<OnboardingStep, "complete">>(
    initialStep ?? nextStep(initialProfile),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { urls: photoUrls, error: photoLoadError } = useProfilePhotoUrls(
    profile.profile.photos,
  );

  useEffect(() => {
    if (
      recordingStarted.current &&
      !recorderState.isRecording &&
      recorderState.url
    ) {
      recordingStarted.current = false;
      voiceIntroUriRef.current = recorderState.url;
      setProfile((current) => ({
        ...current,
        profile: { ...current.profile, voiceIntroUri: recorderState.url ?? "" },
      }));
    }
  }, [recorderState.isRecording, recorderState.url]);

  const updateProfile = (update: Partial<LocalDatingProfile>) =>
    setProfile((current) => ({ ...current, ...update }));

  const goBack = () => {
    const index = STEPS.indexOf(step);
    if (index > 0) setStep(STEPS[index - 1]);
  };

  const continueOnboarding = async () => {
    const profileToSave = {
      ...profile,
      profile: {
        ...profile.profile,
        voiceIntroUri: voiceIntroUriRef.current,
      },
    };
    const age = step === "profile"
      ? getAgeFromBirthday(profileToSave.profile.birthday)
      : null;
    if (age !== null && age >= 0 && age < 18) {
      if (!onAgeRestricted) {
        setError("VEYRA is for adults 18 and older.");
        return;
      }
      setSaving(true);
      setError("");
      try {
        await onAgeRestricted();
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Your account is not eligible. We couldn’t sign you out.",
        );
      } finally {
        setSaving(false);
      }
      return;
    }
    const validationMessage = validateStep(step, profileToSave);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const savedProfile = await onSave(profileToSave);
      setProfile(savedProfile);
      voiceIntroUriRef.current = savedProfile.profile.voiceIntroUri;
      const currentIndex = STEPS.indexOf(step);
      if (currentIndex === STEPS.length - 1) {
        onComplete();
      } else {
        setStep(STEPS[currentIndex + 1]);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "We couldn’t save your progress. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const removeVoiceIntro = () => {
    voiceIntroUriRef.current = "";
    updateProfile({
      profile: { ...profile.profile, voiceIntroUri: "" },
    });
  };

  const pickPhotos = async () => {
    setError("");
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: Math.max(1, 6 - profile.profile.photos.length),
        quality: 0.8,
      });
      if (!result.canceled) {
        const newPhotos = result.assets.map((asset) => asset.uri);
        updateProfile({
          profile: {
            ...profile.profile,
            photos: [...profile.profile.photos, ...newPhotos].slice(0, 6),
          },
        });
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "We couldn’t open your photos. Please try again.",
      );
    }
  };

  const removePhoto = (uri: string) => {
    updateProfile({
      profile: {
        ...profile.profile,
        photos: profile.profile.photos.filter((photo) => photo !== uri),
      },
    });
  };

  const startVoiceRecording = async () => {
    setError("");
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError("Allow microphone access to record a voice introduction.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recordingStarted.current = true;
      recorder.record({ forDuration: 30 });
    } catch (cause) {
      recordingStarted.current = false;
      setError(
        cause instanceof Error
          ? cause.message
          : "We couldn’t start a voice recording. Please try again.",
      );
    }
  };

  const stopVoiceRecording = async () => {
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        throw new Error("The voice recording could not be saved.");
      }
      recordingStarted.current = false;
      voiceIntroUriRef.current = uri;
      updateProfile({
        profile: { ...profile.profile, voiceIntroUri: uri },
      });
    } catch (cause) {
      recordingStarted.current = false;
      setError(
        cause instanceof Error
          ? cause.message
          : "We couldn’t save your voice recording. Please try again.",
      );
    }
  };

  const toggleArrayValue = (
    current: string[],
    value: string,
    save: (values: string[]) => void,
  ) => {
    save(
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  };

  const stepIndex = STEPS.indexOf(step);
  const titles = {
    intentions: "I’m looking for…",
    profile: "Let’s make it yours",
    dna: "Your Dating DNA",
    preferences: "Who feels right to you?",
  };
  const subtitles = {
    intentions: "Make space for what you really want.",
    profile: "A few thoughtful details help the right people find you.",
    dna: "The little things that make a connection feel like yours.",
    preferences: "Thoughtful introductions start with who you hope to meet.",
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.topRow}>
            {stepIndex > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go back"
                onPress={goBack}
                style={styles.backButton}
              >
                <Text style={styles.backText}>‹</Text>
              </Pressable>
            ) : (
              <View style={styles.backButton} />
            )}
            <Text style={styles.wordmark}>veyra</Text>
            <Text style={styles.stepCount}>
              {String(stepIndex + 1).padStart(2, "0")}{" "}
              <Text style={styles.stepCountDivider}>/ 04</Text>
            </Text>
          </View>

          <View style={styles.progressTrack}>
            {STEPS.map((item, index) => (
              <View
                key={item}
                style={[
                  styles.progressSegment,
                  index <= stepIndex && styles.progressSegmentActive,
                ]}
              />
            ))}
          </View>

          {onCancel ? (
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              style={styles.cancelEditing}
            >
              <Text style={styles.cancelEditingText}>Cancel editing</Text>
            </Pressable>
          ) : null}

          <Text style={styles.eyebrow}>
            {step === "dna" ? "PERSONALITY & VALUES" : "MEET WITH INTENTION"}
          </Text>
          <Text style={styles.title}>{titles[step]}</Text>
          <Text style={styles.subtitle}>{subtitles[step]}</Text>

          {step === "intentions" && (
            <View style={styles.section}>
              <Text style={styles.question}>What are you hoping to find?</Text>
              <Text style={styles.helper}>
                Choose everything that feels right.
              </Text>
              <View style={styles.choiceGrid}>
                {INTENTIONS.map((item) => (
                  <Choice
                    key={item.label}
                    label={item.label}
                    icon={item.icon}
                    selected={profile.intentions.includes(item.label)}
                    styles={styles}
                    onPress={() =>
                      toggleArrayValue(
                        profile.intentions,
                        item.label,
                        (values) =>
                          updateProfile({ intentions: values }),
                      )
                    }
                  />
                ))}
              </View>
              <View style={styles.noteCard}>
                <Text style={styles.noteSymbol}>✦</Text>
                <Text style={styles.noteText}>
                  No games, no rush. Just meaningful introductions, at your
                  pace.
                </Text>
              </View>
            </View>
          )}

          {step === "profile" && (
            <>
              <View style={styles.section}>
                <Text style={styles.question}>Add your pictures</Text>
                <Text style={styles.helper}>
                  Choose up to six photos that feel like you.
                </Text>
                <View style={styles.photoRow}>
                  {profile.profile.photos.map((reference, index) => (
                    <View
                      key={reference}
                      style={[
                        styles.photoTile,
                        index === 0 && styles.featuredPhotoTile,
                      ]}
                    >
                      <Image
                        source={{ uri: photoUrls[index] ?? reference }}
                        style={styles.photo}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Remove photo"
                        onPress={() => removePhoto(reference)}
                        style={styles.removePhoto}
                      >
                        <Text style={styles.removePhotoText}>×</Text>
                      </Pressable>
                    </View>
                  ))}
                  {profile.profile.photos.length < 6 && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void pickPhotos()}
                      style={[
                        styles.addPhoto,
                        profile.profile.photos.length === 0
                          ? styles.addPhotoEmpty
                          : styles.addPhotoMore,
                      ]}
                    >
                      <Text style={styles.addPhotoPlus}>＋</Text>
                      <Text style={styles.addPhotoText}>
                        {profile.profile.photos.length === 0
                          ? "Add your first photo"
                          : "Add more"}
                      </Text>
                    </Pressable>
                  )}
                </View>
                {photoLoadError ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {photoLoadError}
                  </Text>
                ) : null}
              </View>
              <Field
                styles={styles}
                colors={colors}
                label="Nickname"
                value={profile.profile.nickname}
                placeholder="Choose a nickname"
                onChangeText={(nickname) =>
                  updateProfile({
                    profile: { ...profile.profile, nickname },
                  })
                }
              />
              <Text style={styles.helper}>
                Your nickname must be unique and is how people will know you.
              </Text>
              <BirthdayField
                value={profile.profile.birthday}
                onChange={(birthday) =>
                  updateProfile({
                    profile: { ...profile.profile, birthday },
                  })
                }
                colors={colors}
              />
              <Text style={styles.helper}>
                Your birthday stays private. Your age is shown instead.
              </Text>
              <View style={styles.section}>
                <Text style={styles.question}>Gender</Text>
                <View style={styles.choiceGrid}>
                  {GENDERS.map((gender) => (
                    <Choice
                      key={gender}
                      label={gender}
                      selected={profile.profile.gender === gender}
                      styles={styles}
                      onPress={() =>
                        updateProfile({
                          profile: { ...profile.profile, gender },
                        })
                      }
                    />
                  ))}
                </View>
              </View>
              <CityPicker
                city={profile.profile.city}
                province={profile.profile.province}
                colors={colors}
                onSelect={(location) =>
                  setProfile((current) => ({
                    ...current,
                    profile: {
                      ...current.profile,
                      city: location.city,
                      province: location.province,
                      country: location.country,
                    },
                    location: {
                      latitude: location.latitude,
                      longitude: location.longitude,
                      source: location.source,
                    },
                  }))
                }
              />
              <Field
                styles={styles}
                colors={colors}
                label="A little about you"
                value={profile.profile.bio}
                placeholder="What do you hope someone notices about you?"
                multiline
                onChangeText={(bio) =>
                  updateProfile({
                    profile: { ...profile.profile, bio },
                  })
                }
              />
              <Field
                styles={styles}
                colors={colors}
                label="Work or study (optional)"
                value={profile.profile.occupation}
                placeholder="What keeps you curious?"
                onChangeText={(occupation) =>
                  updateProfile({
                    profile: { ...profile.profile, occupation },
                  })
                }
              />
              <Field
                styles={styles}
                colors={colors}
                label="Education (optional)"
                value={profile.profile.education}
                placeholder="Your education"
                onChangeText={(education) =>
                  updateProfile({
                    profile: { ...profile.profile, education },
                  })
                }
              />
              <Field
                styles={styles}
                colors={colors}
                label="Height (optional)"
                value={profile.profile.height}
                placeholder="For example, 170 cm"
                onChangeText={(height) =>
                  updateProfile({
                    profile: { ...profile.profile, height },
                  })
                }
              />
              <Field
                styles={styles}
                colors={colors}
                label="Languages (optional)"
                value={profile.profile.languages}
                placeholder="For example, English, isiZulu"
                onChangeText={(languages) =>
                  updateProfile({
                    profile: { ...profile.profile, languages },
                  })
                }
              />
              <Text style={styles.helper}>
                Separate languages with commas.
              </Text>
              <OptionSection
                styles={styles}
                title="A few things I enjoy (optional)"
                options={PROFILE_INTERESTS}
                selected={profile.profile.interests}
                onToggle={(value) =>
                  toggleArrayValue(
                    profile.profile.interests,
                    value,
                    (interests) =>
                      updateProfile({
                        profile: { ...profile.profile, interests },
                      }),
                  )
                }
              />
              <View style={styles.section}>
                <Text style={styles.question}>A little about my lifestyle</Text>
                <Text style={styles.helper}>
                  These details are optional and can help set expectations.
                </Text>
                <LifestyleChoices
                  label="Exercise"
                  options={LIFESTYLE_OPTIONS}
                  selected={profile.profile.exercise}
                  styles={styles}
                  onSelect={(exercise) =>
                    updateProfile({
                      profile: { ...profile.profile, exercise },
                    })
                  }
                />
                <LifestyleChoices
                  label="Smoking"
                  options={LIFESTYLE_OPTIONS}
                  selected={profile.profile.smoking}
                  styles={styles}
                  onSelect={(smoking) =>
                    updateProfile({
                      profile: { ...profile.profile, smoking },
                    })
                  }
                />
                <LifestyleChoices
                  label="Children"
                  options={CHILDREN_OPTIONS}
                  selected={profile.profile.children}
                  styles={styles}
                  onSelect={(children) =>
                    updateProfile({
                      profile: { ...profile.profile, children },
                    })
                  }
                />
                <LifestyleChoices
                  label="Pets"
                  options={PET_OPTIONS}
                  selected={profile.profile.pets}
                  styles={styles}
                  onSelect={(pets) =>
                    updateProfile({
                      profile: { ...profile.profile, pets },
                    })
                  }
                />
                <LifestyleChoices
                  label="Drinking"
                  options={LIFESTYLE_OPTIONS}
                  selected={profile.profile.drinking}
                  styles={styles}
                  onSelect={(drinking) =>
                    updateProfile({
                      profile: { ...profile.profile, drinking },
                    })
                  }
                />
              </View>
              <View style={styles.section}>
                <Text style={styles.question}>A few conversation starters</Text>
                <Text style={styles.helper}>
                  Answer any that feel like you. They’re all optional.
                </Text>
                <Field
                  styles={styles}
                  colors={colors}
                  label="A perfect Sunday…"
                  value={profile.profile.perfectSunday}
                  placeholder="A slow morning, a long walk…"
                  onChangeText={(perfectSunday) =>
                    updateProfile({
                      profile: { ...profile.profile, perfectSunday },
                    })
                  }
                />
                <Field
                  styles={styles}
                  colors={colors}
                  label="A green flag I value…"
                  value={profile.profile.greenFlag}
                  placeholder="Someone who listens with care…"
                  onChangeText={(greenFlag) =>
                    updateProfile({
                      profile: { ...profile.profile, greenFlag },
                    })
                  }
                />
                <Field
                  styles={styles}
                  colors={colors}
                  label="Something I’d love to learn…"
                  value={profile.profile.wantToLearn}
                  placeholder="How to make fresh pasta…"
                  onChangeText={(wantToLearn) =>
                    updateProfile({
                      profile: { ...profile.profile, wantToLearn },
                    })
                  }
                />
              </View>
              <Field
                styles={styles}
                colors={colors}
                label="What I hope to build with someone (optional)"
                value={profile.profile.relationshipVision}
                placeholder="A relationship where we…"
                multiline
                onChangeText={(relationshipVision) =>
                  updateProfile({
                    profile: { ...profile.profile, relationshipVision },
                  })
                }
              />
              <View style={styles.section}>
                <Text style={styles.question}>
                  Voice introduction (optional)
                </Text>
                <Text style={styles.helper}>
                  Record up to 30 seconds. Your introduction is securely stored
                  with your profile and played back using a private link.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    void (recorderState.isRecording
                      ? stopVoiceRecording()
                      : startVoiceRecording())
                  }
                  style={styles.voiceButton}
                >
                  <Text style={styles.voiceButtonText}>
                    {recorderState.isRecording
                      ? `Stop & save · ${Math.ceil(
                          recorderState.durationMillis / 1000,
                        )}s`
                      : profile.profile.voiceIntroUri
                        ? "Record a new introduction"
                        : "Start recording"}
                  </Text>
                </Pressable>
                {profile.profile.voiceIntroUri && !recorderState.isRecording ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={removeVoiceIntro}
                    style={styles.removeVoiceButton}
                  >
                    <Text style={styles.removeVoiceText}>
                      Remove saved introduction
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          )}

          {step === "dna" && (
            <>
              <OptionSection
                styles={styles}
                title="Which relationship goal feels right for you?"
                options={RELATIONSHIP_GOALS}
                selected={profile.datingDNA.relationshipGoals}
                onToggle={(value) =>
                  toggleArrayValue(
                    profile.datingDNA.relationshipGoals,
                    value,
                    (relationshipGoals) =>
                      updateProfile({
                        datingDNA: {
                          ...profile.datingDNA,
                          relationshipGoals,
                        },
                      }),
                  )
                }
              />
              <OptionSection
                styles={styles}
                title="How do you like to connect?"
                options={COMMUNICATION_STYLES}
                selected={
                  profile.datingDNA.communicationStyle
                    ? [profile.datingDNA.communicationStyle]
                    : []
                }
                onToggle={(communicationStyle) =>
                  updateProfile({
                    datingDNA: {
                      ...profile.datingDNA,
                      communicationStyle:
                        profile.datingDNA.communicationStyle ===
                        communicationStyle
                          ? ""
                          : communicationStyle,
                    },
                  })
                }
              />
              <OptionSection
                styles={styles}
                title="What do you value most?"
                options={VALUES}
                selected={profile.datingDNA.values}
                onToggle={(value) =>
                  toggleArrayValue(
                    profile.datingDNA.values,
                    value,
                    (values) =>
                      updateProfile({
                        datingDNA: { ...profile.datingDNA, values },
                      }),
                  )
                }
              />
              <Field
                styles={styles}
                colors={colors}
                label="Your ideal weekend"
                value={profile.datingDNA.idealWeekend}
                placeholder="A slow coffee, a good walk, and..."
                multiline
                onChangeText={(idealWeekend) =>
                  updateProfile({
                    datingDNA: { ...profile.datingDNA, idealWeekend },
                  })
                }
              />
            </>
          )}

          {step === "preferences" && (
            <>
              <OptionSection
                styles={styles}
                title="Who would you like to meet?"
                options={PREFERENCE_GENDERS}
                selected={profile.preferences.genders}
                onToggle={(value) =>
                  toggleArrayValue(
                    profile.preferences.genders,
                    value,
                    (genders) =>
                      updateProfile({
                        preferences: { ...profile.preferences, genders },
                      }),
                  )
                }
              />
              <View style={styles.section}>
                <Text style={styles.question}>Age range</Text>
                <Text style={styles.helper}>
                  Everyone on VEYRA is 18 or older.
                </Text>
                <View style={styles.ageRange}>
                  <Field
                    styles={styles}
                    colors={colors}
                    label="From"
                    value={String(profile.preferences.minAge)}
                    placeholder="18"
                    keyboardType="number-pad"
                    containerStyle={styles.ageRangeField}
                    onChangeText={(value) =>
                      updateProfile({
                        preferences: {
                          ...profile.preferences,
                          minAge: Number(value) || 0,
                        },
                      })
                    }
                  />
                  <Field
                    styles={styles}
                    colors={colors}
                    label="To"
                    value={String(profile.preferences.maxAge)}
                    placeholder="45"
                    keyboardType="number-pad"
                    containerStyle={styles.ageRangeField}
                    onChangeText={(value) =>
                      updateProfile({
                        preferences: {
                          ...profile.preferences,
                          maxAge: Number(value) || 0,
                        },
                      })
                    }
                  />
                </View>
              </View>
              <View style={styles.noteCard}>
                <Text style={styles.noteSymbol}>♡</Text>
                <Text style={styles.noteText}>
                  Your preferences help shape your Daily 5. You can revisit
                  them any time.
                </Text>
              </View>
            </>
          )}

          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={saving || recorderState.isRecording}
            onPress={() => void continueOnboarding()}
            style={({ pressed }) => [
              styles.continueButton,
              (pressed || saving || recorderState.isRecording) &&
                styles.buttonPressed,
            ]}
          >
            {saving ? (
              <VeyraLoader
                size={12}
                imageWidth={16}
                imageHeight={16}
                imageMarginBottom={0}
                loaderShown={false}
              />
            ) : (
              <Text style={styles.continueText}>
                {step === "preferences" ? "Meet my Daily 5" : "Continue"}
              </Text>
            )}
          </Pressable>
          <Text style={styles.footerText}>
            Your profile and photos are saved securely as you continue.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function nextStep(profile: LocalDatingProfile) {
  if (profile.intentions.length === 0) return "intentions";
  if (
    !profile.profile.nickname.trim() ||
    !isAdultBirthday(profile.profile.birthday) ||
    !profile.profile.gender ||
    !profile.profile.photos.length ||
    !profile.profile.city.trim() ||
    !profile.profile.bio.trim()
  ) {
    return "profile";
  }
  if (
    !profile.datingDNA.relationshipGoals.length ||
    !profile.datingDNA.communicationStyle ||
    !profile.datingDNA.values.length ||
    !profile.datingDNA.idealWeekend.trim()
  ) {
    return "dna";
  }
  return "preferences";
}

function validateStep(
  step: Exclude<OnboardingStep, "complete">,
  profile: LocalDatingProfile,
) {
  if (step === "intentions" && profile.intentions.length === 0) {
    return "Choose at least one intention to continue.";
  }
  if (step === "profile") {
    if (!profile.profile.photos.length) return "Add at least one profile photo.";
    if (!profile.profile.nickname.trim()) {
      return "Choose a nickname to continue.";
    }
    if (!isAdultBirthday(profile.profile.birthday)) {
      return "Enter a valid birthday showing that you’re at least 18.";
    }
    if (!profile.profile.gender) return "Choose the gender that describes you.";
    if (!profile.profile.city.trim()) return "Enter your city to continue.";
    if (!profile.profile.bio.trim()) {
      return "Add a short introduction to your profile.";
    }
  }
  if (step === "dna") {
    if (
      !profile.datingDNA.relationshipGoals.length ||
      !profile.datingDNA.communicationStyle ||
      !profile.datingDNA.values.length ||
      !profile.datingDNA.idealWeekend.trim()
    ) {
      return "Complete each Dating DNA question to continue.";
    }
  }
  if (step === "preferences") {
    if (!profile.preferences.genders.length) {
      return "Choose who you’d like to meet.";
    }
    if (
      profile.preferences.minAge < 18 ||
      profile.preferences.maxAge < profile.preferences.minAge ||
      profile.preferences.maxAge > 99
    ) {
      return "Enter a valid age range between 18 and 99.";
    }
  }
  return "";
}

function Field({
  styles,
  colors,
  label,
  value,
  placeholder,
  onChangeText,
  multiline = false,
  keyboardType = "default",
  containerStyle,
}: {
  styles: OnboardingStyles;
  colors: SystemColors;
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  keyboardType?: "default" | "number-pad" | "numbers-and-punctuation";
  containerStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.question}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[styles.input, multiline && styles.multilineInput]}
      />
    </View>
  );
}

function OptionSection({
  styles,
  title,
  options,
  selected,
  onToggle,
}: {
  styles: OnboardingStyles;
  title: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.question}>{title}</Text>
      <View style={styles.choiceGrid}>
        {options.map((option) => (
          <Choice
            key={option}
            label={option}
            selected={selected.includes(option)}
            styles={styles}
            onPress={() => onToggle(option)}
          />
        ))}
      </View>
    </View>
  );
}

function LifestyleChoices({
  label,
  options,
  selected,
  styles,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: string;
  styles: OnboardingStyles;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={styles.lifestyleSection}>
      <Text style={styles.lifestyleLabel}>{label}</Text>
      <View style={styles.choiceGrid}>
        {options.map((option) => (
          <Choice
            key={option}
            label={option}
            selected={selected === option}
            styles={styles}
            onPress={() => onSelect(selected === option ? "" : option)}
          />
        ))}
      </View>
    </View>
  );
}

function Choice({
  styles,
  label,
  icon,
  selected,
  onPress,
}: {
  styles: OnboardingStyles;
  label: string;
  icon?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected]}
    >
      {icon ? (
        <View style={[styles.choiceIcon, selected && styles.choiceIconSelected]}>
          <Text
            style={[
              styles.choiceIconText,
              selected && styles.choiceIconTextSelected,
            ]}
          >
            {icon}
          </Text>
        </View>
      ) : null}
      <Text
        style={[
          styles.choiceText,
          icon && styles.choiceTextWithIcon,
          selected && styles.choiceTextSelected,
        ]}
      >
        {label}
      </Text>
      <View
        style={[styles.choiceCheck, selected && styles.choiceCheckSelected]}
      >
        {selected ? <Text style={styles.choiceCheckMark}>✓</Text> : null}
      </View>
    </Pressable>
  );
}

const createStyles = (colors: SystemColors) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 34,
  },
  topRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 17,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    backgroundColor: colors.surface,
  },
  backText: {
    color: colors.text,
    fontSize: 25,
    lineHeight: 29,
  },
  wordmark: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  stepCount: {
    minWidth: 48,
    color: colors.like,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
  },
  stepCountDivider: {
    color: colors.textMuted,
    fontWeight: "500",
  },
  progressTrack: {
    flexDirection: "row",
    gap: 5,
    marginBottom: 36,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  cancelEditing: {
    alignSelf: "flex-end",
    paddingVertical: 8,
  },
  cancelEditingText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
  },
  progressSegmentActive: {
    backgroundColor: colors.primary,
  },
  eyebrow: {
    color: colors.like,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.9,
  },
  title: {
    color: colors.text,
    fontFamily: "Georgia",
    fontSize: 31,
    fontWeight: "600",
    letterSpacing: -0.5,
    marginTop: 10,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 9,
    marginBottom: 10,
  },
  section: {
    marginTop: 21,
  },
  question: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 8,
  },
  helper: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: -3,
    marginBottom: 12,
  },
  choiceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
  },
  choice: {
    width: "48.5%",
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  choiceSelected: {
    borderColor: colors.secondary,
    backgroundColor: colors.surfaceSecondary,
  },
  choiceText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "500",
  },
  choiceTextWithIcon: {
    marginLeft: 8,
  },
  choiceTextSelected: {
    color: colors.text,
    fontWeight: "700",
  },
  choiceIcon: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: colors.surfaceSecondary,
  },
  choiceIconSelected: {
    backgroundColor: colors.primary,
  },
  choiceIconText: {
    color: colors.like,
    fontSize: 16,
    fontWeight: "700",
  },
  choiceIconTextSelected: {
    color: colors.textInverse,
  },
  choiceCheck: {
    width: 17,
    height: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    marginLeft: 5,
  },
  choiceCheckSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  choiceCheckMark: {
    color: colors.textInverse,
    fontSize: 10,
    fontWeight: "800",
  },
  noteCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 15,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surfaceSecondary,
    marginTop: 20,
  },
  noteSymbol: {
    color: colors.like,
    fontSize: 19,
  },
  noteText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  field: {
    marginTop: 18,
  },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 13,
    color: colors.text,
    backgroundColor: colors.inputBackground,
    fontSize: 13,
  },
  multilineInput: {
    minHeight: 96,
    paddingVertical: 13,
  },
  photoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 9,
  },
  photoTile: {
    width: "30%",
    height: 124,
    position: "relative",
  },
  featuredPhotoTile: {
    width: "58%",
    height: 220,
  },
  photo: {
    width: "100%",
    height: "100%",
    borderRadius: 17,
    backgroundColor: colors.surfaceSecondary,
  },
  removePhoto: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 23,
    height: 23,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  removePhotoText: {
    color: colors.textInverse,
    fontSize: 17,
    lineHeight: 20,
  },
  addPhoto: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.secondary,
    borderRadius: 17,
    backgroundColor: colors.surfaceSecondary,
  },
  addPhotoEmpty: {
    width: "100%",
    height: 190,
  },
  addPhotoMore: {
    width: "38%",
    height: 124,
  },
  addPhotoPlus: {
    color: colors.like,
    fontSize: 29,
  },
  addPhotoText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 5,
  },
  ageRange: {
    flexDirection: "row",
    gap: 14,
  },
  ageRangeField: {
    flex: 1,
  },
  lifestyleSection: {
    marginTop: 16,
  },
  lifestyleLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
  },
  voiceButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: colors.primary,
  },
  voiceButtonText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: "700",
  },
  removeVoiceButton: {
    alignSelf: "center",
    paddingVertical: 10,
  },
  removeVoiceText: {
    color: colors.error,
    fontSize: 11,
    fontWeight: "600",
  },
  error: {
    color: colors.error,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 15,
  },
  continueButton: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    marginTop: 28,
    backgroundColor: colors.primary,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  continueText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: "700",
  },
  footerText: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: "center",
    marginTop: 13,
  },
});

type OnboardingStyles = ReturnType<typeof createStyles>;

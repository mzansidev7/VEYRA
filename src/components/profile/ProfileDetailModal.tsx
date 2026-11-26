import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import VeyraLoader from "../../reusables/VeyraLoader";
import { useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { deleteLocalFile } from "../../lib/localFile";
import {
  ChevronLeft,
  ChevronRight,
  Bell,
  Heart,
  Mail,
  Camera,
  Fingerprint,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react-native";
import type {
  LocalDatingProfile,
  OnboardingStep,
} from "../../data/localProfile";
import { DEFAULT_PRIVACY_SETTINGS } from "../../asyncStore/profileStore/privacySettingsStore";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationBooleanSetting,
  type NotificationSettings,
} from "../../asyncStore/profileStore/notificationSettingsStore";
import {
  getCachedNotificationSettings,
  getNotificationSettings,
  refreshNotificationSettings,
  saveNotificationSettings,
} from "../../data/notificationSettings";
import {
  deleteOwnAccount,
  getCachedPrivacyData,
  getPrivacyData,
  refreshPrivacyData,
  savePrivacySettings,
  unblockUser,
  unhideProfile,
} from "../../data/privacySettings";
import type {
  PrivacyListEntry,
  PrivacySettings,
} from "../../asyncStore/profileStore/privacySettingsStore";
import {
  DEFAULT_VERIFICATION_DATA,
  type VerificationData,
} from "../../asyncStore/profileStore/verificationSettingsStore";
import {
  getCachedVerificationData,
  getVerificationData,
  refreshVerificationData,
} from "../../data/verificationSettings";
import {
  getVideoDiscoveryAvailability,
  setVideoDiscoveryAvailability,
} from "../../data/videoDiscovery";
import { resendSignupConfirmation } from "../../auth/auth";
import type { SystemColors } from "../../systemColors";
import { IdentityVerifiedBadge } from "../IdentityVerifiedBadge";
import { SupportTicketPanel } from "./SupportTicketPanel";
import { ProfilePhotoGallery } from "../ProfilePhotoGallery";

const PROFILE_ACCENT = "#E98B78";
import type { ProfileStyles } from "./ProfileScreen";
import { useProfilePhotoUrls } from "./useProfilePhotoUrls";

export type ProfilePanel =
  | "preview"
  | "dating-dna"
  | "preferences"
  | "verification"
  | "privacy"
  | "blocked-users"
  | "hidden-profiles"
  | "notifications"
  | "appearance"
  | "help";

type VerificationStep = "email" | "photo" | "identity";

type Props = {
  panel: ProfilePanel | null;
  profile: LocalDatingProfile | null;
  age: number | null;
  colors: SystemColors;
  styles: ProfileStyles;
  identityVerified: boolean;
  onClose: () => void;
  onEditProfile: (step?: Exclude<OnboardingStep, "complete">) => void;
  onAccountDeleted: () => Promise<void>;
  onManageBlockedUsers: () => void;
  onManageHiddenProfiles: () => void;
  userEmail: string | null;
  userId: string | null;
};

export function ProfileDetailModal({
  panel,
  profile,
  age,
  colors,
  styles,
  identityVerified,
  onClose,
  onEditProfile,
  onAccountDeleted,
  onManageBlockedUsers,
  onManageHiddenProfiles,
  userEmail,
  userId,
}: Props) {
  const [privacySettings, setPrivacySettings] = useState(
    DEFAULT_PRIVACY_SETTINGS,
  );
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacySavingKey, setPrivacySavingKey] = useState<
    keyof PrivacySettings | null
  >(null);
  const [privacyError, setPrivacyError] = useState("");
  const [hasPrivacyData, setHasPrivacyData] = useState(false);
  const [videoDiscoveryAvailable, setVideoDiscoveryAvailable] = useState(false);
  const [videoDiscoveryLoading, setVideoDiscoveryLoading] = useState(false);
  const [videoDiscoverySaving, setVideoDiscoverySaving] = useState(false);
  const [videoDiscoveryError, setVideoDiscoveryError] = useState("");
  const [blockedUsers, setBlockedUsers] = useState<PrivacyListEntry[]>([]);
  const [hiddenProfiles, setHiddenProfiles] = useState<PrivacyListEntry[]>([]);
  const [confirmAccountDeletion, setConfirmAccountDeletion] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountDeletionError, setAccountDeletionError] = useState("");
  const [verificationData, setVerificationData] = useState(
    DEFAULT_VERIFICATION_DATA,
  );
  const [verificationLoading, setVerificationLoading] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [hasVerificationData, setHasVerificationData] = useState(false);
  const [verificationStep, setVerificationStep] =
    useState<VerificationStep | null>(null);
  const [notificationSettings, setNotificationSettings] = useState(
    DEFAULT_NOTIFICATION_SETTINGS,
  );
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationHasData, setNotificationHasData] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationError, setNotificationError] = useState("");

  useEffect(() => {
    let active = true;
    if (!userId) {
      if (panel === "verification") {
        setVerificationError("Sign in to view your verification status.");
      }
      return;
    }

    const applyVerificationData = (data: VerificationData) => {
      setVerificationData(data);
      setHasVerificationData(true);
    };

    const loadVerificationData = async () => {
      try {
        const cached = await getCachedVerificationData(userId);
        if (!active) return;
        if (cached) {
          applyVerificationData(cached.data);
          setVerificationLoading(false);
          if (cached.isFresh) {
            return;
          }
          if (panel !== "verification") return;
          try {
            const refreshed = await refreshVerificationData(userId);
            if (active) {
              applyVerificationData(refreshed);
              setVerificationError("");
            }
          } catch (error) {
            setVerificationError(
              error instanceof Error
                ? error.message
                : "Could not refresh verification status.",
            );
          } finally {
            if (active) setVerificationLoading(false);
          }
          return;
        }

        if (panel !== "verification") return;
        const data = await getVerificationData(userId);
        if (active) {
          applyVerificationData(data);
          setVerificationError("");
        }
      } catch (error) {
        if (active) {
          setVerificationError(
            error instanceof Error
              ? error.message
              : "Could not load verification status.",
          );
        }
      } finally {
        if (active) setVerificationLoading(false);
      }
    };

    if (panel === "verification") {
      setVerificationLoading(!hasVerificationData);
      setVerificationError("");
      void loadVerificationData();
    } else {
      void getCachedVerificationData(userId)
        .then((cached) => {
          if (active && cached) applyVerificationData(cached.data);
        })
        .catch((error: unknown) => {
          if (active) {
            setVerificationError(
              error instanceof Error
                ? error.message
                : "Could not read cached verification status.",
            );
          }
        });
    }

    return () => {
      active = false;
    };
  }, [panel, userId]);

  useEffect(() => {
    let active = true;
    if (panel !== "notifications")
      return () => {
        active = false;
      };
    if (!userId) {
      setNotificationError("Sign in to manage notification settings.");
      return () => {
        active = false;
      };
    }

    const applySettings = (settings: NotificationSettings) => {
      setNotificationSettings(settings);
      setNotificationHasData(true);
    };
    setNotificationLoading(!notificationHasData);
    setNotificationError("");

    void getCachedNotificationSettings(userId)
      .then((cached) => {
        if (!active) return;
        if (cached) {
          applySettings(cached.settings);
          setNotificationLoading(false);
          if (cached.isFresh) return;
          void refreshNotificationSettings(userId)
            .then((settings) => {
              if (active) applySettings(settings);
            })
            .catch((error: unknown) => {
              if (active) {
                setNotificationError(
                  error instanceof Error
                    ? error.message
                    : "Could not refresh notification settings.",
                );
              }
            })
            .finally(() => {
              if (active) setNotificationLoading(false);
            });
          return;
        }

        void getNotificationSettings(userId)
          .then((settings) => {
            if (active) applySettings(settings);
          })
          .catch((error: unknown) => {
            if (active) {
              setNotificationError(
                error instanceof Error
                  ? error.message
                  : "Could not load notification settings.",
              );
            }
          })
          .finally(() => {
            if (active) setNotificationLoading(false);
          });
      })
      .catch((error: unknown) => {
        if (active) {
          setNotificationError(
            error instanceof Error
              ? error.message
              : "Could not read notification settings cache.",
          );
          setNotificationLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [panel, userId]);

  const saveNotificationChange = async (
    nextSettings: NotificationSettings,
    previousSettings: NotificationSettings,
  ) => {
    if (!userId || notificationSaving) return;
    setNotificationSettings(nextSettings);
    setNotificationSaving(true);
    setNotificationError("");
    try {
      await saveNotificationSettings(userId, nextSettings);
    } catch (error) {
      setNotificationSettings(previousSettings);
      setNotificationError(
        error instanceof Error
          ? error.message
          : "Could not save notification settings.",
      );
    } finally {
      setNotificationSaving(false);
    }
  };

  const updateNotificationSetting = (
    key: NotificationBooleanSetting,
    enabled: boolean,
  ) => {
    if (notificationSaving) return;
    const previousSettings = notificationSettings;
    void saveNotificationChange(
      { ...previousSettings, [key]: enabled },
      previousSettings,
    );
  };

  const updateQuietHours = async (start: string, end: string) => {
    if (!isValidTime(start) || !isValidTime(end)) {
      setNotificationError("Enter quiet hours using 24-hour HH:MM times.");
      return;
    }
    const previousSettings = notificationSettings;
    await saveNotificationChange(
      {
        ...previousSettings,
        quietHoursStart: start,
        quietHoursEnd: end,
      },
      previousSettings,
    );
  };

  useEffect(() => {
    let active = true;
    if (!userId) {
      if (panel === "privacy") {
        setPrivacyError("Sign in to manage your privacy settings.");
        setPrivacyLoading(false);
      }
      return;
    }

    const applyPrivacyData = (
      data: Awaited<ReturnType<typeof getPrivacyData>>,
    ) => {
      setPrivacySettings(data.settings);
      setBlockedUsers(data.blockedUsers);
      setHiddenProfiles(data.hiddenProfiles);
      setHasPrivacyData(true);
    };

    if (panel !== "privacy") {
      void getCachedPrivacyData(userId)
        .then((cached) => {
          if (active && cached) applyPrivacyData(cached.data);
        })
        .catch((error: unknown) => {
          if (active) {
            setPrivacyError(
              error instanceof Error
                ? error.message
                : "Could not read cached privacy settings.",
            );
          }
        });
      return () => {
        active = false;
      };
    }

    setPrivacyLoading(!hasPrivacyData);
    setPrivacyError("");
    void getCachedPrivacyData(userId)
      .then((cached) => {
        if (!active) return;
        if (cached) {
          applyPrivacyData(cached.data);
          setPrivacyLoading(false);
          if (cached.isFresh) return;

          void refreshPrivacyData(userId)
            .then((data) => {
              if (active) {
                applyPrivacyData(data);
                setPrivacyError("");
              }
            })
            .catch((error: unknown) => {
              if (active) {
                setPrivacyError(
                  error instanceof Error
                    ? error.message
                    : "Could not refresh privacy settings.",
                );
              }
            })
            .finally(() => {
              if (active) setPrivacyLoading(false);
            });
          return;
        }

        void getPrivacyData(userId)
          .then((data) => {
            if (active) {
              applyPrivacyData(data);
              setPrivacyError("");
            }
          })
          .catch((error: unknown) => {
            if (active) {
              setPrivacyError(
                error instanceof Error
                  ? error.message
                  : "Could not load privacy settings.",
              );
            }
          })
          .finally(() => {
            if (active) setPrivacyLoading(false);
          });
      })
      .catch((error: unknown) => {
        if (active) {
          setPrivacyError(
            error instanceof Error
              ? error.message
              : "Could not read cached privacy settings.",
          );
          setPrivacyLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [panel, userId]);

  useEffect(() => {
    let active = true;
    if (panel !== "privacy") return;
    if (!userId) {
      setVideoDiscoveryError("Sign in to manage Video Discovery availability.");
      return;
    }

    setVideoDiscoveryLoading(true);
    setVideoDiscoveryError("");
    void getVideoDiscoveryAvailability()
      .then((available) => {
        if (active) setVideoDiscoveryAvailable(available);
      })
      .catch((error: unknown) => {
        if (active) {
          setVideoDiscoveryError(
            error instanceof Error
              ? error.message
              : "Could not load Video Discovery availability.",
          );
        }
      })
      .finally(() => {
        if (active) setVideoDiscoveryLoading(false);
      });

    return () => {
      active = false;
    };
  }, [panel, userId]);

  const updatePrivacySetting = async (
    key: keyof PrivacySettings,
    enabled: boolean,
  ) => {
    if (!userId || privacySaving) return;
    const previousSettings = privacySettings;
    const updatedSettings = { ...privacySettings, [key]: enabled };
    setPrivacySettings(updatedSettings);
    setPrivacySaving(true);
    setPrivacySavingKey(key);
    setPrivacyError("");
    try {
      await savePrivacySettings(userId, updatedSettings);
    } catch (error) {
      setPrivacySettings(previousSettings);
      setPrivacyError(
        error instanceof Error
          ? error.message
          : "Could not save privacy settings.",
      );
    } finally {
      setPrivacySaving(false);
      setPrivacySavingKey(null);
    }
  };

  const updateVideoDiscoveryAvailability = async (enabled: boolean) => {
    if (!userId || videoDiscoverySaving) return;
    const previousAvailability = videoDiscoveryAvailable;
    setVideoDiscoveryAvailable(enabled);
    setVideoDiscoverySaving(true);
    setVideoDiscoveryError("");
    try {
      await setVideoDiscoveryAvailability(enabled);
    } catch (error) {
      setVideoDiscoveryAvailable(previousAvailability);
      setVideoDiscoveryError(
        error instanceof Error
          ? error.message
          : "Could not update Video Discovery availability.",
      );
    } finally {
      setVideoDiscoverySaving(false);
    }
  };

  const removeBlockedUser = async (blockedUserId: string) => {
    if (!userId || privacySaving) return;
    setPrivacySaving(true);
    setPrivacyError("");
    try {
      await unblockUser(userId, blockedUserId);
      setBlockedUsers((current) =>
        current.filter((entry) => entry.userId !== blockedUserId),
      );
    } catch (error) {
      setPrivacyError(
        error instanceof Error ? error.message : "Could not unblock this user.",
      );
    } finally {
      setPrivacySaving(false);
    }
  };

  const removeHiddenProfile = async (hiddenUserId: string) => {
    if (!userId || privacySaving) return;
    setPrivacySaving(true);
    setPrivacyError("");
    try {
      await unhideProfile(userId, hiddenUserId);
      setHiddenProfiles((current) =>
        current.filter((entry) => entry.userId !== hiddenUserId),
      );
    } catch (error) {
      setPrivacyError(
        error instanceof Error
          ? error.message
          : "Could not unhide this profile.",
      );
    } finally {
      setPrivacySaving(false);
    }
  };

  const confirmDeleteAccount = async () => {
    if (!userId || deletingAccount) return;
    setDeletingAccount(true);
    setAccountDeletionError("");
    try {
      await deleteOwnAccount();
    } catch (error) {
      setAccountDeletionError(
        error instanceof Error
          ? error.message
          : "Could not delete your account.",
      );
      setDeletingAccount(false);
      return;
    }

    setConfirmAccountDeletion(false);
    try {
      await onAccountDeleted();
    } catch (error) {
      setAccountDeletionError(
        error instanceof Error
          ? `Your account was deleted, but local sign-out could not complete: ${error.message}`
          : "Your account was deleted, but local sign-out could not complete.",
      );
    } finally {
      setDeletingAccount(false);
    }
  };

  if (!panel) return null;
  const title =
    panel === "blocked-users"
      ? `Blocked Users (${blockedUsers.length})`
      : panel === "hidden-profiles"
        ? `Hidden Profiles (${hiddenProfiles.length})`
        : getPanelTitle(panel);

  return (
    <>
      <Modal
        animationType="slide"
        onRequestClose={onClose}
        presentationStyle="pageSheet"
        visible
      >
        <SafeAreaView style={styles.modalScreen}>
          {panel === "blocked-users" || panel === "hidden-profiles" ? (
            <View style={styles.memberListHeader}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to privacy settings"
                onPress={onClose}
                style={styles.memberListBack}
              >
                <ChevronLeft color={colors.text} size={23} />
              </Pressable>
              <Text style={styles.memberListHeaderTitle}>{title}</Text>
              <View style={styles.memberListHeaderSpacer} />
            </View>
          ) : (
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{title}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onClose}
                style={styles.modalClose}
              >
                <X color={colors.textSecondary} size={20} />
              </Pressable>
            </View>
          )}
          <ScrollView
            contentContainerStyle={styles.modalContent}
            showsVerticalScrollIndicator={false}
          >
            {panel === "preview" && profile ? (
              <ProfilePreview
                profile={profile}
                age={age}
                colors={colors}
                identityVerified={identityVerified}
                styles={styles}
                onEdit={() => onEditProfile("profile")}
              />
            ) : null}
            {panel === "dating-dna" && profile ? (
              <DatingDnaPanel
                profile={profile}
                colors={colors}
                styles={styles}
                onEdit={() => onEditProfile("dna")}
              />
            ) : null}
            {panel === "preferences" && profile ? (
              <PreferencesPanel
                profile={profile}
                colors={colors}
                styles={styles}
                onEdit={() => onEditProfile("preferences")}
              />
            ) : null}
            {panel === "verification" ? (
              <VerificationPanel
                data={verificationData}
                loading={verificationLoading}
                hasData={hasVerificationData}
                error={verificationError}
                colors={colors}
                styles={styles}
                onSelect={(step) => setVerificationStep(step)}
              />
            ) : null}
            {panel === "privacy" ? (
              <PrivacySettingsPanel
                settings={privacySettings}
                loading={privacyLoading}
                hasData={hasPrivacyData}
                saving={privacySaving}
                savingKey={privacySavingKey}
                error={privacyError}
                videoDiscoveryAvailable={videoDiscoveryAvailable}
                videoDiscoveryLoading={videoDiscoveryLoading}
                videoDiscoverySaving={videoDiscoverySaving}
                videoDiscoveryError={videoDiscoveryError}
                blockedUsers={blockedUsers}
                hiddenProfiles={hiddenProfiles}
                confirmAccountDeletion={confirmAccountDeletion}
                deletingAccount={deletingAccount}
                accountDeletionError={accountDeletionError}
                colors={colors}
                styles={styles}
                onChange={updatePrivacySetting}
                onVideoDiscoveryAvailabilityChange={
                  updateVideoDiscoveryAvailability
                }
                onManageBlockedUsers={onManageBlockedUsers}
                onManageHiddenProfiles={onManageHiddenProfiles}
                onRequestAccountDeletion={() => {
                  setAccountDeletionError("");
                  setConfirmAccountDeletion(true);
                }}
                onCancelAccountDeletion={() => setConfirmAccountDeletion(false)}
                onConfirmAccountDeletion={() => void confirmDeleteAccount()}
              />
            ) : null}
            {panel === "blocked-users" ? (
              <PrivacyMemberGrid
                entries={blockedUsers}
                kind="blocked"
                loading={privacyLoading}
                error={privacyError}
                styles={styles}
                colors={colors}
                onRemove={removeBlockedUser}
                disabled={privacySaving}
              />
            ) : null}
            {panel === "hidden-profiles" ? (
              <PrivacyMemberGrid
                entries={hiddenProfiles}
                kind="hidden"
                loading={privacyLoading}
                error={privacyError}
                styles={styles}
                colors={colors}
                onRemove={removeHiddenProfile}
                disabled={privacySaving}
              />
            ) : null}
            {panel === "notifications" ? (
              <NotificationSettingsPanel
                settings={notificationSettings}
                loading={notificationLoading}
                hasData={notificationHasData}
                saving={notificationSaving}
                error={notificationError}
                colors={colors}
                styles={styles}
                onChange={updateNotificationSetting}
                onSaveQuietHours={(start, end) =>
                  void updateQuietHours(start, end)
                }
              />
            ) : null}
            {panel === "appearance" ? (
              <StatusPanel
                icon={SlidersHorizontal}
                title="Appearance follows your device"
                body="VEYRA uses your system appearance and adapts this screen to light or dark mode automatically."
                colors={colors}
                styles={styles}
              />
            ) : null}
            {panel === "help" ? (
              <SupportTicketPanel userId={userId} colors={colors} />
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <VerificationStepModal
        step={verificationStep}
        email={userEmail}
        data={verificationData}
        colors={colors}
        styles={styles}
        onClose={() => setVerificationStep(null)}
      />
    </>
  );
}

function ProfilePreview({
  profile,
  age,
  colors,
  identityVerified,
  styles,
  onEdit,
}: {
  profile: LocalDatingProfile;
  age: number | null;
  colors: SystemColors;
  identityVerified: boolean;
  styles: ProfileStyles;
  onEdit: () => void;
}) {
  const nickname = profile.profile.nickname.trim() || "Your nickname";
  const { urls, error } = useProfilePhotoUrls(profile.profile.photos);
  const prompts = [
    ["A perfect Sunday…", profile.profile.perfectSunday],
    ["A green flag I value…", profile.profile.greenFlag],
    ["Something I’d love to learn…", profile.profile.wantToLearn],
    ["What I hope to build", profile.profile.relationshipVision],
  ].filter((item) => item[1].trim());

  return (
    <>
      <ProfilePhotoGallery
        photos={urls}
        height={320}
        accentColor={colors.primary}
        surfaceColor={colors.surfaceSecondary}
        borderColor={colors.border}
        textColor={colors.textSecondary}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.photoLoadError}>
          {error}
        </Text>
      ) : null}
      <View style={styles.previewNameLine}>
        <Text style={styles.previewName}>
          {nickname}
          {age ? `, ${age}` : ""}
        </Text>
        {identityVerified ? (
          <IdentityVerifiedBadge colors={colors} compact />
        ) : null}
      </View>
      <Text style={styles.previewLocation}>
        {profile.profile.city.trim() || "Location not added"}
      </Text>
      <DetailBlock
        title="About me"
        value={
          profile.profile.bio || "Add a short introduction to your profile."
        }
        styles={styles}
      />
      {profile.profile.occupation.trim() ? (
        <DetailBlock
          title="Occupation"
          value={profile.profile.occupation}
          styles={styles}
        />
      ) : null}
      <DetailBlock
        title="Basics"
        value={
          [
            profile.profile.education,
            profile.profile.height,
            profile.profile.languages
              ? `Speaks ${profile.profile.languages}`
              : "",
          ]
            .filter(Boolean)
            .join(" · ") ||
          "Add education, height, or languages to your profile."
        }
        styles={styles}
      />
      <DetailBlock
        title="Lifestyle"
        value={
          [
            profile.profile.exercise
              ? `Exercise: ${profile.profile.exercise}`
              : "",
            profile.profile.smoking
              ? `Smoking: ${profile.profile.smoking}`
              : "",
            profile.profile.drinking
              ? `Drinking: ${profile.profile.drinking}`
              : "",
            profile.profile.children
              ? `Children: ${profile.profile.children}`
              : "",
            profile.profile.pets ? `Pets: ${profile.profile.pets}` : "",
          ]
            .filter(Boolean)
            .join(" · ") || "Add any lifestyle details you’d like to share."
        }
        styles={styles}
      />
      {profile.profile.interests.length ? (
        <View style={styles.detailBlock}>
          <Text style={styles.detailLabel}>Interests</Text>
          <View style={styles.chipRow}>
            {profile.profile.interests.map((interest) => (
              <Text key={interest} style={styles.chip}>
                {interest}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
      {prompts.map(([prompt, answer]) => (
        <DetailBlock
          key={prompt}
          title={prompt}
          value={answer}
          styles={styles}
        />
      ))}
      <Pressable onPress={onEdit} style={styles.modalAction}>
        <Text style={styles.modalActionText}>Edit profile</Text>
      </Pressable>
      <Text style={styles.previewNote}>
        This preview uses the information you’ve added. Profile discovery is not
        available yet.
      </Text>
    </>
  );
}

function DatingDnaPanel({
  profile,
  colors,
  styles,
  onEdit,
}: {
  profile: LocalDatingProfile;
  colors: SystemColors;
  styles: ProfileStyles;
  onEdit: () => void;
}) {
  return (
    <>
      <View style={styles.panelIntro}>
        <Sparkles color={PROFILE_ACCENT} size={22} />
        <Text style={styles.panelIntroTitle}>
          The things that make connection feel like yours.
        </Text>
      </View>
      <DetailBlock
        title="Relationship goals"
        value={
          profile.datingDNA.relationshipGoals.join(" · ") || "Not added yet"
        }
        styles={styles}
      />
      <DetailBlock
        title="Connection style"
        value={profile.datingDNA.communicationStyle || "Not added yet"}
        styles={styles}
      />
      <DetailBlock
        title="What you value"
        value={profile.datingDNA.values.join(" · ") || "Not added yet"}
        styles={styles}
      />
      <DetailBlock
        title="An ideal weekend"
        value={profile.datingDNA.idealWeekend || "Not added yet"}
        styles={styles}
      />
      <Pressable onPress={onEdit} style={styles.modalAction}>
        <Text style={styles.modalActionText}>Edit Dating DNA</Text>
      </Pressable>
    </>
  );
}

function PreferencesPanel({
  profile,
  colors,
  styles,
  onEdit,
}: {
  profile: LocalDatingProfile;
  colors: SystemColors;
  styles: ProfileStyles;
  onEdit: () => void;
}) {
  return (
    <>
      <View style={styles.panelIntro}>
        <Heart color={PROFILE_ACCENT} size={22} />
        <Text style={styles.panelIntroTitle}>
          Your preferences help shape the introductions you receive.
        </Text>
      </View>
      <DetailBlock
        title="Age range"
        value={`${profile.preferences.minAge}–${profile.preferences.maxAge}`}
        styles={styles}
      />
      <DetailBlock
        title="Interested in"
        value={profile.preferences.genders.join(" · ") || "Not added yet"}
        styles={styles}
      />
      <DetailBlock
        title="Intentions"
        value={profile.intentions.join(" · ") || "Not added yet"}
        styles={styles}
      />
      <Text style={styles.previewNote}>
        Distance preferences are not available yet.
      </Text>
      <Pressable onPress={onEdit} style={styles.modalAction}>
        <Text style={styles.modalActionText}>Edit preferences</Text>
      </Pressable>
    </>
  );
}

function PrivacySettingsPanel({
  settings,
  loading,
  hasData,
  saving,
  savingKey,
  error,
  videoDiscoveryAvailable,
  videoDiscoveryLoading,
  videoDiscoverySaving,
  videoDiscoveryError,
  blockedUsers,
  hiddenProfiles,
  confirmAccountDeletion,
  deletingAccount,
  accountDeletionError,
  colors,
  styles,
  onChange,
  onVideoDiscoveryAvailabilityChange,
  onManageBlockedUsers,
  onManageHiddenProfiles,
  onRequestAccountDeletion,
  onCancelAccountDeletion,
  onConfirmAccountDeletion,
}: {
  settings: PrivacySettings;
  loading: boolean;
  hasData: boolean;
  saving: boolean;
  savingKey: keyof PrivacySettings | null;
  error: string;
  videoDiscoveryAvailable: boolean;
  videoDiscoveryLoading: boolean;
  videoDiscoverySaving: boolean;
  videoDiscoveryError: string;
  blockedUsers: PrivacyListEntry[];
  hiddenProfiles: PrivacyListEntry[];
  confirmAccountDeletion: boolean;
  deletingAccount: boolean;
  accountDeletionError: string;
  colors: SystemColors;
  styles: ProfileStyles;
  onChange: (key: keyof PrivacySettings, enabled: boolean) => void;
  onVideoDiscoveryAvailabilityChange: (enabled: boolean) => void;
  onManageBlockedUsers: () => void;
  onManageHiddenProfiles: () => void;
  onRequestAccountDeletion: () => void;
  onCancelAccountDeletion: () => void;
  onConfirmAccountDeletion: () => void;
}) {
  const sections: {
    title: string;
    options: {
      key: keyof PrivacySettings;
      title: string;
      description: string;
    }[];
  }[] = [
    {
      title: "Discovery settings",
      options: [
        {
          key: "discoverable",
          title: "Show my profile",
          description: "Allow eligible members to discover your profile.",
        },
        {
          key: "showInDailyFive",
          title: "Show me in Daily 5",
          description: "Include you in curated daily matches.",
        },
        {
          key: "showInExplore",
          title: "Show me in Explore",
          description: "Allow eligible members to find you while browsing.",
        },
        {
          key: "showDistance",
          title: "Show my distance",
          description: "Display an approximate distance from you.",
        },
        {
          key: "showOnlineStatus",
          title: "Show my online status",
          description:
            "Let eligible members and matches know when you’re active.",
        },
        {
          key: "showLastActive",
          title: "Show last active",
          description: "Display when you were last active.",
        },
      ],
    },
    {
      title: "Profile visibility",
      options: [
        {
          key: "incognitoMode",
          title: "Browse profiles incognito",
          description:
            "Your profile visits won’t appear in other members’ visitor lists.",
        },
        {
          key: "profileVisitorHistoryEnabled",
          title: "Profile visitor history",
          description:
            "Collect new visits to your profile and show them in Visitors.",
        },
        {
          key: "showAge",
          title: "Show my age",
          description: "Display your age on your profile.",
        },
        {
          key: "showCity",
          title: "Show my city",
          description: "Display your city, never your exact location.",
        },
        {
          key: "showVoiceIntro",
          title: "Show my voice introduction",
          description: "Let people hear your introduction on your profile.",
        },
        {
          key: "showCompatibilityScore",
          title: "Show compatibility",
          description: "Display your compatibility score.",
        },
        {
          key: "showVerificationBadge",
          title: "Show verification badge",
          description: "Display your verification status when available.",
        },
        {
          key: "allowProfileSharing",
          title: "Allow profile sharing",
          description: "Let people share your profile with others.",
        },
      ],
    },
    {
      title: "Messaging privacy",
      options: [
        {
          key: "messagesFromMatchesOnly",
          title: "Messages from matches only",
          description: "Only allow people you match with to message you.",
        },
        {
          key: "allowVoiceMessages",
          title: "Allow voice messages",
          description: "Let your matches send you voice messages.",
        },
        {
          key: "readReceipts",
          title: "Show read receipts",
          description: "Let matches know when you’ve read their messages.",
        },
      ],
    },
  ];

  return (
    <>
      <View style={styles.privacyNotice}>
        <Text style={styles.privacyNoticeText}>
          Your preferences are saved to your account and applied to the
          corresponding VEYRA features.
        </Text>
      </View>
      {loading ? (
        <Text style={styles.privacyStatus}>Loading your privacy settings…</Text>
      ) : (
        sections.map((section) => (
          <View key={section.title}>
            <Text style={styles.privacySectionTitle}>{section.title}</Text>
            <View style={styles.privacyGroup}>
              {section.options.map((option, index) => (
                <View
                  key={option.key}
                  style={[
                    styles.privacyRow,
                    index === section.options.length - 1 &&
                      styles.privacyRowLast,
                  ]}
                >
                  <View style={styles.privacyCopy}>
                    <Text style={styles.privacyTitle}>{option.title}</Text>
                    <Text style={styles.privacyDescription}>
                      {option.description}
                    </Text>
                  </View>
                  {option.key === savingKey ? (
                    <VeyraLoader
                      size={12}
                      imageWidth={16}
                      imageHeight={16}
                      imageMarginBottom={0}
                      loaderShown={false}
                    />
                  ) : (
                    <Switch
                      accessibilityLabel={option.title}
                      disabled={
                        (Boolean(error) && !hasData) || option.key === savingKey
                      }
                      onValueChange={(enabled) => onChange(option.key, enabled)}
                      trackColor={{
                        false: colors.border,
                        true: PROFILE_ACCENT,
                      }}
                      thumbColor={colors.card}
                      value={settings[option.key]}
                    />
                  )}
                </View>
              ))}
            </View>
          </View>
        ))
      )}
      <Text style={styles.privacySectionTitle}>Video Discovery</Text>
      <View style={styles.privacyGroup}>
        <View style={[styles.privacyRow, styles.privacyRowLast]}>
          <View style={styles.privacyCopy}>
            <Text style={styles.privacyTitle}>Available for video</Text>
            <Text style={styles.privacyDescription}>
              Let eligible members invite you to a video introduction. You can
              turn this off at any time.
            </Text>
          </View>
          {videoDiscoveryLoading || videoDiscoverySaving ? (
            <VeyraLoader
              size={12}
              imageWidth={16}
              imageHeight={16}
              imageMarginBottom={0}
              loaderShown={false}
            />
          ) : (
            <Switch
              accessibilityLabel="Video Discovery availability"
              disabled={videoDiscoveryLoading || videoDiscoverySaving}
              onValueChange={onVideoDiscoveryAvailabilityChange}
              trackColor={{ false: colors.border, true: PROFILE_ACCENT }}
              thumbColor={colors.card}
              value={videoDiscoveryAvailable}
            />
          )}
        </View>
      </View>
      {videoDiscoveryError ? (
        <Text style={styles.privacyError}>{videoDiscoveryError}</Text>
      ) : null}
      {error ? <Text style={styles.privacyError}>{error}</Text> : null}
      <Text style={styles.privacySectionTitle}>Safety & recommendations</Text>
      <View style={styles.privacyGroup}>
        <PrivacyListLink
          title="Blocked users"
          subtitle="Manage people you’ve blocked"
          count={blockedUsers.length}
          colors={colors}
          styles={styles}
          onPress={onManageBlockedUsers}
        />
        <PrivacyListLink
          title="Hidden profiles"
          subtitle="Manage profiles hidden from recommendations"
          count={hiddenProfiles.length}
          colors={colors}
          styles={styles}
          onPress={onManageHiddenProfiles}
          isLast
        />
      </View>
      <Text style={styles.privacySectionTitle}>Account deletion</Text>
      <View style={styles.privacyNotice}>
        <Text style={styles.privacyNoticeText}>
          Deleting your account permanently removes your profile and private
          profile media. This action cannot be undone.
        </Text>
      </View>
      {confirmAccountDeletion ? (
        <View style={styles.deleteConfirmation}>
          <Text style={styles.deleteConfirmationTitle}>
            Permanently delete your account?
          </Text>
          <Text style={styles.deleteConfirmationBody}>
            Your account and profile data will be removed. You’ll be signed out
            and won’t be able to recover this account.
          </Text>
          <View style={styles.deleteActions}>
            <Pressable
              accessibilityRole="button"
              disabled={deletingAccount}
              onPress={onCancelAccountDeletion}
              style={styles.deleteCancelButton}
            >
              <Text style={styles.deleteCancelText}>Keep my account</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={deletingAccount}
              onPress={onConfirmAccountDeletion}
              style={styles.deleteConfirmButton}
            >
              <Text style={styles.deleteConfirmText}>
                {deletingAccount ? "Deleting…" : "Delete permanently"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={onRequestAccountDeletion}
          style={styles.deleteAccountButton}
        >
          <Text style={styles.deleteAccountText}>Delete my account</Text>
        </Pressable>
      )}
      {accountDeletionError ? (
        <Text style={styles.privacyError}>{accountDeletionError}</Text>
      ) : null}
    </>
  );
}

type NotificationOption = {
  key: NotificationBooleanSetting;
  title: string;
  description: string;
};

function NotificationSettingsPanel({
  settings,
  loading,
  hasData,
  saving,
  error,
  colors,
  styles,
  onChange,
  onSaveQuietHours,
}: {
  settings: NotificationSettings;
  loading: boolean;
  hasData: boolean;
  saving: boolean;
  error: string;
  colors: SystemColors;
  styles: ProfileStyles;
  onChange: (key: NotificationBooleanSetting, enabled: boolean) => void;
  onSaveQuietHours: (start: string, end: string) => void;
}) {
  const [quietHoursStart, setQuietHoursStart] = useState(
    settings.quietHoursStart,
  );
  const [quietHoursEnd, setQuietHoursEnd] = useState(settings.quietHoursEnd);

  useEffect(() => {
    setQuietHoursStart(settings.quietHoursStart);
    setQuietHoursEnd(settings.quietHoursEnd);
  }, [settings.quietHoursStart, settings.quietHoursEnd]);

  const sections: { title: string; options: NotificationOption[] }[] = [
    {
      title: "Delivery",
      options: [
        {
          key: "pushEnabled",
          title: "Push notifications",
          description: "Receive notifications on your device.",
        },
        {
          key: "emailEnabled",
          title: "Email notifications",
          description: "Allow eligible notifications to arrive by email.",
        },
        {
          key: "inAppEnabled",
          title: "In-app notifications",
          description: "Show notifications inside VEYRA.",
        },
        {
          key: "showNotificationPreview",
          title: "Notification previews",
          description: "Show message content in lock-screen notifications.",
        },
      ],
    },
    {
      title: "Dating activity",
      options: [
        {
          key: "newLikes",
          title: "New likes",
          description: "When someone likes your profile.",
        },
        {
          key: "newMatches",
          title: "New matches",
          description: "When you make a new connection.",
        },
        {
          key: "dailyFive",
          title: "Daily 5",
          description: "When your curated matches are ready.",
        },
        {
          key: "profileActivity",
          title: "Profile activity",
          description: "Relevant profile and interaction updates.",
        },
      ],
    },
    {
      title: "Messages & dates",
      options: [
        {
          key: "newMessages",
          title: "New messages",
          description: "When a match sends you a message.",
        },
        {
          key: "voiceMessages",
          title: "Voice messages",
          description: "When someone sends a voice message.",
        },
        {
          key: "dateInvitations",
          title: "Date invitations",
          description: "When someone sends a date invitation.",
        },
        {
          key: "upcomingDates",
          title: "Upcoming dates",
          description: "Reminders for planned dates.",
        },
      ],
    },
    {
      title: "Reminders",
      options: [
        {
          key: "datingReminders",
          title: "Dating reminders",
          description: "Gentle reminders to explore your connections.",
        },
      ],
    },
    {
      title: "Account & safety",
      options: [
        {
          key: "verificationUpdates",
          title: "Verification updates",
          description: "Identity and photo verification results.",
        },
      ],
    },
    {
      title: "Promotions",
      options: [
        {
          key: "productUpdates",
          title: "News and updates",
          description: "New VEYRA features and announcements.",
        },
        {
          key: "promotions",
          title: "Offers and promotions",
          description: "Special offers and subscription promotions.",
        },
      ],
    },
  ];

  return (
    <>
      <View style={styles.notificationIntro}>
        <Text style={styles.notificationIntroTitle}>
          Choose what you want to hear about
        </Text>
        <Text style={styles.notificationIntroCopy}>
          Your preferences are saved to your account and can be changed anytime.
          Notification delivery will be connected separately.
        </Text>
      </View>
      {loading && !hasData ? (
        <Text style={styles.privacyStatus}>
          Loading your notification settings…
        </Text>
      ) : (
        <>
          {sections.map((section) => (
            <View key={section.title}>
              <Text style={styles.privacySectionTitle}>{section.title}</Text>
              <View style={styles.notificationGroup}>
                {section.options.map((option, index) => (
                  <NotificationToggle
                    key={option.key}
                    option={option}
                    value={settings[option.key]}
                    colors={colors}
                    styles={styles}
                    disabled={saving || (Boolean(error) && !hasData)}
                    onChange={onChange}
                    isLast={index === section.options.length - 1}
                  />
                ))}
                {section.title === "Reminders" ? (
                  <View style={styles.notificationQuietHours}>
                    <Text style={styles.notificationQuietTitle}>
                      Quiet hours
                    </Text>
                    <Text style={styles.notificationQuietDescription}>
                      Mute non-essential notifications during these hours.
                      Essential security alerts are always on.
                    </Text>
                    <View style={styles.notificationQuietToggle}>
                      <Text style={styles.notificationTitle}>
                        Enable quiet hours
                      </Text>
                      <Switch
                        accessibilityLabel="Enable quiet hours"
                        disabled={saving || (Boolean(error) && !hasData)}
                        onValueChange={(enabled) =>
                          onChange("quietHoursEnabled", enabled)
                        }
                        trackColor={{
                          false: colors.border,
                          true: PROFILE_ACCENT,
                        }}
                        thumbColor={colors.card}
                        value={settings.quietHoursEnabled}
                      />
                    </View>
                    <View style={styles.notificationTimeRow}>
                      <View style={styles.notificationTimeField}>
                        <Text style={styles.notificationTimeLabel}>From</Text>
                        <TextInput
                          accessibilityLabel="Quiet hours start time"
                          editable={
                            settings.quietHoursEnabled &&
                            !saving &&
                            (hasData || !error)
                          }
                          keyboardType="numbers-and-punctuation"
                          maxLength={5}
                          onChangeText={setQuietHoursStart}
                          onEndEditing={() =>
                            onSaveQuietHours(quietHoursStart, quietHoursEnd)
                          }
                          placeholder="22:00"
                          placeholderTextColor={colors.textMuted}
                          style={styles.notificationTimeInput}
                          value={quietHoursStart}
                        />
                      </View>
                      <View style={styles.notificationTimeField}>
                        <Text style={styles.notificationTimeLabel}>Until</Text>
                        <TextInput
                          accessibilityLabel="Quiet hours end time"
                          editable={
                            settings.quietHoursEnabled &&
                            !saving &&
                            (hasData || !error)
                          }
                          keyboardType="numbers-and-punctuation"
                          maxLength={5}
                          onChangeText={setQuietHoursEnd}
                          onEndEditing={() =>
                            onSaveQuietHours(quietHoursStart, quietHoursEnd)
                          }
                          placeholder="07:00"
                          placeholderTextColor={colors.textMuted}
                          style={styles.notificationTimeInput}
                          value={quietHoursEnd}
                        />
                      </View>
                    </View>
                    <Text style={styles.notificationTimeHint}>
                      Use 24-hour time (HH:MM). Times are saved when you leave a
                      field.
                    </Text>
                  </View>
                ) : null}
                {section.title === "Account & safety" ? (
                  <View style={styles.notificationSecurityRow}>
                    <View style={styles.privacyCopy}>
                      <Text style={styles.notificationTitle}>
                        Security alerts
                      </Text>
                      <Text style={styles.privacyDescription}>
                        Important account and security activity. These alerts
                        cannot be turned off.
                      </Text>
                    </View>
                    <Text style={styles.notificationAlwaysOn}>Always on</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ))}
          <View style={styles.privacyNotice}>
            <Text style={styles.privacyNoticeText}>
              Security alerts remain enabled regardless of quiet hours or
              promotional preferences. Changing preferences does not yet
              register a device for push notifications or control delivery.
            </Text>
          </View>
        </>
      )}
      {error ? <Text style={styles.privacyError}>{error}</Text> : null}
      {saving ? (
        <Text style={styles.privacyStatus}>Saving your changes…</Text>
      ) : null}
    </>
  );
}

function NotificationToggle({
  option,
  value,
  colors,
  styles,
  disabled,
  onChange,
  isLast,
}: {
  option: NotificationOption;
  value: boolean;
  colors: SystemColors;
  styles: ProfileStyles;
  disabled: boolean;
  onChange: (key: NotificationBooleanSetting, enabled: boolean) => void;
  isLast: boolean;
}) {
  return (
    <View
      style={[styles.notificationRow, isLast && styles.notificationRowLast]}
    >
      <View style={styles.privacyCopy}>
        <Text style={styles.notificationTitle}>{option.title}</Text>
        <Text style={styles.privacyDescription}>{option.description}</Text>
      </View>
      <Switch
        accessibilityLabel={option.title}
        disabled={disabled}
        onValueChange={(enabled) => onChange(option.key, enabled)}
        trackColor={{ false: colors.border, true: PROFILE_ACCENT }}
        thumbColor={colors.card}
        value={value}
      />
    </View>
  );
}

function PrivacyListLink({
  title,
  subtitle,
  count,
  colors,
  styles,
  onPress,
  isLast = false,
}: {
  title: string;
  subtitle: string;
  count: number;
  colors: SystemColors;
  styles: ProfileStyles;
  onPress: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${count} members`}
      onPress={onPress}
      style={[styles.privacyListLink, isLast && styles.privacyRowLast]}
    >
      <View style={styles.privacyListLinkCopy}>
        <Text style={styles.privacyTitle}>{title}</Text>
        <Text style={styles.privacyDescription}>{subtitle}</Text>
      </View>
      <View style={styles.privacyListCount}>
        <Text style={styles.privacyListCountText}>{count}</Text>
      </View>
      <ChevronRight color={colors.textMuted} size={18} />
    </Pressable>
  );
}

function PrivacyMemberGrid({
  entries,
  kind,
  loading,
  error,
  styles,
  colors,
  disabled,
  onRemove,
}: {
  entries: PrivacyListEntry[];
  kind: "blocked" | "hidden";
  loading: boolean;
  error: string;
  styles: ProfileStyles;
  colors: SystemColors;
  disabled: boolean;
  onRemove: (userId: string) => void;
}) {
  const isBlocked = kind === "blocked";
  const label = isBlocked ? "Unblock" : "Restore";
  const emptyTitle = isBlocked ? "No blocked users" : "No hidden profiles";
  const emptyBody = isBlocked
    ? "People you block will appear here. Blocking keeps them out of your experience."
    : "Profiles you hide from recommendations will appear here. Hiding won’t affect your matches or messages.";

  if (loading) {
    return (
      <Text style={styles.privacyStatus}>
        Loading {isBlocked ? "blocked users" : "hidden profiles"}…
      </Text>
    );
  }

  if (error) {
    return (
      <Text accessibilityRole="alert" style={styles.privacyError}>
        {error}
      </Text>
    );
  }

  if (!entries.length) {
    return (
      <View style={styles.memberListEmpty}>
        <View style={styles.memberListEmptyIcon}>
          <Heart color={PROFILE_ACCENT} size={25} strokeWidth={1.7} />
        </View>
        <Text style={styles.memberListEmptyTitle}>{emptyTitle}</Text>
        <Text style={styles.memberListEmptyBody}>{emptyBody}</Text>
      </View>
    );
  }

  return (
    <>
      <Text style={styles.memberListCount}>
        {entries.length} {isBlocked ? "blocked" : "hidden"}{" "}
        {entries.length === 1 ? "member" : "members"}
      </Text>
      <View style={styles.memberGrid}>
        {entries.map((entry, index) => (
          <View key={entry.userId} style={styles.memberCard}>
            <View
              style={[
                styles.memberCardArtwork,
                index % 4 === 1 && styles.memberCardArtworkAlternate,
                index % 4 === 2 && styles.memberCardArtworkThird,
                index % 4 === 3 && styles.memberCardArtworkFourth,
              ]}
            >
              <View style={styles.memberCardAvatar}>
                <Text style={styles.memberCardInitial}>
                  {entry.userId.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.memberCardShade} />
              <View style={styles.memberCardDetails}>
                <Text style={styles.memberCardName}>VEYRA member</Text>
                <Text style={styles.memberCardMeta}>
                  ID · {entry.userId.slice(0, 8)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${label} member ${entry.userId.slice(0, 8)}`}
                  disabled={disabled}
                  onPress={() => onRemove(entry.userId)}
                  style={styles.memberCardAction}
                >
                  <Text style={styles.memberCardActionText}>
                    {disabled ? "Please wait…" : label}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.memberListNote}>
        Member photos and profile details will appear here when profile
        discovery is connected.
      </Text>
    </>
  );
}

function VerificationPanel({
  data,
  loading,
  hasData,
  error,
  colors,
  styles,
  onSelect,
}: {
  data: VerificationData;
  loading: boolean;
  hasData: boolean;
  error: string;
  colors: SystemColors;
  styles: ProfileStyles;
  onSelect: (step: VerificationStep) => void;
}) {
  const completedCount = [
    data.emailVerified,
    data.photoVerificationStatus === "verified",
    data.identityVerificationStatus === "verified",
  ].filter(Boolean).length;
  const items = [
    {
      icon: Mail,
      step: "email" as const,
      title: "Email verification",
      description: data.emailVerified
        ? "Your email address is verified."
        : "Confirm your email address to verify it.",
      verified: data.emailVerified,
      statusLabel: data.emailVerified ? "Verified" : "Not verified",
    },
    {
      icon: Camera,
      step: "photo" as const,
      title: "Photo verification",
      description: getVerificationStatusDescription(
        data.photoVerificationStatus,
        "selfie verification",
      ),
      verified: data.photoVerificationStatus === "verified",
      statusLabel: getVerificationStatusLabel(data.photoVerificationStatus),
    },
    {
      icon: Fingerprint,
      step: "identity" as const,
      title: "Identity verification",
      description: getVerificationStatusDescription(
        data.identityVerificationStatus,
        "identity document checks",
      ),
      verified: data.identityVerificationStatus === "verified",
      statusLabel: getVerificationStatusLabel(data.identityVerificationStatus),
    },
  ];

  if (loading && !hasData) {
    return (
      <Text style={styles.privacyStatus}>
        Loading your verification status…
      </Text>
    );
  }

  return (
    <>
      <View style={styles.verificationSummary}>
        <View style={styles.verificationSummaryHeader}>
          <View>
            <Text style={styles.verificationEyebrow}>YOUR VERIFICATION</Text>
            <Text style={styles.verificationCount}>
              {completedCount} of 3 complete
            </Text>
          </View>
          <ShieldCheck color={PROFILE_ACCENT} size={27} strokeWidth={1.7} />
        </View>
        <View style={styles.verificationProgressTrack}>
          <View
            style={[
              styles.verificationProgressFill,
              { width: `${(completedCount / 3) * 100}%` },
            ]}
          />
        </View>
        <Text style={styles.verificationSummaryCopy}>
          Complete verification to help other members feel confident connecting
          with you.
        </Text>
      </View>
      {items.map(
        ({ icon: Icon, step, title, description, verified, statusLabel }) => {
          return (
            <Pressable
              key={title}
              accessibilityRole={verified ? "text" : "button"}
              accessibilityLabel={verified ? title : `View ${title}`}
              disabled={verified}
              onPress={() => onSelect(step)}
              style={[
                styles.verificationRow,
                !verified && styles.verificationRowAction,
              ]}
            >
              <View style={styles.verificationIcon}>
                <Icon color={PROFILE_ACCENT} size={20} strokeWidth={1.8} />
              </View>
              <View style={styles.verificationCopy}>
                <Text style={styles.verificationTitle}>{title}</Text>
                <Text style={styles.verificationDescription}>
                  {description}
                </Text>
              </View>
              <View
                style={[
                  styles.verificationStatus,
                  verified && styles.verificationStatusComplete,
                ]}
              >
                <Text
                  style={[
                    styles.verificationStatusText,
                    verified && styles.verificationStatusTextComplete,
                  ]}
                >
                  {statusLabel}
                </Text>
              </View>
              {!verified ? (
                <ChevronRight color={colors.textMuted} size={17} />
              ) : null}
            </Pressable>
          );
        },
      )}
      <View style={styles.verificationBadgeInfo}>
        {data.identityVerificationStatus === "verified" ? (
          <IdentityVerifiedBadge colors={colors} />
        ) : (
          <Text style={styles.verificationTitle}>Identity Verified</Text>
        )}
        <Text style={styles.verificationDescription}>
          This badge means a government-issued identity document was checked
          through a trusted verification process. It does not guarantee a
          member’s character or intentions.
        </Text>
        {data.identityVerificationStatus !== "verified" ? (
          <Text style={styles.verificationDescription}>
            The badge appears only after identity verification is successfully
            completed. Your current status is{" "}
            {getVerificationStatusLabel(
              data.identityVerificationStatus,
            ).toLowerCase()}
            .
          </Text>
        ) : null}
      </View>
      <View style={styles.verificationPrivacyNote}>
        <ShieldCheck color={colors.success} size={17} />
        <Text style={styles.verificationPrivacyText}>
          Identity documents are private and are never shown to other members.
        </Text>
      </View>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={hasData ? styles.privacyStatus : styles.privacyError}
        >
          {hasData ? "Showing saved verification status. " + error : error}
        </Text>
      ) : null}
      {loading && hasData ? (
        <Text style={styles.privacyStatus}>
          Refreshing verification status…
        </Text>
      ) : null}
    </>
  );
}

function VerificationStepModal({
  step,
  email,
  data,
  colors,
  styles,
  onClose,
}: {
  step: VerificationStep | null;
  email: string | null;
  data: VerificationData;
  colors: SystemColors;
  styles: ProfileStyles;
  onClose: () => void;
}) {
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState("");
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    setEmailFeedback("");
    setEmailError("");
  }, [step]);

  if (!step) return null;

  const detail = getVerificationStepDetails(step, data);
  const sendConfirmation = async () => {
    if (!email || sendingEmail) {
      if (!email) setEmailError("There is no email address on this account.");
      return;
    }
    setSendingEmail(true);
    setEmailFeedback("");
    setEmailError("");
    try {
      await resendSignupConfirmation(email);
      setEmailFeedback(`A confirmation email was sent to ${email}.`);
    } catch (error) {
      setEmailError(
        error instanceof Error
          ? error.message
          : "Could not resend the confirmation email.",
      );
    } finally {
      setSendingEmail(false);
    }
  };

  if (step === "photo") {
    return (
      <PhotoSelfieModal colors={colors} styles={styles} onClose={onClose} />
    );
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible
    >
      <SafeAreaView style={styles.modalScreen}>
        <View style={styles.verificationStepHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to verification"
            onPress={onClose}
            style={styles.memberListBack}
          >
            <ChevronLeft color={colors.text} size={23} />
          </Pressable>
          <Text style={styles.memberListHeaderTitle}>{detail.title}</Text>
          <View style={styles.memberListHeaderSpacer} />
        </View>
        <ScrollView
          contentContainerStyle={styles.verificationStepContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.verificationStepHero}>
            <View style={styles.verificationStepIcon}>
              <detail.icon color={PROFILE_ACCENT} size={30} strokeWidth={1.7} />
            </View>
            <Text style={styles.verificationStepTitle}>{detail.heading}</Text>
            <Text style={styles.verificationStepDescription}>
              {detail.description}
            </Text>
          </View>

          <View style={styles.verificationStepCard}>
            <Text style={styles.verificationStepSectionTitle}>
              {detail.sectionTitle}
            </Text>
            {detail.steps.map((item, index) => (
              <View key={item} style={styles.verificationStepRow}>
                <View style={styles.verificationStepNumber}>
                  <Text style={styles.verificationStepNumberText}>
                    {index + 1}
                  </Text>
                </View>
                <Text style={styles.verificationStepRowText}>{item}</Text>
              </View>
            ))}
          </View>

          {step === "email" ? (
            <Pressable
              accessibilityRole="button"
              disabled={sendingEmail}
              onPress={() => void sendConfirmation()}
              style={[
                styles.verificationStepAction,
                sendingEmail && styles.verificationStepActionDisabled,
              ]}
            >
              <Text style={styles.verificationStepActionText}>
                {sendingEmail ? "Sending…" : "Resend confirmation email"}
              </Text>
            </Pressable>
          ) : (
            <View
              accessibilityRole="text"
              style={styles.verificationStepComingSoon}
            >
              <Text style={styles.verificationStepComingSoonText}>
                Verification is not available yet
              </Text>
            </View>
          )}

          {emailFeedback ? (
            <Text style={styles.verificationStepSuccess}>{emailFeedback}</Text>
          ) : null}
          {emailError ? (
            <Text accessibilityRole="alert" style={styles.privacyError}>
              {emailError}
            </Text>
          ) : null}

          <View style={styles.verificationPrivacyNote}>
            <ShieldCheck color={colors.success} size={17} />
            <Text style={styles.verificationPrivacyText}>
              {detail.privacyNote}
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function PhotoSelfieModal({
  colors,
  styles,
  onClose,
}: {
  colors: SystemColors;
  styles: ProfileStyles;
  onClose: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [cameraAllowed, setCameraAllowed] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [selfieUri, setSelfieUri] = useState<string | null>(null);
  const [error, setError] = useState("");

  const openCamera = async () => {
    setError("");
    try {
      if (!permission?.granted) {
        const result = await requestPermission();
        if (!result.granted) {
          setError(
            "Camera access is needed to take a selfie. You can enable it in your device settings.",
          );
          return;
        }
      }
      setCameraAllowed(true);
      setCameraReady(false);
      setCameraStarted(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Could not request camera access: ${cause.message}`
          : "Could not request camera access.",
      );
    }
  };

  const captureSelfie = async () => {
    if (!cameraRef.current || !cameraReady || capturing) return;
    setCapturing(true);
    setError("");
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        exif: false,
        base64: false,
      });
      if (!photo?.uri) {
        throw new Error("The camera did not return a selfie.");
      }
      setSelfieUri(photo.uri);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Could not take your selfie: ${cause.message}`
          : "Could not take your selfie. Please try again.",
      );
    } finally {
      setCapturing(false);
    }
  };

  const retake = async () => {
    if (selfieUri) {
      try {
        await deleteLocalFile(selfieUri);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? `Could not remove the temporary selfie: ${cause.message}`
            : "Could not remove the temporary selfie.",
        );
        return;
      }
    }
    setSelfieUri(null);
    setCameraReady(false);
    setError("");
  };

  const finish = async () => {
    if (selfieUri) {
      try {
        await deleteLocalFile(selfieUri);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? `Could not remove the temporary selfie: ${cause.message}`
            : "Could not remove the temporary selfie.",
        );
        return;
      }
    }
    onClose();
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={finish}
      presentationStyle="fullScreen"
      visible
    >
      <SafeAreaView style={styles.modalScreen}>
        <View style={styles.verificationStepHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to verification"
            onPress={finish}
            style={styles.memberListBack}
          >
            <ChevronLeft color={colors.text} size={23} />
          </Pressable>
          <Text style={styles.memberListHeaderTitle}>Take a selfie</Text>
          <View style={styles.memberListHeaderSpacer} />
        </View>
        <ScrollView
          contentContainerStyle={styles.verificationStepContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.verificationStepHero}>
            <View style={styles.verificationStepIcon}>
              <Camera color={PROFILE_ACCENT} size={30} strokeWidth={1.7} />
            </View>
            <Text style={styles.verificationStepTitle}>
              {selfieUri ? "Your selfie" : "Take a selfie"}
            </Text>
            <Text style={styles.verificationStepDescription}>
              {selfieUri
                ? "You can retake it or finish. This selfie stays temporary on your device."
                : "Take a selfie with your front camera. It will not be uploaded or used to change your verification status."}
            </Text>
          </View>

          {selfieUri ? (
            <Image
              accessibilityLabel="Selfie preview"
              resizeMode="cover"
              source={{ uri: selfieUri }}
              style={styles.verificationSelfiePreview}
            />
          ) : cameraStarted && cameraAllowed ? (
            <View style={styles.verificationCameraFrame}>
              <CameraView
                ref={cameraRef}
                facing="front"
                onCameraReady={() => setCameraReady(true)}
                onMountError={(event) => {
                  setError(`Could not start the camera: ${event.message}`);
                }}
                style={styles.verificationCamera}
              />
            </View>
          ) : (
            <View style={styles.verificationStepCard}>
              <Text style={styles.verificationStepSectionTitle}>
                Your privacy
              </Text>
              <Text style={styles.verificationStepRowText}>
                The selfie is only previewed in this screen. It is not sent to
                VEYRA or saved to your profile, and taking one does not verify
                your account.
              </Text>
            </View>
          )}

          {error ? (
            <Text accessibilityRole="alert" style={styles.privacyError}>
              {error}
            </Text>
          ) : null}

          {selfieUri ? (
            <View style={styles.verificationSelfieActions}>
              <Pressable
                accessibilityRole="button"
                onPress={retake}
                style={styles.verificationSelfieSecondaryAction}
              >
                <Text style={styles.verificationSelfieSecondaryText}>
                  Retake
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={finish}
                style={styles.verificationSelfiePrimaryAction}
              >
                <Text style={styles.verificationStepActionText}>Done</Text>
              </Pressable>
            </View>
          ) : cameraStarted && cameraAllowed ? (
            <Pressable
              accessibilityRole="button"
              disabled={!cameraReady || capturing}
              onPress={() => void captureSelfie()}
              style={[
                styles.verificationStepAction,
                (!cameraReady || capturing) &&
                  styles.verificationStepActionDisabled,
                styles.verificationSelfiePrimaryAction,
              ]}
            >
              <Text style={styles.verificationStepActionText}>
                {capturing
                  ? "Taking selfie…"
                  : cameraReady
                    ? "Take selfie"
                    : "Starting camera…"}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => void openCamera()}
              style={styles.verificationStepAction}
            >
              <Text style={styles.verificationStepActionText}>
                {cameraAllowed ? "Open camera" : "Allow camera and continue"}
              </Text>
            </Pressable>
          )}

          <View style={styles.verificationPrivacyNote}>
            <ShieldCheck color={colors.success} size={17} />
            <Text style={styles.verificationPrivacyText}>
              Taking a selfie does not mark photo verification as complete. The
              temporary photo is discarded when you leave this screen.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function getVerificationStepDetails(
  step: VerificationStep,
  data: VerificationData,
): {
  icon: LucideIcon;
  title: string;
  heading: string;
  description: string;
  sectionTitle: string;
  steps: string[];
  privacyNote: string;
} {
  if (step === "email") {
    return {
      icon: Mail,
      title: "Email verification",
      heading: data.emailVerified
        ? "Your email is verified"
        : "Verify your email",
      description: data.emailVerified
        ? "Your confirmed email helps keep your account secure."
        : "Confirm the email address linked to your account to complete this step.",
      sectionTitle: "What to do",
      steps: [
        "Check your inbox for a VEYRA confirmation email.",
        "Open the email and follow its confirmation link.",
        "Return to VEYRA; your status will update after confirmation.",
      ],
      privacyNote:
        "Your email address is private and is never shown on your profile.",
    };
  }
  if (step === "photo") {
    return {
      icon: Camera,
      title: "Photo verification",
      heading: "Take a selfie",
      description:
        "Take and preview a selfie with your camera. Verification is not performed yet.",
      sectionTitle: "About this step",
      steps: [
        "The selfie stays temporary on your device.",
        "It is not uploaded or saved to your profile.",
        "Taking a selfie does not change your verification status.",
      ],
      privacyNote:
        "The temporary selfie is discarded when you leave the camera screen.",
    };
  }
  return {
    icon: Fingerprint,
    title: "Identity verification",
    heading: "Verify your identity",
    description:
      "Identity checks will help confirm your account using an approved identity document.",
    sectionTitle: "How identity verification will work",
    steps: [
      "Choose an accepted identity document.",
      "Capture the document securely in the app.",
      "Complete the identity check and wait for its result.",
    ],
    privacyNote:
      "Identity documents are private and will never be exposed to other users.",
  };
}

function getVerificationStatusLabel(
  status: VerificationData["photoVerificationStatus"],
): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "pending":
      return "Pending";
    case "rejected":
      return "Rejected";
    case "review_required":
      return "Review needed";
    case "not_started":
      return "Not started";
  }
}

function getVerificationStatusDescription(
  status: VerificationData["photoVerificationStatus"],
  subject: string,
): string {
  switch (status) {
    case "verified":
      return subject === "selfie verification"
        ? "Selfie verification completed."
        : "Identity document checks completed.";
    case "pending":
      return "Your verification is being reviewed.";
    case "rejected":
      return "Verification was not approved.";
    case "review_required":
      return "Additional review is required.";
    case "not_started":
      if (subject === "selfie verification") {
        return "Take a selfie; verification status will remain unchanged.";
      }
      return `${subject === "selfie verification" ? "Selfie" : "Identity document"} verification hasn’t started.`;
  }
}

function StatusPanel({
  icon: Icon,
  title,
  body,
  colors,
  styles,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  colors: SystemColors;
  styles: ProfileStyles;
}) {
  return (
    <View style={styles.statusPanel}>
      <View style={styles.statusIcon}>
        <Icon color={PROFILE_ACCENT} size={24} strokeWidth={1.8} />
      </View>
      <Text style={styles.statusTitle}>{title}</Text>
      <Text style={styles.statusBody}>{body}</Text>
    </View>
  );
}

function DetailBlock({
  title,
  value,
  styles,
}: {
  title: string;
  value: string;
  styles: ProfileStyles;
}) {
  return (
    <View style={styles.detailBlock}>
      <Text style={styles.detailLabel}>{title}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function isValidTime(value: string): boolean {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match !== null;
}

function getPanelTitle(panel: ProfilePanel): string {
  const titles: Record<ProfilePanel, string> = {
    preview: "Profile preview",
    "dating-dna": "Dating DNA",
    preferences: "Dating preferences",
    verification: "Verification",
    privacy: "Privacy & visibility",
    "blocked-users": "Blocked users",
    "hidden-profiles": "Hidden profiles",
    notifications: "Notifications",
    appearance: "App preferences",
    help: "Help & safety",
  };
  return titles[panel];
}

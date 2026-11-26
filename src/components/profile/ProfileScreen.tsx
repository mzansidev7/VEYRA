import { useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import type { ScrollViewInstance } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Bell,
  Eye,
  Fingerprint,
  Heart,
  CircleHelp,
  Download,
  LockKeyhole,
  LogOut,
  MapPin,
  Pause,
  Play,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import {
  isAdultBirthday,
  type LocalDatingProfile,
  type OnboardingStep,
} from "../../data/localProfile";
import { systemColors, type SystemColors } from "../../systemColors";
import {
  IdentityCard,
  ProfileMenuItem,
  ProfilePhotoGrid,
  SectionTitle,
} from "./ProfileControls";
import { IdentityVerifiedBadge } from "../IdentityVerifiedBadge";
import {
  getCachedVerificationData,
  refreshVerificationData,
} from "../../data/verificationSettings";
import { ProfileDetailModal, type ProfilePanel } from "./ProfileDetailModal";
import { getProfileCompletion } from "./profileCompletion";
import { useProfileVoiceIntroUrl } from "./useProfileVoiceIntroUrl";
import { SubscriptionPlans } from "./SubscriptionPlans";
import { AppReleaseModal } from "./AppReleaseModal";

const PROFILE_ACCENT = "#E98B78";

type ProfileScreenProps = {
  profile: LocalDatingProfile | null;
  userId: string | null;
  userEmail: string | null;
  initialPanel?: "privacy" | null;
  onEditProfile: (step?: Exclude<OnboardingStep, "complete">) => void;
  onSignOut: () => void;
  onAccountDeleted: () => Promise<void>;
};

export function ProfileScreen({
  profile,
  userId,
  userEmail,
  initialPanel = null,
  onEditProfile,
  onSignOut,
  onAccountDeleted,
}: ProfileScreenProps) {
  const colorScheme = useColorScheme();
  const colors = systemColors[colorScheme === "dark" ? "dark" : "light"];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width: screenWidth } = useWindowDimensions();
  const [panel, setPanel] = useState<ProfilePanel | null>(initialPanel);
  const [viewerPhotos, setViewerPhotos] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const viewerScroll = useRef<ScrollViewInstance>(null);
  const [identityVerified, setIdentityVerified] = useState(false);
  const [verificationLoadError, setVerificationLoadError] = useState("");
  const [releaseModalVisible, setReleaseModalVisible] = useState(false);
  const voiceReference = profile?.profile.voiceIntroUri ?? "";
  const { url: voiceIntroUrl, error: voiceIntroError } =
    useProfileVoiceIntroUrl(voiceReference);
  const voicePlayer = useAudioPlayer(voiceIntroUrl || null);
  const voiceStatus = useAudioPlayerStatus(voicePlayer);
  const completion = profile ? getProfileCompletion(profile) : null;
  const profileAge = profile?.profile.birthday
    ? getProfileAge(profile.profile.birthday)
    : null;
  const nickname = profile?.profile.nickname.trim() || "Your nickname";

  useEffect(() => {
    let active = true;
    setIdentityVerified(false);
    setVerificationLoadError("");
    if (!userId) return;

    const loadIdentityStatus = async () => {
      try {
        const cached = await getCachedVerificationData(userId);
        if (!active) return;
        if (cached) {
          setIdentityVerified(
            cached.isFresh &&
              cached.data.identityVerificationStatus === "verified",
          );
          if (cached.isFresh) return;
        }

        const refreshed = await refreshVerificationData(userId);
        if (active) {
          setIdentityVerified(
            refreshed.identityVerificationStatus === "verified",
          );
          setVerificationLoadError("");
        }
      } catch (error) {
        if (active) {
          setVerificationLoadError(
            error instanceof Error
              ? error.message
              : "Could not load identity verification status.",
          );
        }
      }
    };

    void loadIdentityStatus();
    return () => {
      active = false;
    };
  }, [userId]);

  const editProfile = (step?: Exclude<OnboardingStep, "complete">) => {
    setPanel(null);
    onEditProfile(step);
  };

  const openPhotoViewer = (index: number, photoUrls: string[]) => {
    setViewerPhotos(photoUrls);
    setViewerIndex(index);
  };

  const closePhotoViewer = () => setViewerPhotos([]);

  return (
    <View style={styles.screen}>
      <View style={styles.screenHeader}>
        <Text style={styles.screenTitle}>Your profile</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="App preferences"
          onPress={() => setPanel("appearance")}
          style={({ pressed }) => [
            styles.settingsButton,
            pressed && styles.pressed,
          ]}
        >
          <Settings2 color={colors.textSecondary} size={19} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.profileCard}>
          <ProfilePhotoGrid
            photos={profile?.profile.photos ?? []}
            styles={styles}
            onOpenPhoto={openPhotoViewer}
            onEditPhotos={() => editProfile("profile")}
          />
          <View style={styles.identity}>
            <View style={styles.nameLine}>
              <Text style={styles.name}>
                {nickname}
                {profileAge ? `, ${profileAge}` : ""}
              </Text>
              {identityVerified ? (
                <IdentityVerifiedBadge colors={colors} compact />
              ) : null}
            </View>
            {verificationLoadError ? (
              <Text
                accessibilityRole="alert"
                style={styles.verificationStatusError}
              >
                {verificationLoadError}
              </Text>
            ) : null}
            <View style={styles.locationLine}>
              <MapPin color={colors.textSecondary} size={13} />
              <Text style={styles.location}>
                {profile?.profile.city.trim() || "Add your location"}
              </Text>
            </View>
          </View>

          <View style={styles.completionCard}>
            <View style={styles.completionHeader}>
              <Text style={styles.completionTitle}>Profile completeness</Text>
              <Text style={styles.completionPercent}>
                {completion?.percentage ?? 0}%
              </Text>
            </View>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{
                min: 0,
                max: 100,
                now: completion?.percentage ?? 0,
              }}
              style={styles.progressTrack}
            >
              <View
                style={[
                  styles.progressFill,
                  { width: `${completion?.percentage ?? 0}%` },
                ]}
              />
            </View>
            <Text style={styles.completionHint}>
              {completion?.percentage === 100
                ? "You’re ready to make meaningful connections."
                : completion?.missingItems.length
                  ? `Next: ${completion.missingItems[0].toLowerCase()}.`
                  : "Complete your profile to make more meaningful connections."}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => editProfile("profile")}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>Edit my dating profile</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setPanel("preview")}
            style={({ pressed }) => [
              styles.previewButton,
              pressed && styles.pressed,
            ]}
          >
            <Eye color={PROFILE_ACCENT} size={17} />
            <Text style={styles.previewButtonText}>Preview my profile</Text>
          </Pressable>
          {voiceReference ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !voiceIntroUrl }}
                disabled={!voiceIntroUrl}
                onPress={() =>
                  voiceStatus.playing ? voicePlayer.pause() : voicePlayer.play()
                }
                style={({ pressed }) => [
                  styles.voiceButton,
                  pressed && styles.pressed,
                  !voiceIntroUrl && styles.voiceButtonDisabled,
                ]}
              >
                {voiceStatus.playing ? (
                  <Pause color={PROFILE_ACCENT} size={16} />
                ) : (
                  <Play color={PROFILE_ACCENT} size={16} />
                )}
                <Text style={styles.previewButtonText}>
                  {voiceStatus.playing
                    ? "Pause voice introduction"
                    : voiceIntroError
                      ? "Voice introduction unavailable"
                      : voiceIntroUrl
                        ? "Play voice introduction"
                        : "Loading voice introduction"}
                </Text>
              </Pressable>
              {voiceIntroError ? (
                <Text accessibilityRole="alert" style={styles.voiceError}>
                  {voiceIntroError}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>

        <SectionTitle title="Dating identity" styles={styles} />
        <View style={styles.identityCards}>
          <IdentityCard
            title="Dating DNA"
            subtitle="Your personality & values"
            icon={Fingerprint}
            colors={colors}
            styles={styles}
            onPress={() => setPanel("dating-dna")}
          />
          <IdentityCard
            title="Preferences"
            subtitle="Who you want to meet"
            icon={Heart}
            colors={colors}
            styles={styles}
            onPress={() => setPanel("preferences")}
          />
        </View>

        <SectionTitle title="Discovery settings" styles={styles} />
        <View style={styles.menuGroup}>
          <ProfileMenuItem
            icon={LockKeyhole}
            title="Privacy & visibility"
            subtitle="Control who sees you"
            colors={colors}
            styles={styles}
            onPress={() => setPanel("privacy")}
            isLast
          />
        </View>

        <SectionTitle title="Account settings" styles={styles} />
        <View style={styles.menuGroup}>
          <ProfileMenuItem
            icon={ShieldCheck}
            title="Verification"
            subtitle="Verify your identity"
            colors={colors}
            styles={styles}
            onPress={() => setPanel("verification")}
          />
          <ProfileMenuItem
            icon={Bell}
            title="Notifications"
            subtitle="Manage alerts"
            colors={colors}
            styles={styles}
            onPress={() => setPanel("notifications")}
          />
          <ProfileMenuItem
            icon={SlidersHorizontal}
            title="App preferences"
            subtitle="Appearance and app settings"
            colors={colors}
            styles={styles}
            onPress={() => setPanel("appearance")}
            isLast
          />
        </View>

        <SectionTitle title="Help & safety" styles={styles} />
        <View style={styles.menuGroup}>
          <ProfileMenuItem
            icon={CircleHelp}
            title="Safety centre & support"
            subtitle="Support, block and report"
            colors={colors}
            styles={styles}
            onPress={() => setPanel("help")}
            isLast
          />
        </View>

        <SubscriptionPlans colors={colors} styles={styles} />

        <View style={styles.menuGroup}>
          <ProfileMenuItem
            icon={Download}
            title="Download new version"
            subtitle="Browse releases and product updates"
            colors={colors}
            styles={styles}
            onPress={() => setReleaseModalVisible(true)}
            isLast
          />
        </View>

        <View style={[styles.menuGroup, styles.logoutGroup]}>
          <ProfileMenuItem
            icon={LogOut}
            title="Log out"
            subtitle="Sign out of VEYRA"
            colors={colors}
            styles={styles}
            onPress={onSignOut}
            isLast
          />
        </View>
      </ScrollView>

      <AppReleaseModal
        visible={releaseModalVisible}
        colors={colors}
        onClose={() => setReleaseModalVisible(false)}
      />

      <ProfileDetailModal
        panel={panel}
        profile={profile}
        age={profileAge}
        colors={colors}
        styles={styles}
        identityVerified={identityVerified}
        onClose={() =>
          setPanel(
            panel === "blocked-users" || panel === "hidden-profiles"
              ? "privacy"
              : null,
          )
        }
        onEditProfile={editProfile}
        onAccountDeleted={onAccountDeleted}
        onManageBlockedUsers={() => setPanel("blocked-users")}
        onManageHiddenProfiles={() => setPanel("hidden-profiles")}
        userEmail={userEmail}
        userId={userId}
      />

      <Modal
        animationType="fade"
        onRequestClose={closePhotoViewer}
        onShow={() => {
          requestAnimationFrame(() => {
            viewerScroll.current?.scrollTo({
              x: viewerIndex * screenWidth,
              animated: false,
            });
          });
        }}
        statusBarTranslucent
        visible={viewerPhotos.length > 0}
      >
        <SafeAreaView edges={["top", "bottom"]} style={styles.photoViewer}>
          <View style={styles.photoViewerHeader}>
            <Text style={styles.photoViewerCount}>
              {viewerIndex + 1} / {viewerPhotos.length}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close photo viewer"
              onPress={closePhotoViewer}
              style={({ pressed }) => [
                styles.photoViewerClose,
                pressed && styles.pressed,
              ]}
            >
              <X color="#FFFFFF" size={23} />
            </Pressable>
          </View>
          <ScrollView
            ref={viewerScroll}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            onMomentumScrollEnd={(event) => {
              const nextIndex = Math.round(
                event.nativeEvent.contentOffset.x / screenWidth,
              );
              setViewerIndex(
                Math.max(0, Math.min(nextIndex, viewerPhotos.length - 1)),
              );
            }}
            style={styles.photoViewerPager}
          >
            {viewerPhotos.map((photo, index) => (
              <View
                key={`${photo}-${index}`}
                style={[styles.photoViewerPage, { width: screenWidth }]}
              >
                <Image
                  accessibilityLabel={`Profile photo ${index + 1}`}
                  source={{ uri: photo }}
                  resizeMode="contain"
                  style={styles.photoViewerImage}
                />
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function getProfileAge(birthday: string): number | null {
  if (!isAdultBirthday(birthday)) return null;
  const birthDate = new Date(`${birthday}T00:00:00`);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  if (
    today.getMonth() < birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() &&
      today.getDate() < birthDate.getDate())
  ) {
    age -= 1;
  }
  return age;
}

const createStyles = (colors: SystemColors) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    screenHeader: {
      minHeight: 46,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    screenTitle: {
      color: colors.primary,
      fontSize: 21,
      fontWeight: "700",
      letterSpacing: -0.3,
    },
    settingsButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 18,
    },
    scrollContent: {
      paddingBottom: 22,
    },
    profileCard: {
      padding: 8,
      borderRadius: 17,
      backgroundColor: colors.card,
    },
    photoGrid: {
      height: 226,
      flexDirection: "row",
      gap: 4,
      overflow: "hidden",
      borderRadius: 13,
    },
    photoTile: {
      flex: 1,
      overflow: "hidden",
      borderRadius: 9,
      backgroundColor: colors.surfaceSecondary,
    },
    featuredPhotoTile: {
      flex: 1.45,
    },
    photoSide: {
      flex: 1,
      gap: 4,
    },
    photo: {
      width: "100%",
      height: "100%",
      backgroundColor: colors.surfaceSecondary,
    },
    photoPlaceholder: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 8,
      backgroundColor: colors.surfaceSecondary,
    },
    addPhotoIcon: {
      width: 29,
      height: 29,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 15,
      backgroundColor: colors.card,
    },
    addPhotoPlus: {
      color: PROFILE_ACCENT,
      fontSize: 21,
      lineHeight: 24,
    },
    addPhotoText: {
      color: colors.textSecondary,
      fontSize: 10,
      textAlign: "center",
      marginTop: 6,
    },
    photoHint: {
      position: "absolute",
      left: 8,
      bottom: 8,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 12,
      backgroundColor: "rgba(0,0,0,0.5)",
    },
    photoHintText: {
      color: "#FFFFFF",
      fontSize: 9,
      fontWeight: "600",
    },
    photoCount: {
      position: "absolute",
      right: 7,
      bottom: 7,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
      backgroundColor: "rgba(0,0,0,0.58)",
    },
    photoCountText: {
      color: "#FFFFFF",
      fontSize: 9,
      fontWeight: "600",
    },
    photoViewer: {
      flex: 1,
      backgroundColor: "#000000",
    },
    photoViewerHeader: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
    },
    photoViewerCount: {
      color: "#FFFFFF",
      fontSize: 14,
      fontWeight: "600",
    },
    photoViewerClose: {
      position: "absolute",
      right: 12,
      top: 4,
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 20,
    },
    photoViewerPager: {
      flex: 1,
    },
    photoViewerPage: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    photoViewerImage: {
      width: "100%",
      height: "100%",
    },
    photoLoadError: {
      color: colors.error,
      fontSize: 10,
      lineHeight: 15,
      marginTop: 6,
    },
    identity: {
      paddingHorizontal: 4,
      paddingTop: 8,
      paddingBottom: 10,
    },
    nameLine: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6,
    },
    name: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "700",
    },
    verificationStatusError: {
      color: colors.error,
      fontSize: 10,
      marginTop: 5,
    },
    locationLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: 4,
    },
    location: {
      color: colors.textSecondary,
      fontSize: 11,
    },
    completionCard: {
      padding: 9,
      borderRadius: 11,
      backgroundColor: colors.surfaceSecondary,
    },
    completionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    completionTitle: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "600",
    },
    completionPercent: {
      color: colors.text,
      fontSize: 10,
      fontWeight: "700",
    },
    progressTrack: {
      height: 5,
      overflow: "hidden",
      borderRadius: 3,
      marginTop: 7,
      backgroundColor: colors.border,
    },
    progressFill: {
      height: "100%",
      borderRadius: 3,
      backgroundColor: PROFILE_ACCENT,
    },
    completionHint: {
      color: colors.textSecondary,
      fontSize: 9,
      lineHeight: 13,
      marginTop: 5,
    },
    primaryButton: {
      minHeight: 40,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 22,
      marginTop: 8,
      backgroundColor: PROFILE_ACCENT,
    },
    primaryButtonText: {
      color: "#331B1D",
      fontSize: 11,
      fontWeight: "700",
    },
    previewButton: {
      minHeight: 38,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      borderRadius: 19,
      marginTop: 6,
      borderWidth: 1,
      borderColor: colors.border,
    },
    voiceButton: {
      minHeight: 36,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      marginTop: 4,
    },
    voiceButtonDisabled: {
      opacity: 0.55,
    },
    voiceError: {
      color: colors.error,
      fontSize: 10,
      lineHeight: 15,
      textAlign: "center",
      marginTop: 3,
    },
    previewButtonText: {
      color: PROFILE_ACCENT,
      fontSize: 11,
      fontWeight: "600",
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
      marginTop: 18,
      marginBottom: 8,
    },
    identityCards: {
      flexDirection: "row",
      gap: 8,
    },
    identityCard: {
      flex: 1,
      minHeight: 87,
      justifyContent: "center",
      padding: 11,
      borderRadius: 13,
      backgroundColor: colors.card,
    },
    identityCardTitle: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "600",
      marginTop: 7,
    },
    identityCardSubtitle: {
      color: colors.textSecondary,
      fontSize: 9,
      marginTop: 3,
    },
    identityCardArrow: {
      position: "absolute",
      top: 10,
      right: 9,
    },
    menuGroup: {
      paddingHorizontal: 9,
      borderRadius: 14,
      backgroundColor: colors.card,
    },
    logoutGroup: {
      marginTop: 16,
    },
    menuItem: {
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 7,
      gap: 9,
    },
    menuItemDivider: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    menuIcon: {
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      backgroundColor: colors.surfaceSecondary,
    },
    menuCopy: {
      flex: 1,
    },
    menuTitle: {
      color: colors.text,
      fontSize: 10,
      fontWeight: "600",
    },
    menuSubtitle: {
      color: colors.textMuted,
      fontSize: 8,
      marginTop: 3,
    },
    pressed: {
      opacity: 0.72,
    },
    modalScreen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    modalHeader: {
      minHeight: 54,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    modalTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "700",
    },
    modalClose: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 18,
      backgroundColor: colors.surfaceSecondary,
    },
    modalContent: {
      padding: 20,
      paddingBottom: 36,
    },
    memberListHeader: {
      minHeight: 54,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    memberListBack: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    memberListHeaderTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
      textAlign: "center",
    },
    memberListHeaderSpacer: {
      width: 40,
      height: 40,
    },
    memberListCount: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: "600",
      marginBottom: 12,
    },
    memberGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: 12,
    },
    memberCard: {
      width: "48%",
      overflow: "hidden",
      borderRadius: 13,
      backgroundColor: colors.card,
    },
    memberCardArtwork: {
      aspectRatio: 0.63,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      backgroundColor: colors.surfaceSecondary,
    },
    memberCardArtworkAlternate: {
      backgroundColor: colors.accent,
    },
    memberCardArtworkThird: {
      backgroundColor: colors.secondary,
    },
    memberCardArtworkFourth: {
      backgroundColor: PROFILE_ACCENT,
    },
    memberCardAvatar: {
      width: 82,
      height: 82,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 41,
      borderWidth: 1,
      borderColor: colors.card,
      backgroundColor: colors.surface,
    },
    memberCardInitial: {
      color: PROFILE_ACCENT,
      fontSize: 35,
      fontWeight: "500",
    },
    memberCardShade: {
      position: "absolute",
      right: 0,
      bottom: 0,
      left: 0,
      height: 105,
      backgroundColor: colors.background,
      opacity: 0.9,
    },
    memberCardDetails: {
      position: "absolute",
      right: 9,
      bottom: 9,
      left: 9,
      gap: 4,
    },
    memberCardName: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "700",
    },
    memberCardMeta: {
      color: colors.textSecondary,
      fontSize: 9,
    },
    memberCardAction: {
      minHeight: 31,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 16,
      marginTop: 4,
      backgroundColor: PROFILE_ACCENT,
    },
    memberCardActionText: {
      color: "#331B1D",
      fontSize: 10,
      fontWeight: "700",
    },
    memberListNote: {
      color: colors.textMuted,
      fontSize: 10,
      lineHeight: 15,
      marginTop: 14,
    },
    memberListEmpty: {
      alignItems: "center",
      paddingHorizontal: 20,
      paddingTop: 52,
    },
    memberListEmptyIcon: {
      width: 60,
      height: 60,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 30,
      backgroundColor: colors.surfaceSecondary,
    },
    memberListEmptyTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
      textAlign: "center",
      marginTop: 18,
    },
    memberListEmptyBody: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "center",
      marginTop: 8,
    },
    verificationSummary: {
      padding: 16,
      borderRadius: 15,
      marginBottom: 14,
      backgroundColor: colors.surfaceSecondary,
    },
    verificationSummaryHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    verificationEyebrow: {
      color: colors.textMuted,
      fontSize: 9,
      fontWeight: "700",
      letterSpacing: 1,
    },
    verificationCount: {
      color: colors.text,
      fontSize: 19,
      fontWeight: "700",
      marginTop: 5,
    },
    verificationProgressTrack: {
      height: 6,
      overflow: "hidden",
      borderRadius: 3,
      marginTop: 14,
      backgroundColor: colors.border,
    },
    verificationProgressFill: {
      height: "100%",
      borderRadius: 3,
      backgroundColor: PROFILE_ACCENT,
    },
    verificationSummaryCopy: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 10,
    },
    verificationRow: {
      minHeight: 78,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    verificationRowAction: {
      borderRadius: 12,
      paddingHorizontal: 8,
      marginHorizontal: -8,
    },
    verificationStepHeader: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    verificationStepContent: {
      flexGrow: 1,
      padding: 22,
      paddingBottom: 40,
    },
    verificationStepHero: {
      alignItems: "center",
      paddingTop: 26,
      paddingBottom: 28,
    },
    verificationStepIcon: {
      width: 76,
      height: 76,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 38,
      backgroundColor: colors.surfaceSecondary,
    },
    verificationStepTitle: {
      color: colors.text,
      fontSize: 23,
      lineHeight: 30,
      fontWeight: "700",
      textAlign: "center",
      marginTop: 20,
    },
    verificationStepDescription: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 20,
      textAlign: "center",
      marginTop: 9,
    },
    verificationStepCard: {
      padding: 16,
      borderRadius: 15,
      backgroundColor: colors.card,
    },
    verificationStepSectionTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
      marginBottom: 6,
    },
    verificationStepRow: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      paddingVertical: 8,
    },
    verificationStepNumber: {
      width: 25,
      height: 25,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 13,
      backgroundColor: colors.surfaceSecondary,
    },
    verificationStepNumberText: {
      color: PROFILE_ACCENT,
      fontSize: 11,
      fontWeight: "700",
    },
    verificationStepRowText: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 18,
    },
    verificationStepAction: {
      minHeight: 50,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 25,
      marginTop: 20,
      backgroundColor: PROFILE_ACCENT,
    },
    verificationStepActionDisabled: {
      opacity: 0.6,
    },
    verificationStepActionText: {
      color: "#331B1D",
      fontSize: 13,
      fontWeight: "700",
    },
    verificationStepComingSoon: {
      minHeight: 50,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 25,
      marginTop: 20,
      backgroundColor: colors.surfaceSecondary,
    },
    verificationStepComingSoonText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: "700",
    },
    verificationCameraFrame: {
      height: 390,
      overflow: "hidden",
      borderRadius: 20,
      backgroundColor: colors.surfaceSecondary,
    },
    verificationCamera: {
      flex: 1,
    },
    verificationSelfiePreview: {
      width: "100%",
      height: 390,
      borderRadius: 20,
      backgroundColor: colors.surfaceSecondary,
    },
    verificationSelfieActions: {
      flexDirection: "row",
      gap: 12,
      marginTop: 20,
    },
    verificationSelfiePrimaryAction: {
      flex: 1,
      marginTop: 0,
    },
    verificationSelfieSecondaryAction: {
      minHeight: 50,
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 25,
      backgroundColor: colors.surfaceSecondary,
    },
    verificationSelfieSecondaryText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "700",
    },
    verificationStepSuccess: {
      color: colors.success,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "center",
      marginTop: 12,
    },
    verificationIcon: {
      width: 38,
      height: 38,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 19,
      backgroundColor: colors.surfaceSecondary,
    },
    verificationCopy: {
      flex: 1,
    },
    verificationTitle: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "700",
    },
    verificationDescription: {
      color: colors.textSecondary,
      fontSize: 10,
      lineHeight: 15,
      marginTop: 4,
    },
    verificationStatus: {
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 12,
      backgroundColor: colors.surfaceSecondary,
    },
    verificationStatusComplete: {
      backgroundColor: colors.success,
    },
    verificationStatusText: {
      color: colors.textSecondary,
      fontSize: 9,
      fontWeight: "700",
    },
    verificationStatusTextComplete: {
      color: colors.textInverse,
    },
    verificationBadgeInfo: {
      padding: 14,
      borderRadius: 13,
      marginTop: 14,
      gap: 8,
      backgroundColor: colors.card,
    },
    verificationPrivacyNote: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 12,
      borderRadius: 12,
      marginTop: 16,
      backgroundColor: colors.surfaceSecondary,
    },
    verificationPrivacyText: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: 10,
      lineHeight: 15,
    },
    privacyNotice: {
      padding: 13,
      borderRadius: 12,
      marginBottom: 12,
      backgroundColor: colors.surfaceSecondary,
    },
    privacyNoticeText: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 17,
    },
    notificationIntro: {
      padding: 14,
      borderRadius: 13,
      marginBottom: 8,
      backgroundColor: colors.surfaceSecondary,
    },
    notificationIntroTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
    },
    notificationIntroCopy: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 17,
      marginTop: 5,
    },
    notificationGroup: {
      paddingHorizontal: 13,
      borderRadius: 13,
      backgroundColor: colors.card,
    },
    notificationRow: {
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    notificationRowLast: {
      borderBottomWidth: 0,
    },
    notificationTitle: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "600",
    },
    notificationQuietHours: {
      paddingVertical: 13,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    notificationQuietTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "700",
    },
    notificationQuietDescription: {
      color: colors.textSecondary,
      fontSize: 10,
      lineHeight: 15,
      marginTop: 4,
    },
    notificationQuietToggle: {
      minHeight: 54,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 5,
    },
    notificationTimeRow: {
      flexDirection: "row",
      gap: 10,
      marginTop: 5,
    },
    notificationTimeField: {
      flex: 1,
    },
    notificationTimeLabel: {
      color: colors.textSecondary,
      fontSize: 10,
      marginBottom: 5,
    },
    notificationTimeInput: {
      minHeight: 42,
      paddingHorizontal: 11,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      color: colors.text,
      backgroundColor: colors.inputBackground,
    },
    notificationTimeHint: {
      color: colors.textMuted,
      fontSize: 9,
      lineHeight: 14,
      marginTop: 6,
    },
    notificationSecurityRow: {
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    notificationAlwaysOn: {
      color: colors.success,
      fontSize: 10,
      fontWeight: "700",
    },
    privacySectionTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
      marginTop: 16,
      marginBottom: 8,
    },
    privacyGroup: {
      paddingHorizontal: 13,
      borderRadius: 13,
      backgroundColor: colors.card,
    },
    privacyRow: {
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    privacyRowLast: {
      borderBottomWidth: 0,
    },
    privacyListLink: {
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    privacyListLinkCopy: {
      flex: 1,
    },
    privacyListCount: {
      minWidth: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 7,
      borderRadius: 14,
      backgroundColor: colors.surfaceSecondary,
    },
    privacyListCountText: {
      color: colors.text,
      fontSize: 10,
      fontWeight: "700",
    },
    privacyCopy: {
      flex: 1,
    },
    privacyTitle: {
      color: colors.text,
      fontSize: 12,
      fontWeight: "600",
    },
    privacyDescription: {
      color: colors.textSecondary,
      fontSize: 10,
      lineHeight: 15,
      marginTop: 3,
    },
    privacyStatus: {
      color: colors.textMuted,
      fontSize: 11,
      textAlign: "center",
      marginTop: 10,
    },
    privacyError: {
      color: colors.error,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 10,
    },
    privacyMemberRow: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    privacyRemoveButton: {
      minHeight: 34,
      justifyContent: "center",
      paddingHorizontal: 12,
      borderRadius: 17,
      backgroundColor: colors.surfaceSecondary,
    },
    privacyRemoveText: {
      color: PROFILE_ACCENT,
      fontSize: 11,
      fontWeight: "700",
    },
    deleteAccountButton: {
      minHeight: 46,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 23,
      marginTop: 8,
      borderWidth: 1,
      borderColor: colors.error,
    },
    deleteAccountText: {
      color: colors.error,
      fontSize: 12,
      fontWeight: "700",
    },
    deleteConfirmation: {
      padding: 14,
      borderRadius: 13,
      marginTop: 8,
      backgroundColor: colors.surfaceSecondary,
    },
    deleteConfirmationTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
    },
    deleteConfirmationBody: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 17,
      marginTop: 7,
    },
    deleteActions: {
      flexDirection: "row",
      gap: 8,
      marginTop: 14,
    },
    deleteCancelButton: {
      flex: 1,
      minHeight: 42,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 21,
      borderWidth: 1,
      borderColor: colors.border,
    },
    deleteCancelText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: "600",
    },
    deleteConfirmButton: {
      flex: 1,
      minHeight: 42,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 21,
      backgroundColor: colors.error,
    },
    deleteConfirmText: {
      color: colors.textInverse,
      fontSize: 11,
      fontWeight: "700",
    },
    previewName: {
      color: colors.text,
      fontSize: 22,
      fontWeight: "700",
    },
    previewNameLine: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 16,
    },
    previewLocation: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 4,
    },
    detailBlock: {
      padding: 14,
      borderRadius: 13,
      marginTop: 12,
      backgroundColor: colors.card,
    },
    detailLabel: {
      color: PROFILE_ACCENT,
      fontSize: 11,
      fontWeight: "700",
    },
    detailValue: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 7,
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 9,
    },
    chip: {
      overflow: "hidden",
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderRadius: 14,
      color: colors.text,
      backgroundColor: colors.surfaceSecondary,
      fontSize: 10,
    },
    modalAction: {
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 24,
      marginTop: 18,
      backgroundColor: PROFILE_ACCENT,
    },
    modalActionText: {
      color: "#331B1D",
      fontSize: 12,
      fontWeight: "700",
    },
    previewNote: {
      color: colors.textMuted,
      fontSize: 10,
      lineHeight: 16,
      marginTop: 12,
    },
    panelIntro: {
      minHeight: 78,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 15,
      borderRadius: 14,
      backgroundColor: colors.surfaceSecondary,
    },
    panelIntroTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: "600",
    },
    statusPanel: {
      alignItems: "center",
      paddingHorizontal: 18,
      paddingTop: 60,
    },
    statusIcon: {
      width: 62,
      height: 62,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 31,
      backgroundColor: colors.surfaceSecondary,
    },
    statusTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "700",
      textAlign: "center",
      marginTop: 20,
    },
    statusBody: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 20,
      textAlign: "center",
      marginTop: 9,
    },
  });

export type ProfileStyles = ReturnType<typeof createStyles>;

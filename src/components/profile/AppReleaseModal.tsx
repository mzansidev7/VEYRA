import { useEffect, useMemo, useState } from "react";
import {
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Info,
  Link2,
  Share2,
  Sparkles,
  X,
} from "lucide-react-native";
import VeyraLoader from "../../reusables/VeyraLoader";
import { getAppReleases } from "../../data/appReleases";
import type { AppReleaseMedia, AppReleaseUpdate } from "../../data/appReleases";
import type { SystemColors } from "../../systemColors";

type Props = {
  visible: boolean;
  colors: SystemColors;
  onClose: () => void;
};

const mediaCardStyle = {
  overflow: "hidden" as const,
  width: "100%" as const,
  height: 220,
  borderWidth: 1,
  borderRadius: 22,
};
const mediaStyle = {
  width: "100%" as const,
  height: "100%" as const,
};

function ReleaseVideo({ media }: { media: AppReleaseMedia }) {
  const player = useVideoPlayer(media.url);
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={mediaStyle}
    />
  );
}

function ReleaseMediaCard({
  media,
  colors,
}: {
  media: AppReleaseMedia;
  colors: SystemColors;
}) {
  return (
    <View
      style={[
        mediaCardStyle,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {media.kind === "image" ? (
        <Image
          accessibilityLabel="Version update image"
          resizeMode="contain"
          source={{ uri: media.url }}
          style={mediaStyle}
        />
      ) : (
        <ReleaseVideo media={media} />
      )}
    </View>
  );
}

function formatPublishedDate(publishedAt: string): string {
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return "Recently published";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function ReleaseHistoryList({
  releases,
  colors,
  onSelect,
}: {
  releases: AppReleaseUpdate[];
  colors: SystemColors;
  onSelect: (id: string) => void;
}) {
  const themedStyles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView
      contentContainerStyle={themedStyles.historyContent}
      showsVerticalScrollIndicator={false}
    >
      <LinearGradient
        colors={["#4802A2", "#7B138A", "#C90D53"]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={themedStyles.historyHero}
      >
        <View style={themedStyles.heroOrb} />
        <View style={themedStyles.historyHeroIcon}>
          <Sparkles color="#FFFFFF" size={21} />
        </View>
        <Text style={themedStyles.historyHeroTitle}>
          What’s new with VEYRA
        </Text>
        <Text style={themedStyles.historyHeroDescription}>
          Explore the latest releases, updates, and improvements.
        </Text>
      </LinearGradient>

      <View style={themedStyles.historyHeading}>
        <View>
          <Text style={themedStyles.sectionTitle}>Release history</Text>
          <Text style={themedStyles.sectionSubtitle}>
            {releases.length} {releases.length === 1 ? "update" : "updates"}
          </Text>
        </View>
      </View>

      <View style={themedStyles.historyList}>
        {releases.map((release, index) => {
          const isLatest = index === 0;
          const badgeText = isLatest
            ? release.downloadUrl
              ? "LATEST RELEASE"
              : "LATEST UPDATE"
            : release.downloadUrl
              ? "RELEASE"
              : "UPDATE";

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View VEYRA ${release.version}, ${badgeText.toLowerCase()}`}
              key={release.id}
              onPress={() => onSelect(release.id)}
              style={({ pressed }) => [
                themedStyles.historyItem,
                isLatest && themedStyles.latestHistoryItem,
                pressed && themedStyles.pressed,
              ]}
            >
              <View
                style={[
                  themedStyles.historyItemIcon,
                  isLatest && themedStyles.latestHistoryItemIcon,
                ]}
              >
                {release.downloadUrl ? (
                  <Download
                    color={isLatest ? colors.textInverse : colors.brandViolet}
                    size={18}
                  />
                ) : (
                  <Sparkles
                    color={isLatest ? colors.textInverse : colors.brandViolet}
                    size={18}
                  />
                )}
              </View>
              <View style={themedStyles.historyItemText}>
                <View style={themedStyles.historyItemTopline}>
                  <Text style={themedStyles.historyVersion}>
                    VEYRA {release.version}
                  </Text>
                  <Text
                    style={[
                      themedStyles.historyBadge,
                      isLatest && themedStyles.latestHistoryBadge,
                    ]}
                  >
                    {badgeText}
                  </Text>
                </View>
                <View style={themedStyles.historyDateRow}>
                  <CalendarDays color={colors.textMuted} size={12} />
                  <Text style={themedStyles.historyDate}>
                    {formatPublishedDate(release.publishedAt)}
                  </Text>
                </View>
              </View>
              <ChevronRight color={colors.textSecondary} size={19} />
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

export function AppReleaseModal({ visible, colors, onClose }: Props) {
  const themedStyles = useMemo(() => createStyles(colors), [colors]);
  const [releases, setReleases] = useState<AppReleaseUpdate[]>([]);
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    setLoadError("");
    setActionMessage("");
    setSelectedReleaseId(null);
    void getAppReleases()
      .then((latestReleases) => {
        if (active) setReleases(latestReleases);
      })
      .catch((error: unknown) => {
        if (active) {
          setReleases([]);
          setLoadError(
            error instanceof Error
              ? error.message
              : "Release updates could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visible]);

  const release =
    releases.find((item) => item.id === selectedReleaseId) ?? null;
  const isLatestRelease = Boolean(
    release && releases[0]?.id === release.id,
  );

  const shareDownloadLink = async () => {
    if (!release?.downloadUrl) return;
    setActionMessage("");
    try {
      const downloadUrl = release.downloadUrl;
      const message = `Download VEYRA version ${release.version}: ${downloadUrl}`;
      if (Platform.OS === "web") {
        if (typeof navigator.share === "function") {
          await navigator.share({
            title: `VEYRA version ${release.version}`,
            text: `Download VEYRA version ${release.version}`,
            url: downloadUrl,
          });
        } else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(downloadUrl);
          setActionMessage("Download link copied to clipboard.");
        } else {
          throw new Error("Sharing is not supported by this browser.");
        }
      } else {
        await Share.share({
          title: `VEYRA version ${release.version}`,
          message,
          url: downloadUrl,
        });
      }
    } catch (error) {
      if (
        Platform.OS === "web" &&
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return;
      }
      setActionMessage(
        error instanceof Error
          ? error.message
          : "The download link could not be shared.",
      );
    }
  };

  const openDownloadLink = async () => {
    if (!release?.downloadUrl) return;
    setActionMessage("");
    try {
      await Linking.openURL(release.downloadUrl);
    } catch (error) {
      setActionMessage(
        error instanceof Error
          ? `Could not open the download link: ${error.message}`
          : "Could not open the download link.",
      );
    }
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={visible}
    >
      <SafeAreaView edges={["top", "bottom"]} style={themedStyles.screen}>
        <View style={themedStyles.header}>
          <View style={themedStyles.headerLeading}>
            {release ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to all release updates"
                onPress={() => setSelectedReleaseId(null)}
                style={({ pressed }) => [
                  themedStyles.backButton,
                  pressed && themedStyles.pressed,
                ]}
              >
                <ChevronLeft color={colors.text} size={21} />
              </Pressable>
            ) : null}
            <View>
              <Text style={themedStyles.headerEyebrow}>VEYRA</Text>
              <Text style={themedStyles.headerTitle}>
                {release ? `Version ${release.version}` : "Release updates"}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close version update"
            onPress={onClose}
            style={({ pressed }) => [
              themedStyles.closeButton,
              pressed && themedStyles.pressed,
            ]}
          >
            <X color={colors.textSecondary} size={20} />
          </Pressable>
        </View>

        {loading ? (
          <View style={themedStyles.loading}>
            <VeyraLoader
              size="medium"
              imageWidth={40}
              imageHeight={40}
              imageMarginBottom={8}
            />
          </View>
        ) : loadError ? (
          <View style={themedStyles.emptyState}>
            <View style={themedStyles.stateIcon}>
              <Info color={colors.error} size={24} />
            </View>
            <Text accessibilityRole="alert" style={themedStyles.error}>
              {loadError}
            </Text>
          </View>
        ) : release ? (
          <>
            <ScrollView
              contentContainerStyle={themedStyles.content}
              showsVerticalScrollIndicator={false}
            >
              <LinearGradient
                colors={["#4802A2", "#7B138A", "#C90D53"]}
                end={{ x: 1, y: 1 }}
                start={{ x: 0, y: 0 }}
                style={themedStyles.hero}
              >
                <View style={themedStyles.heroOrb} />
                <View style={themedStyles.heroTopRow}>
                  <View style={themedStyles.releaseBadge}>
                    <Sparkles color="#FFFFFF" size={13} />
                    <Text style={themedStyles.releaseBadgeText}>
                      {isLatestRelease
                        ? release.downloadUrl
                          ? "LATEST RELEASE"
                          : "LATEST UPDATE"
                        : release.downloadUrl
                          ? "RELEASE"
                          : "UPDATE"}
                    </Text>
                  </View>
                  <View style={themedStyles.heroIcon}>
                    {release.downloadUrl ? (
                      <Download color="#FFFFFF" size={20} />
                    ) : (
                      <Sparkles color="#FFFFFF" size={20} />
                    )}
                  </View>
                </View>
                <Text style={themedStyles.heroTitle}>
                  VEYRA {release.version}
                </Text>
                <Text style={themedStyles.heroDescription}>
                  {release.downloadUrl
                    ? "A fresh version is ready for you."
                    : "See what’s new in this update."}
                </Text>
              </LinearGradient>

              <View style={themedStyles.sectionHeading}>
                <View style={themedStyles.sectionIcon}>
                  <Sparkles color={colors.brandViolet} size={17} />
                </View>
                <View>
                  <Text style={themedStyles.sectionTitle}>What’s new</Text>
                  <Text style={themedStyles.sectionSubtitle}>
                    The latest improvements from VEYRA
                  </Text>
                </View>
              </View>
              <View style={themedStyles.descriptionCard}>
                <Text style={themedStyles.description}>
                  {release.description}
                </Text>
              </View>

              {release.media.length ? (
                <View style={themedStyles.mediaSection}>
                  <View style={themedStyles.sectionHeading}>
                    <View style={themedStyles.sectionIcon}>
                      <Link2 color={colors.brandViolet} size={17} />
                    </View>
                    <View>
                      <Text style={themedStyles.sectionTitle}>
                        A closer look
                      </Text>
                      <Text style={themedStyles.sectionSubtitle}>
                        Photos and video from this release
                      </Text>
                    </View>
                  </View>
                  <View style={themedStyles.mediaList}>
                    {release.media.map((media, index) => (
                      <ReleaseMediaCard
                        colors={colors}
                        key={`${media.url}-${index}`}
                        media={media}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
              {!release.downloadUrl ? (
                <View style={themedStyles.infoCard}>
                  <Info color={colors.info} size={18} />
                  <Text style={themedStyles.infoText}>
                    This update shares what’s new. There isn’t a download link
                    for this release.
                  </Text>
                </View>
              ) : null}
            </ScrollView>

            <View style={themedStyles.footer}>
              {release.downloadUrl ? (
                <>
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel="Open download link"
                    onPress={() => void openDownloadLink()}
                    style={({ pressed }) => [
                      themedStyles.downloadCard,
                      pressed && themedStyles.pressed,
                    ]}
                  >
                    <View style={themedStyles.downloadIcon}>
                      <Link2 color={colors.brandViolet} size={19} />
                    </View>
                    <View style={themedStyles.downloadText}>
                      <Text style={themedStyles.linkLabel}>DOWNLOAD LINK</Text>
                      <Text numberOfLines={1} style={themedStyles.link}>
                        {release.downloadUrl}
                      </Text>
                    </View>
                    <ArrowUpRight color={colors.textSecondary} size={18} />
                  </Pressable>
                  <View style={themedStyles.actions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Share download link"
                      onPress={() => void shareDownloadLink()}
                      style={({ pressed }) => [
                        themedStyles.shareButton,
                        pressed && themedStyles.pressed,
                      ]}
                    >
                      <Share2 color={colors.text} size={17} />
                      <Text style={themedStyles.shareButtonText}>Share</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void openDownloadLink()}
                      style={({ pressed }) => [
                        themedStyles.openButton,
                        pressed && themedStyles.openButtonPressed,
                      ]}
                    >
                      <Text style={themedStyles.openButtonText}>
                        Download update
                      </Text>
                      <ArrowUpRight color={colors.textInverse} size={17} />
                    </Pressable>
                  </View>
                  {actionMessage ? (
                    <Text
                      accessibilityRole={
                        actionMessage.startsWith("Could not") ||
                          actionMessage.startsWith("Sharing")
                          ? "alert"
                          : "status"
                      }
                      style={
                        actionMessage.startsWith("Could not") ||
                          actionMessage.startsWith("Sharing")
                          ? themedStyles.error
                          : themedStyles.actionMessage
                      }
                    >
                      {actionMessage}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={onClose}
                  style={({ pressed }) => [
                    themedStyles.doneButton,
                    pressed && themedStyles.openButtonPressed,
                  ]}
                >
                  <Text style={themedStyles.openButtonText}>Done</Text>
                </Pressable>
              )}
            </View>
          </>
        ) : releases.length ? (
          <ReleaseHistoryList
            colors={colors}
            onSelect={(id) => {
              setActionMessage("");
              setSelectedReleaseId(id);
            }}
            releases={releases}
          />
        ) : (
          <View style={themedStyles.emptyState}>
            <View style={themedStyles.stateIcon}>
              <Sparkles color={colors.brandViolet} size={25} />
            </View>
            <Text style={themedStyles.title}>No updates yet</Text>
            <Text style={themedStyles.description}>
              Check back here when VEYRA shares its next release or update.
            </Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function createStyles(colors: SystemColors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      minHeight: 72,
      paddingHorizontal: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerLeading: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    headerEyebrow: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1.5,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "800",
      marginTop: 2,
    },
    backButton: {
      width: 40,
      height: 40,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceSecondary,
      borderRadius: 14,
    },
    closeButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.surfaceSecondary,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: {
      opacity: 0.72,
      transform: [{ scale: 0.98 }],
    },
    content: {
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 24,
    },
    historyContent: {
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 28,
    },
    historyHero: {
      minHeight: 190,
      overflow: "hidden",
      justifyContent: "flex-end",
      padding: 22,
      borderRadius: 26,
    },
    historyHeroIcon: {
      width: 42,
      height: 42,
      marginBottom: 18,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.28)",
      backgroundColor: "rgba(255,255,255,0.14)",
      borderRadius: 15,
    },
    historyHeroTitle: {
      color: "#FFFFFF",
      fontSize: 24,
      lineHeight: 30,
      fontWeight: "800",
      letterSpacing: -0.3,
    },
    historyHeroDescription: {
      marginTop: 6,
      color: "rgba(255,255,255,0.86)",
      fontSize: 13,
      lineHeight: 19,
    },
    historyHeading: {
      marginTop: 24,
      marginBottom: 12,
    },
    historyList: {
      gap: 10,
    },
    historyItem: {
      minHeight: 78,
      paddingHorizontal: 12,
      paddingVertical: 11,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 19,
    },
    latestHistoryItem: {
      borderColor: colors.accent,
    },
    historyItemIcon: {
      width: 42,
      height: 42,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceSecondary,
      borderRadius: 14,
    },
    latestHistoryItemIcon: {
      backgroundColor: colors.brandViolet,
    },
    historyItemText: {
      flex: 1,
      gap: 6,
    },
    historyItemTopline: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 7,
    },
    historyVersion: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "800",
    },
    historyBadge: {
      overflow: "hidden",
      paddingHorizontal: 7,
      paddingVertical: 3,
      color: colors.textSecondary,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: 20,
      fontSize: 8,
      fontWeight: "800",
      letterSpacing: 0.45,
    },
    latestHistoryBadge: {
      color: colors.textInverse,
      backgroundColor: colors.primary,
    },
    historyDateRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    historyDate: {
      color: colors.textMuted,
      fontSize: 11,
    },
    hero: {
      minHeight: 210,
      overflow: "hidden",
      justifyContent: "space-between",
      padding: 22,
      borderRadius: 26,
    },
    heroOrb: {
      position: "absolute",
      width: 180,
      height: 180,
      top: -66,
      right: -44,
      borderRadius: 90,
      backgroundColor: "rgba(255,255,255,0.09)",
    },
    heroTopRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    releaseBadge: {
      minHeight: 30,
      paddingHorizontal: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: "rgba(255,255,255,0.18)",
      borderRadius: 20,
    },
    releaseBadgeText: {
      color: "#FFFFFF",
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 0.9,
    },
    heroIcon: {
      width: 42,
      height: 42,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.28)",
      backgroundColor: "rgba(255,255,255,0.14)",
      borderRadius: 15,
    },
    heroTitle: {
      marginTop: 22,
      color: "#FFFFFF",
      fontSize: 30,
      lineHeight: 36,
      fontWeight: "800",
      letterSpacing: -0.5,
    },
    heroDescription: {
      marginTop: 5,
      color: "rgba(255,255,255,0.86)",
      fontSize: 14,
      lineHeight: 20,
    },
    sectionHeading: {
      marginTop: 24,
      marginBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
    },
    sectionIcon: {
      width: 38,
      height: 38,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceSecondary,
      borderRadius: 13,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "800",
    },
    sectionSubtitle: {
      marginTop: 2,
      color: colors.textSecondary,
      fontSize: 11,
    },
    descriptionCard: {
      padding: 16,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
    },
    title: {
      color: colors.text,
      fontSize: 21,
      fontWeight: "800",
    },
    description: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 23,
    },
    mediaSection: {
      marginTop: 2,
    },
    mediaList: {
      gap: 12,
    },
    infoCard: {
      marginTop: 20,
      padding: 14,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      backgroundColor: colors.surfaceSecondary,
      borderRadius: 16,
    },
    infoText: {
      flex: 1,
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 18,
    },
    footer: {
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 10,
      gap: 10,
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    downloadCard: {
      minHeight: 64,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 17,
    },
    downloadIcon: {
      width: 38,
      height: 38,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceSecondary,
      borderRadius: 12,
    },
    downloadText: {
      flex: 1,
      gap: 3,
    },
    linkLabel: {
      color: colors.textSecondary,
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 1,
    },
    link: {
      color: colors.text,
      fontSize: 12,
    },
    actions: {
      flexDirection: "row",
      gap: 10,
    },
    shareButton: {
      width: 112,
      minHeight: 50,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: 16,
    },
    shareButtonText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "700",
    },
    openButton: {
      flex: 1,
      minHeight: 50,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.primary,
      borderRadius: 16,
    },
    doneButton: {
      minHeight: 50,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
      borderRadius: 16,
    },
    openButtonPressed: {
      opacity: 0.82,
    },
    openButtonText: {
      color: colors.textInverse,
      fontSize: 13,
      fontWeight: "700",
    },
    actionMessage: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
    },
    error: {
      color: colors.error,
      fontSize: 13,
      lineHeight: 19,
    },
    loading: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
      gap: 10,
    },
    stateIcon: {
      width: 60,
      height: 60,
      marginBottom: 6,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceSecondary,
      borderRadius: 20,
    },
  });
}

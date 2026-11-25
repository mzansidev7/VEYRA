import { AppState } from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  ActivityIndicator,
  Easing,
  Image,
  ImageBackground,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import type { ScrollViewInstance } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { User } from "@supabase/supabase-js";
import {
  BadgeCheck,
  Bell,
  ChevronLeft,
  ChevronRight,
  Compass,
  EllipsisVertical,
  ExternalLink,
  Heart,
  MessageCircle,
  RefreshCw,
  Sparkles,
  UserRound,
  Video,
  Eye,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { AuthScreen } from "./src/auth/AuthScreen";
import {
  type AuthFormMode,
  createEmailAccount,
  resendSignupConfirmation,
  sendPasswordReset,
  signInWithAppleToken,
  signInWithEmail,
  signInWithGoogleIdToken,
  signOutFromAuth,
} from "./src/auth/auth";
import { supabaseAuth, supabaseClient } from "./src/lib/supabaseClient";
import { OnboardingFlow } from "./src/auth/OnboardingFlow";
import { IdentityVerifiedBadge } from "./src/components/IdentityVerifiedBadge";
import { ChatScreen } from "./src/components/chat/ChatScreen";
import { VideoDiscoveryScreen } from "./src/components/video/VideoDiscoveryScreen";
import { ChemistryScreen } from "./src/components/chemistry/ChemistryScreen";
import { ProfileScreen } from "./src/components/profile/ProfileScreen";
import { getDatingProfile, saveDatingProfile } from "./src/data/datingProfile";
import {
  getNextOnboardingStep,
  removeLocalDatingProfile,
  type LocalDatingProfile,
} from "./src/data/localProfile";
import {
  getDailyFiveFeed,
  getExploreFeed,
  getLikesFeed,
  getProfileVisitors,
  recordProfileView,
  respondToProfileVisitor,
  respondToReceivedLike,
  saveDailyFiveDecision,
  saveExploreDecision,
  type CompatibilityBreakdown,
  type DailyFiveFeed,
  type DiscoveryAction,
  type DiscoveryPerson,
  type ExploreFeed,
  type LikesFeed,
  type LikeRecord,
  type ProfileVisitorRecord,
} from "./src/data/dailyDiscovery";
import { removePrivacySettingsCache } from "./src/asyncStore/profileStore/privacySettingsStore";
import { removeNotificationSettingsCache } from "./src/asyncStore/profileStore/notificationSettingsStore";
import {
  addMemberNotificationDeepLinkListener,
  addMemberNotificationReceivedListener,
  addMemberNotificationResponseListener,
  clearPushNotificationRegistrationCache,
  getMemberNotifications,
  getUnreadMemberNotificationCount,
  markMemberNotificationRead,
  openMemberNotificationLink,
  registerPushNotifications,
  removePushNotificationRegistration,
  type MemberNotification,
} from "./src/data/memberNotifications";
import { removeVerificationDataCache } from "./src/asyncStore/profileStore/verificationSettingsStore";
import { blockUser, hideProfile } from "./src/data/privacySettings";
import { recordMemberActivity } from "./src/data/support";
import { startAppPresence, useOnlineStatuses } from "./src/data/onlinePresence";
import { getVideoDiscoveryStatus } from "./src/data/videoDiscovery";
import type { OnboardingStep } from "./src/data/localProfile";
import {
  brandColors,
  systemColors,
  type SystemColors,
} from "./src/systemColors";

type Tab = "discover" | "video" | "likes" | "chats" | "chemistry" | "profile";
type DiscoveryMode = "daily" | "explore";
type LikesSection = "likes" | "matches" | "visitors";
type LikeDirection = "received" | "sent";
type VisitorFilter = "all" | "new" | "recent";
type NotificationFilter = "all" | "unread" | "read";
type Person = DiscoveryPerson;
type SwipeAction = DiscoveryAction;

const COMPATIBILITY_DIMENSIONS: {
  key: keyof Omit<CompatibilityBreakdown, "version">;
  label: string;
  weight: number;
}[] = [
  {
    key: "relationshipIntentions",
    label: "Relationship intentions",
    weight: 25,
  },
  { key: "coreValues", label: "Core values", weight: 25 },
  { key: "lifestyle", label: "Lifestyle", weight: 15 },
  { key: "datingDNA", label: "Dating DNA", weight: 15 },
  { key: "sharedInterests", label: "Shared interests", weight: 10 },
  { key: "communication", label: "Communication", weight: 10 },
];

const ACCENT = "#E98B78";
const MUTED = "#B8AEB2";

type AuthStage = "loading" | "signed-out" | "onboarding" | "discover" | "error";

function notificationDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function notificationDateGroup(createdAt: string): string {
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return "EARLIER";

  const today = notificationDateKey(new Date());
  const yesterdayDate = new Date(`${today}T12:00:00Z`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const dateKey = notificationDateKey(date);
  if (dateKey === today) return "TODAY";
  if (dateKey === notificationDateKey(yesterdayDate)) return "YESTERDAY";
  return "EARLIER";
}

function notificationTimeLabel(createdAt: string): string {
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return "Recently";

  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 1) return "Just now";
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ago`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`;
  }
  if (notificationDateGroup(createdAt) === "YESTERDAY") return "Yesterday";
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(timestamp));
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const [stage, setStage] = useState<AuthStage>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [localProfile, setLocalProfile] = useState<LocalDatingProfile | null>(
    null,
  );
  const [authError, setAuthError] = useState("");
  const [sessionNotice, setSessionNotice] = useState("");
  const authLoadAttempt = useRef(0);
  const activeUserId = useRef<string | null>(null);

  const loadUserProfile = useCallback(async (currentUser: User) => {
    const attempt = ++authLoadAttempt.current;
    activeUserId.current = currentUser.id;
    setUser(currentUser);
    setAuthError("");
    setSessionNotice("");
    setStage("loading");
    try {
      const profile = await getDatingProfile(currentUser.id);
      if (
        attempt !== authLoadAttempt.current ||
        activeUserId.current !== currentUser.id
      ) {
        return;
      }
      setLocalProfile(profile);
      setStage(
        getNextOnboardingStep(profile) === "complete"
          ? "discover"
          : "onboarding",
      );
    } catch (error) {
      if (
        attempt !== authLoadAttempt.current ||
        activeUserId.current !== currentUser.id
      ) {
        return;
      }
      setAuthError(
        error instanceof Error ? error.message : "Could not load your profile.",
      );
      setStage("error");
    }
  }, []);

  useEffect(() => {
    if (!supabaseAuth) {
      authLoadAttempt.current += 1;
      activeUserId.current = null;
      setUser(null);
      setStage("signed-out");
      return;
    }

    const {
      data: { subscription },
    } = supabaseAuth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED") return;
      if (session?.user) {
        setSessionNotice("");
        void loadUserProfile(session.user);
        return;
      }
      if (event !== "INITIAL_SESSION" && event !== "SIGNED_OUT") return;
      authLoadAttempt.current += 1;
      activeUserId.current = null;
      setUser(null);
      setLocalProfile(null);
      setAuthError("");
      setStage("signed-out");
    });
    return () => subscription.unsubscribe();
  }, [loadUserProfile]);

  useEffect(() => {
    const client = supabaseClient;
    if (!client) return;

    void client.auth.startAutoRefresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void client.auth.startAutoRefresh();
      } else {
        void client.auth.stopAutoRefresh();
      }
    });
    return () => {
      subscription.remove();
      void client.auth.stopAutoRefresh();
    };
  }, []);

  useEffect(() => {
    if (!user || stage === "signed-out") return;
    const recordActivity = () => {
      void recordMemberActivity().catch((error: unknown) => {
        console.error("Could not record member activity.", error);
      });
    };

    if (AppState.currentState === "active") recordActivity();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") recordActivity();
    });

    return () => subscription.remove();
  }, [stage, user]);

  const handleEmail = useCallback(
    async (email: string, password: string, mode: AuthFormMode) => {
      if (mode === "sign-up") {
        return createEmailAccount(email, password);
      }
      await signInWithEmail(email, password);
    },
    [],
  );
  const handleGoogle = useCallback(async (idToken: string) => {
    await signInWithGoogleIdToken(idToken);
  }, []);
  const handleApple = useCallback(
    async (identityToken: string, rawNonce: string) => {
      await signInWithAppleToken(identityToken, rawNonce);
    },
    [],
  );
  const handleResetPassword = useCallback(async (email: string) => {
    await sendPasswordReset(email);
  }, []);
  const handleResendConfirmation = useCallback(async (email: string) => {
    await resendSignupConfirmation(email);
  }, []);
  const handleSaveProfile = useCallback(
    async (profile: LocalDatingProfile) => {
      if (!user) throw new Error("Sign in again to save your profile.");
      const savedProfile = await saveDatingProfile(user.id, profile);
      setLocalProfile(savedProfile);
      return savedProfile;
    },
    [user],
  );

  if (stage === "loading") return <LoadingScreen />;

  if (stage === "signed-out") {
    return (
      <AuthScreen
        notice={sessionNotice}
        onGoogle={handleGoogle}
        onApple={handleApple}
        onEmail={handleEmail}
        onResetPassword={handleResetPassword}
        onResendConfirmation={handleResendConfirmation}
      />
    );
  }

  if (stage === "error" && user) {
    return (
      <StartupErrorScreen
        message={authError}
        onRetry={() => void loadUserProfile(user)}
        onSignOut={() => void signOutFromAuth()}
      />
    );
  }

  if (stage === "onboarding" && user && localProfile) {
    return (
      <OnboardingFlow
        initialProfile={localProfile}
        onSave={handleSaveProfile}
        onComplete={() => setStage("discover")}
        onAgeRestricted={async () => {
          setSessionNotice(
            "VEYRA is for adults 18 and older. You’ve been signed out.",
          );
          if (!supabaseAuth) {
            throw new Error(
              "Authentication is unavailable; we couldn’t sign you out.",
            );
          }
          const { error: signOutError } = await supabaseAuth.signOut({
            scope: "local",
          });
          if (signOutError) {
            throw new Error(`Could not sign out: ${signOutError.message}`);
          }
        }}
      />
    );
  }

  if (stage === "discover" && user) {
    return (
      <DiscoveryApp
        localProfile={localProfile}
        userId={user.id}
        userEmail={user.email ?? null}
        onSaveProfile={handleSaveProfile}
        onSignOut={() => void signOutFromAuth()}
        onSessionExpired={async () => {
          setSessionNotice(
            "Your session has expired. You’ve been signed out. Please log in again.",
          );
          if (!supabaseAuth) {
            setAuthError(
              "Could not sign out because authentication is unavailable.",
            );
            return;
          }
          const { error: signOutError } = await supabaseAuth.signOut({
            scope: "local",
          });
          if (signOutError) {
            setAuthError(
              `Your session expired, but sign-out failed: ${signOutError.message}`,
            );
            throw signOutError;
          }
        }}
        onAccountDeleted={async () => {
          let localCleanupError: unknown;
          try {
            await Promise.all([
              removeLocalDatingProfile(user.id),
              removePrivacySettingsCache(user.id),
              removeNotificationSettingsCache(user.id),
              clearPushNotificationRegistrationCache(user.id),
              removeVerificationDataCache(user.id),
            ]);
          } catch (error) {
            localCleanupError = error;
          }

          if (!supabaseAuth) {
            throw new Error(
              "Your account was deleted, but local sign-out is unavailable.",
            );
          }
          const { error: signOutError } = await supabaseAuth.signOut({
            scope: "local",
          });
          if (localCleanupError) {
            throw new Error(
              "Your account was deleted, but its local profile cache could not be removed.",
              {
                cause: localCleanupError,
              },
            );
          }
          if (signOutError) {
            throw new Error(
              `Your account was deleted, but local sign-out failed: ${signOutError.message}`,
            );
          }
        }}
      />
    );
  }

  return <LoadingScreen />;
}

function DiscoveryApp({
  localProfile,
  userId,
  userEmail,
  onSaveProfile,
  onSignOut,
  onSessionExpired,
  onAccountDeleted,
}: {
  localProfile: LocalDatingProfile | null;
  userId: string;
  userEmail: string | null;
  onSaveProfile: (profile: LocalDatingProfile) => Promise<LocalDatingProfile>;
  onSignOut: () => void;
  onSessionExpired: () => Promise<void>;
  onAccountDeleted: () => Promise<void>;
}) {
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const profileColors = systemColors[isDark ? "dark" : "light"];
  const [activeTab, setActiveTab] = useState<Tab>("discover");
  const [isVideoCallActive, setIsVideoCallActive] = useState(false);
  const [isNotificationInboxVisible, setIsNotificationInboxVisible] =
    useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [selectedNotificationId, setSelectedNotificationId] = useState<
    string | null
  >(null);
  const [notificationFilter, setNotificationFilter] =
    useState<NotificationFilter>("all");
  const [memberNotifications, setMemberNotifications] = useState<
    MemberNotification[]
  >([]);
  const [notificationError, setNotificationError] = useState("");
  const [pushSetupMessage, setPushSetupMessage] = useState("");
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [notificationRefreshKey, setNotificationRefreshKey] = useState(0);
  const [unreadCountRefreshKey, setUnreadCountRefreshKey] = useState(0);
  const filteredNotifications = useMemo(
    () =>
      memberNotifications.filter((notification) => {
        if (notificationFilter === "unread") return notification.read_at === null;
        if (notificationFilter === "read") return notification.read_at !== null;
        return true;
      }),
    [memberNotifications, notificationFilter],
  );
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>("daily");
  const [dailyFeed, setDailyFeed] = useState<DailyFiveFeed | null>(null);
  const [exploreFeed, setExploreFeed] = useState<ExploreFeed | null>(null);
  const [likesFeed, setLikesFeed] = useState<LikesFeed | null>(null);
  const [likesSection, setLikesSection] = useState<LikesSection>("likes");
  const [likeDirection, setLikeDirection] = useState<LikeDirection>("received");
  const [profileVisitors, setProfileVisitors] = useState<
    ProfileVisitorRecord[]
  >([]);
  const [visitorFilter, setVisitorFilter] = useState<VisitorFilter>("all");
  const [likesError, setLikesError] = useState("");
  const [likesMessage, setLikesMessage] = useState("");
  const [isLoadingLikes, setIsLoadingLikes] = useState(false);
  const [isLoadingVisitors, setIsLoadingVisitors] = useState(false);
  const [isRespondingToLike, setIsRespondingToLike] = useState(false);
  const [likedBackUserIds, setLikedBackUserIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedLikeProfile, setSelectedLikeProfile] = useState<{
    person: Person;
    canRespond: boolean;
  } | null>(null);
  const [profileDetailsPhotoIndex, setProfileDetailsPhotoIndex] = useState(0);
  const [exploreProfileIndex, setExploreProfileIndex] = useState(0);
  const [isLoadingDailyFive, setIsLoadingDailyFive] = useState(true);
  const [isLoadingExplore, setIsLoadingExplore] = useState(false);
  const [dailyFiveError, setDailyFiveError] = useState("");
  const [exploreError, setExploreError] = useState("");
  const [exploreRadiusKm, setExploreRadiusKm] = useState(
    localProfile?.preferences.exploreRadiusKm ?? 50,
  );
  const [exploreIntention, setExploreIntention] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState("");
  const [isSavingDecision, setIsSavingDecision] = useState(false);
  const [safetyPrompt, setSafetyPrompt] = useState<
    "menu" | "hide" | "block" | null
  >(null);
  const [safetyError, setSafetyError] = useState("");
  const [isUpdatingSafety, setIsUpdatingSafety] = useState(false);
  const [compatibilityPerson, setCompatibilityPerson] = useState<Person | null>(
    null,
  );
  const [feedback, setFeedback] = useState("");
  const [superLikeTargetId, setSuperLikeTargetId] = useState<string | null>(
    null,
  );
  const [presenceError, setPresenceError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [editingStep, setEditingStep] = useState<Exclude<
    OnboardingStep,
    "complete"
  > | null>(null);
  const swipeX = useRef(new Animated.Value(0)).current;
  const swipeY = useRef(new Animated.Value(0)).current;
  const superLikeProgress = useRef(new Animated.Value(0)).current;
  const superLikePulseActive = useRef(false);
  const profileDetailsPhotoScroll = useRef<ScrollViewInstance>(null);
  const profileDetailsPhotoIndexRef = useRef(0);
  const likesLoadAttempt = useRef(0);
  const visitorsLoadAttempt = useRef(0);
  const optimisticSentLikes = useRef(new Map<string, LikeRecord>());
  const hasLoadedDailyFive = useRef(false);
  const dailyFiveLoadInFlight = useRef(false);
  const dailyFiveLoadAttempt = useRef(0);
  const dailyFeedExpiresAt = useRef<string | null>(null);
  const hasLoadedExplore = useRef(false);
  const exploreLoadAttempt = useRef(0);
  const decisionInFlight = useRef(false);
  const pendingDecisionIds = useRef(new Set<string>());
  const locallyDismissedDailyIds = useRef(new Set<string>());
  const locallyDismissedExploreIds = useRef(new Set<string>());
  const dailyCycleExpiresAt = useRef<string | null>(null);
  const currentPerson =
    discoveryMode === "daily"
      ? (dailyFeed?.recommendations[0] ?? null)
      : (exploreFeed?.profiles[exploreProfileIndex] ?? null);
  const incomingLikes = likesFeed?.incoming ?? [];
  const sentLikes = likesFeed?.sent ?? [];
  const filteredProfileVisitors = profileVisitors.filter((visitor) => {
    if (visitorFilter === "new") return isNewVisitor(visitor.firstViewedAt);
    if (visitorFilter === "recent") return isRecentVisitor(visitor.viewedAt);
    return true;
  });
  const activeProfileCount =
    likesSection === "likes"
      ? likeDirection === "received"
        ? incomingLikes.length
        : sentLikes.length
      : likesSection === "matches"
        ? (likesFeed?.matches.length ?? 0)
        : filteredProfileVisitors.length;
  const isSingleProfileResult = activeProfileCount === 1;
  const currentPersonAlreadyLiked =
    currentPerson !== null &&
    (likedBackUserIds.has(currentPerson.id) ||
      sentLikes.some((like) => like.person.id === currentPerson.id));
  const presenceTargetIds = useMemo(
    () =>
      [
        ...(dailyFeed?.recommendations.map((person) => person.id) ?? []),
        ...(dailyFeed?.likes.map((person) => person.id) ?? []),
        ...(exploreFeed?.profiles.map((person) => person.id) ?? []),
        ...(likesFeed?.incoming.map((like) => like.person.id) ?? []),
        ...(likesFeed?.sent.map((like) => like.person.id) ?? []),
        ...(likesFeed?.matches.map((match) => match.person.id) ?? []),
        selectedLikeProfile?.person.id,
        currentPerson?.id,
      ].filter((id): id is string => Boolean(id)),
    [
      currentPerson?.id,
      dailyFeed,
      exploreFeed,
      likesFeed,
      selectedLikeProfile?.person.id,
    ],
  );
  const { onlineUserIds, error: onlineStatusError } = useOnlineStatuses(
    userId,
    presenceTargetIds,
  );

  useEffect(
    () =>
      startAppPresence(userId, (error) =>
        setPresenceError(error?.message ?? ""),
      ),
    [userId],
  );

  const loadDailyFive = useCallback(async (force = false) => {
    if (dailyFiveLoadInFlight.current && !force) return;
    const attempt = ++dailyFiveLoadAttempt.current;
    dailyFiveLoadInFlight.current = true;
    if (
      !hasLoadedDailyFive.current ||
      (dailyFeedExpiresAt.current !== null &&
        Date.parse(dailyFeedExpiresAt.current) <= Date.now())
    ) {
      setIsLoadingDailyFive(true);
    }
    setDailyFiveError("");
    try {
      const feed = await getDailyFiveFeed();
      if (attempt !== dailyFiveLoadAttempt.current) return;
      if (Date.parse(feed.expiresAt) <= Date.now()) {
        throw new Error(
          "The server returned an expired Daily 5 set. Try again, and confirm the Daily 5 renewal migration is applied if this continues.",
        );
      }
      if (
        dailyCycleExpiresAt.current !== null &&
        dailyCycleExpiresAt.current !== feed.expiresAt
      ) {
        locallyDismissedDailyIds.current.clear();
      }
      dailyCycleExpiresAt.current = feed.expiresAt;
      dailyFeedExpiresAt.current = feed.expiresAt;
      setDailyFeed({
        ...feed,
        recommendations: feed.recommendations.filter(
          (person) => !locallyDismissedDailyIds.current.has(person.id),
        ),
      });
      hasLoadedDailyFive.current = true;
    } catch (error) {
      if (attempt === dailyFiveLoadAttempt.current) {
        setDailyFiveError(
          error instanceof Error ? error.message : "Could not load Daily 5.",
        );
      }
    } finally {
      if (attempt === dailyFiveLoadAttempt.current) {
        dailyFiveLoadInFlight.current = false;
        setIsLoadingDailyFive(false);
      }
    }
  }, []);

  const loadLikes = useCallback(async () => {
    const attempt = ++likesLoadAttempt.current;
    setIsLoadingLikes(true);
    setLikesError("");
    try {
      const feed = await getLikesFeed();
      if (attempt !== likesLoadAttempt.current) return;
      const serverSentIds = new Set(feed.sent.map((like) => like.person.id));
      for (const id of serverSentIds) optimisticSentLikes.current.delete(id);
      const optimisticSent = Array.from(optimisticSentLikes.current.values());
      setLikesFeed({
        ...feed,
        sent: [
          ...optimisticSent.filter(
            (like) => !serverSentIds.has(like.person.id),
          ),
          ...feed.sent,
        ],
      });
    } catch (error) {
      if (attempt === likesLoadAttempt.current) {
        setLikesError(
          error instanceof Error ? error.message : "Could not load Likes.",
        );
      }
    } finally {
      if (attempt === likesLoadAttempt.current) setIsLoadingLikes(false);
    }
  }, []);

  const loadProfileVisitors = useCallback(async () => {
    const attempt = ++visitorsLoadAttempt.current;
    setIsLoadingVisitors(true);
    setLikesError("");
    try {
      const visitors = await getProfileVisitors();
      if (attempt === visitorsLoadAttempt.current) {
        setProfileVisitors(visitors);
      }
    } catch (error) {
      if (attempt === visitorsLoadAttempt.current) {
        setLikesError(
          error instanceof Error
            ? error.message
            : "Could not load profile visitors.",
        );
      }
    } finally {
      if (attempt === visitorsLoadAttempt.current) {
        setIsLoadingVisitors(false);
      }
    }
  }, []);

  const decideProfileVisitor = useCallback(
    async (visitorId: string, action: "like" | "pass") => {
      if (isRespondingToLike) return;
      setIsRespondingToLike(true);
      setLikesError("");
      setLikesMessage("");
      try {
        const result = await respondToProfileVisitor(visitorId, action);
        setProfileVisitors((current) =>
          current.filter((visitor) => visitor.id !== visitorId),
        );
        if (action === "like") {
          setLikesMessage(
            result.matched
              ? "It’s a match! You can message them in Chats."
              : "Like sent. Your interest is on its way.",
          );
          await loadLikes();
        } else {
          setLikesMessage("Visitor passed.");
        }
      } catch (error) {
        setLikesError(
          error instanceof Error
            ? error.message
            : "Could not save your visitor response.",
        );
      } finally {
        setIsRespondingToLike(false);
      }
    },
    [isRespondingToLike, loadLikes],
  );

  const loadExplore = useCallback(
    async (radiusKm = exploreRadiusKm, intention = exploreIntention) => {
      const attempt = ++exploreLoadAttempt.current;
      if (!hasLoadedExplore.current) setIsLoadingExplore(true);
      setExploreError("");
      try {
        const feed = await getExploreFeed(radiusKm, intention);
        if (attempt === exploreLoadAttempt.current) {
          hasLoadedExplore.current = true;
          setExploreFeed({
            ...feed,
            profiles: feed.profiles.filter(
              (person) => !locallyDismissedExploreIds.current.has(person.id),
            ),
          });
          setExploreProfileIndex(0);
        }
      } catch (error) {
        if (attempt === exploreLoadAttempt.current) {
          setExploreError(
            error instanceof Error ? error.message : "Could not load Explore.",
          );
        }
      } finally {
        if (attempt === exploreLoadAttempt.current) {
          setIsLoadingExplore(false);
        }
      }
    },
    [exploreIntention, exploreRadiusKm],
  );

  useEffect(() => {
    void loadDailyFive();
  }, [loadDailyFive, userId]);

  useEffect(() => {
    const handleNotificationLink = (linkUrl: string | null) => {
      setSelectedNotificationId(null);
      setIsNotificationInboxVisible(true);
      if (linkUrl) {
        void openMemberNotificationLink(linkUrl).catch((openError: unknown) => {
          setPushSetupMessage(
            openError instanceof Error
              ? openError.message
              : "Could not open the notification link.",
          );
        });
      }
    };
    const subscription = addMemberNotificationResponseListener((linkUrl) => {
      handleNotificationLink(linkUrl);
    });
    const deepLinkSubscription =
      addMemberNotificationDeepLinkListener(handleNotificationLink);
    const receivedSubscription = addMemberNotificationReceivedListener(() => {
      setUnreadCountRefreshKey((current) => current + 1);
    });
    return () => {
      subscription.remove();
      deepLinkSubscription.remove();
      receivedSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (
      !userId ||
      activeTab === "video" ||
      activeTab === "chats" ||
      isNotificationInboxVisible ||
      isVideoCallActive
    ) {
      return;
    }
    let active = true;
    let inFlight = false;
    const checkIncomingVideoInvitation = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const status = await getVideoDiscoveryStatus();
        if (!active || status.state !== "pending_acceptance") return;
        if (status.source === "match") {
          setActiveTab("chats");
        } else if (
          status.source === "discovery" &&
          status.myAccepted !== true
        ) {
          setActiveTab("video");
        }
      } catch (error) {
        console.error("Could not check for incoming video invitations.", error);
      } finally {
        inFlight = false;
      }
    };
    void checkIncomingVideoInvitation();
    const interval = setInterval(
      () => void checkIncomingVideoInvitation(),
      5_000,
    );
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [
    activeTab,
    isNotificationInboxVisible,
    isVideoCallActive,
    userId,
  ]);

  useEffect(() => {
    let active = true;
    setIsLoadingNotifications(true);
    setNotificationError("");
    void getMemberNotifications()
      .then(async (notifications) => {
        if (!active) return;
        setMemberNotifications(notifications);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setNotificationError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load notifications.",
          );
        }
      })
      .finally(() => {
        if (active) setIsLoadingNotifications(false);
      });
    return () => {
      active = false;
    };
  }, [isNotificationInboxVisible, notificationRefreshKey, userId]);

  async function openNotificationDetail(
    notification: MemberNotification,
  ): Promise<void> {
    setSelectedNotificationId(notification.id);
    setNotificationError("");
    if (notification.read_at !== null) return;

    try {
      await markMemberNotificationRead(notification.id);
      const readAt = new Date().toISOString();
      setMemberNotifications((current) =>
        current.map((currentNotification) =>
          currentNotification.id === notification.id
            ? { ...currentNotification, read_at: readAt }
            : currentNotification,
        ),
      );
      setUnreadNotificationCount((current) => Math.max(0, current - 1));
    } catch (markError) {
      setNotificationError(
        markError instanceof Error
          ? markError.message
          : "Could not mark this notification as read.",
      );
    }
  }

  useEffect(() => {
    if (isNotificationInboxVisible) return;
    let active = true;
    void getUnreadMemberNotificationCount()
      .then((count) => {
        if (active) setUnreadNotificationCount(count);
      })
      .catch((countError: unknown) => {
        if (active) {
          setNotificationError(
            countError instanceof Error
              ? countError.message
              : "Could not load unread notification count.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [isNotificationInboxVisible, unreadCountRefreshKey, userId]);

  useEffect(() => {
    if (!isNotificationInboxVisible) return;
    let active = true;
    void registerPushNotifications(userId)
      .then((status) => {
        if (!active) return;
        setPushSetupMessage(
          status === "unsupported"
            ? "Push alerts are unavailable on web, in Expo Go, or on this device. In-app notifications are still available."
            : status === "permission-denied"
              ? "Push permission is off for VEYRA on this device. In-app notifications are still available."
              : status === "disabled"
                ? "Push alerts are disabled in your notification preferences. In-app notifications are still available."
                : "",
        );
      })
      .catch((setupError: unknown) => {
        if (active) {
          setPushSetupMessage(
            setupError instanceof Error
              ? setupError.message
              : "Push notifications could not be set up on this device.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [isNotificationInboxVisible, userId]);

  useEffect(() => {
    let active = true;
    void registerPushNotifications(userId, false).catch((setupError: unknown) => {
      if (!active) return;
      setPushSetupMessage(
        setupError instanceof Error
          ? setupError.message
          : "Push notifications could not be set up on this device.",
      );
      console.error("Could not refresh this device's push registration.", setupError);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setClock(Date.now());
        setUnreadCountRefreshKey((current) => current + 1);
        void loadDailyFive(true);
        if (activeTab === "likes") void loadLikes();
        if (discoveryMode === "explore") void loadExplore();
      }
    });
    return () => subscription.remove();
  }, [activeTab, discoveryMode, loadDailyFive, loadExplore, loadLikes]);

  useEffect(() => {
    if (activeTab === "discover" && hasLoadedDailyFive.current) {
      if (discoveryMode === "daily") void loadDailyFive();
    }
    if (activeTab === "discover" && discoveryMode === "explore") {
      void loadExplore();
    }
    if (activeTab === "likes") void loadLikes();
  }, [activeTab, discoveryMode, loadDailyFive, loadExplore, loadLikes]);

  useEffect(() => {
    if (localProfile) {
      setExploreRadiusKm(localProfile.preferences.exploreRadiusKm);
    }
  }, [localProfile]);

  useEffect(() => {
    if (!dailyFeed) return;
    const delay = Math.max(
      Date.parse(dailyFeed.expiresAt) - Date.now() + 500,
      0,
    );
    const timer = setTimeout(() => void loadDailyFive(), delay);
    return () => clearTimeout(timer);
  }, [dailyFeed, loadDailyFive]);

  useEffect(() => {
    if (!dailyFeed) return;
    const remaining = Date.parse(dailyFeed.expiresAt) - clock;
    const timer = setTimeout(
      () => setClock(Date.now()),
      remaining <= 60_000 ? 1_000 : 30_000,
    );
    return () => clearTimeout(timer);
  }, [clock, dailyFeed]);

  const nextRefreshText = useMemo(() => {
    if (!dailyFeed) return "";
    const remaining = Math.max(0, Date.parse(dailyFeed.expiresAt) - clock);
    if (remaining < 60_000) {
      return `New connections in ${Math.ceil(remaining / 1_000)}s`;
    }
    const totalMinutes = Math.floor(remaining / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `New connections in ${minutes}m`;
    return `New connections in ${hours}h ${minutes}m`;
  }, [clock, dailyFeed]);

  const nextExploreResetText = useMemo(() => {
    if (!exploreFeed) return "";
    const remaining = Math.max(0, Date.parse(exploreFeed.resetAt) - clock);
    if (remaining < 60_000) {
      return `Resets in ${Math.ceil(remaining / 1_000)}s`;
    }
    const totalMinutes = Math.ceil(remaining / 60_000);
    return `Resets in ${totalMinutes}m`;
  }, [clock, exploreFeed]);

  useEffect(() => {
    if (
      activeTab !== "discover" ||
      discoveryMode !== "explore" ||
      !exploreFeed
    ) {
      return;
    }

    const resetAt = Date.parse(exploreFeed.resetAt);
    const untilReset = resetAt - Date.now();
    const delay =
      untilReset <= 0
        ? 30_000
        : Math.min(untilReset + 500, untilReset <= 60_000 ? 1_000 : 30_000);
    const timer = setTimeout(() => {
      const now = Date.now();
      setClock(now);
      if (now >= resetAt) void loadExplore();
    }, delay);
    return () => clearTimeout(timer);
  }, [activeTab, clock, discoveryMode, exploreFeed, loadExplore]);

  const isDailyFeedExpired =
    discoveryMode === "daily" &&
    dailyFeed !== null &&
    Date.parse(dailyFeed.expiresAt) <= clock;

  const finishSwipe = useCallback(
    (action: SwipeAction) => {
      const person = currentPerson;
      const mode = discoveryMode;
      const recommendationId = person?.recommendationId;
      if (
        !person ||
        person.outOfRadius ||
        currentPersonAlreadyLiked ||
        (mode === "daily" && isDailyFeedExpired) ||
        (mode === "daily" && !recommendationId) ||
        decisionInFlight.current ||
        pendingDecisionIds.current.has(person.id)
      ) {
        return;
      }

      const optimisticSentLike: LikeRecord | null =
        action === "pass"
          ? null
          : {
              id: `local-${person.id}`,
              person,
              createdAt: new Date().toISOString(),
              status: "pending",
            };
      if (optimisticSentLike) {
        setLikesSection("likes");
        setLikeDirection("sent");
        optimisticSentLikes.current.set(person.id, optimisticSentLike);
        setLikesFeed((feed) => ({
          incoming: feed?.incoming ?? [],
          sent: [
            optimisticSentLike,
            ...(feed?.sent ?? []).filter(
              (like) => like.person.id !== person.id,
            ),
          ],
          matches: feed?.matches ?? [],
        }));
      }

      decisionInFlight.current = true;
      pendingDecisionIds.current.add(person.id);
      (mode === "daily"
        ? locallyDismissedDailyIds.current
        : locallyDismissedExploreIds.current
      ).add(person.id);
      setIsSavingDecision(true);
      setDecisionError("");
      setFeedback("SENDING YOUR DECISION…");

      Animated.timing(swipeX, {
        toValue: action === "pass" ? -width - 100 : width + 100,
        duration: 220,
        useNativeDriver: true,
      }).start(({ finished }) => {
        swipeX.setValue(0);
        swipeY.setValue(0);
        if (finished) {
          if (mode === "daily") {
            setDailyFeed((feed) =>
              feed
                ? {
                    ...feed,
                    recommendations: feed.recommendations.filter(
                      (candidate) => candidate.id !== person.id,
                    ),
                  }
                : feed,
            );
          } else {
            setExploreFeed((feed) =>
              feed
                ? {
                    ...feed,
                    profiles: feed.profiles.filter(
                      (candidate) => candidate.id !== person.id,
                    ),
                  }
                : feed,
            );
            setExploreProfileIndex(0);
          }
          setFeedback(
            action === "pass"
              ? ""
              : `${action === "superlike" ? "" : "LIKE SENT"}`,
          );
        }
        decisionInFlight.current = false;
      });

      void (async () => {
        try {
          if (mode === "daily" && recommendationId) {
            await saveDailyFiveDecision(recommendationId, action);
            setDailyFeed((feed) =>
              feed
                ? {
                    ...feed,
                    exploredCount: Math.min(
                      feed.selectedCount,
                      feed.exploredCount + 1,
                    ),
                  }
                : feed,
            );
          } else {
            const remainingDecisions = await saveExploreDecision(
              person.id,
              action,
              exploreRadiusKm,
              exploreIntention,
            );
            setExploreFeed((feed) =>
              feed ? { ...feed, remainingDecisions } : feed,
            );
          }
          if (action !== "pass") await loadLikes();
        } catch (error) {
          if (optimisticSentLike) {
            optimisticSentLikes.current.delete(person.id);
            setLikesFeed((feed) =>
              feed
                ? {
                    ...feed,
                    sent: feed.sent.filter(
                      (like) => like.id !== optimisticSentLike.id,
                    ),
                  }
                : feed,
            );
          }
          const message =
            error instanceof Error
              ? error.message
              : "Could not save your decision. Please try again.";
          if (optimisticSentLike) setLikesError(message);
          (mode === "daily"
            ? locallyDismissedDailyIds.current
            : locallyDismissedExploreIds.current
          ).delete(person.id);
          setDecisionError(message);
          if (mode === "daily") {
            setDailyFeed((feed) =>
              feed &&
              !feed.recommendations.some(
                (candidate) => candidate.id === person.id,
              )
                ? {
                    ...feed,
                    recommendations: [...feed.recommendations, person],
                  }
                : feed,
            );
          } else {
            setExploreFeed((feed) =>
              feed &&
              !feed.profiles.some((candidate) => candidate.id === person.id)
                ? { ...feed, profiles: [...feed.profiles, person] }
                : feed,
            );
          }
        } finally {
          pendingDecisionIds.current.delete(person.id);
          setIsSavingDecision(pendingDecisionIds.current.size > 0);
        }
      })();
    },
    [
      currentPerson,
      currentPersonAlreadyLiked,
      discoveryMode,
      exploreIntention,
      exploreRadiusKm,
      isDailyFeedExpired,
      loadLikes,
      swipeX,
      swipeY,
      width,
    ],
  );

  const handleSuperLike = useCallback(() => {
    const target = currentPerson;
    const targetMode = discoveryMode;
    if (
      !target ||
      target.outOfRadius ||
      currentPersonAlreadyLiked ||
      (targetMode === "daily" && isDailyFeedExpired) ||
      (targetMode === "daily" && !target.recommendationId) ||
      decisionInFlight.current ||
      pendingDecisionIds.current.has(target.id) ||
      superLikePulseActive.current
    ) {
      return;
    }

    superLikePulseActive.current = true;
    decisionInFlight.current = true;
    setSuperLikeTargetId(target.id);
    superLikeProgress.setValue(0);
    requestAnimationFrame(() => {
      Animated.timing(superLikeProgress, {
        toValue: 1,
        duration: 3200,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start(({ finished }) => {
        superLikePulseActive.current = false;
        decisionInFlight.current = false;
        setSuperLikeTargetId(null);
        if (
          finished &&
          currentPerson?.id === target.id &&
          discoveryMode === targetMode
        ) {
          finishSwipe("superlike");
        }
      });
    });
  }, [
    currentPerson,
    currentPersonAlreadyLiked,
    discoveryMode,
    finishSwipe,
    isDailyFeedExpired,
    superLikeProgress,
  ]);

  const decideReceivedLike = useCallback(
    async (action: "like" | "pass", senderId?: string) => {
      const selected = selectedLikeProfile;
      const targetId = senderId ?? selected?.person.id;
      if (
        (!senderId && !selected?.canRespond) ||
        !targetId ||
        isRespondingToLike
      ) {
        return;
      }
      setIsRespondingToLike(true);
      setLikesError("");
      setLikesMessage("");
      try {
        const result = await respondToReceivedLike(targetId, action);
        if (action === "like") {
          setLikedBackUserIds((userIds) => new Set(userIds).add(targetId));
          if (
            dailyFeed?.recommendations.some((person) => person.id === targetId)
          ) {
            setDailyFeed((feed) =>
              feed
                ? {
                    ...feed,
                    exploredCount: Math.min(
                      feed.selectedCount,
                      feed.exploredCount + 1,
                    ),
                  }
                : feed,
            );
          }
        }
        if (selected?.person.id === targetId) setSelectedLikeProfile(null);
        setLikesMessage(
          action === "pass"
            ? "Like passed. They won’t be notified."
            : result.matched
              ? "It’s a match! You can find them in Matches."
              : "Like sent. Your interest is on its way.",
        );
        await loadLikes();
      } catch (error) {
        setLikesError(
          error instanceof Error
            ? error.message
            : "Could not save your response. Please try again.",
        );
      } finally {
        setIsRespondingToLike(false);
      }
    },
    [dailyFeed, isRespondingToLike, loadLikes, selectedLikeProfile],
  );

  const updateSafetyList = useCallback(async () => {
    if (
      !currentPerson ||
      (safetyPrompt !== "hide" && safetyPrompt !== "block")
    ) {
      return;
    }

    setIsUpdatingSafety(true);
    setSafetyError("");
    try {
      if (safetyPrompt === "hide") {
        await hideProfile(userId, currentPerson.id);
      } else {
        await blockUser(userId, currentPerson.id);
      }
      setSafetyPrompt(null);
      if (discoveryMode === "daily") {
        await loadDailyFive();
      } else {
        await loadExplore();
      }
    } catch (error) {
      setSafetyError(
        error instanceof Error
          ? error.message
          : "Could not update your safety settings.",
      );
    } finally {
      setIsUpdatingSafety(false);
    }
  }, [
    currentPerson,
    discoveryMode,
    loadDailyFive,
    loadExplore,
    safetyPrompt,
    userId,
  ]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !currentPerson?.outOfRadius &&
          !currentPersonAlreadyLiked &&
          !decisionInFlight.current &&
          Math.abs(gesture.dx) > 8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_event, gesture) => {
          swipeX.setValue(gesture.dx);
          swipeY.setValue(gesture.dy * 0.18);
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx > 100) {
            finishSwipe("like");
          } else if (gesture.dx < -100) {
            finishSwipe("pass");
          } else {
            Animated.parallel([
              Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }),
              Animated.spring(swipeY, { toValue: 0, useNativeDriver: true }),
            ]).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.parallel([
            Animated.spring(swipeX, { toValue: 0, useNativeDriver: true }),
            Animated.spring(swipeY, { toValue: 0, useNativeDriver: true }),
          ]).start();
        },
      }),
    [
      currentPerson?.id,
      currentPersonAlreadyLiked,
      currentPerson?.outOfRadius,
      finishSwipe,
      width,
    ],
  );

  const rotation = swipeX.interpolate({
    inputRange: [-width, 0, width],
    outputRange: ["-12deg", "0deg", "12deg"],
    extrapolate: "clamp",
  });
  const likeSwipeOpacity = swipeX.interpolate({
    inputRange: [0, 100],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const passSwipeOpacity = swipeX.interpolate({
    inputRange: [-100, 0],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });
  const profileDetailsPhotos = selectedLikeProfile
    ? selectedLikeProfile.person.photos?.length
      ? selectedLikeProfile.person.photos
      : selectedLikeProfile.person.image
        ? [selectedLikeProfile.person.image]
        : []
    : [];
  const profileDetailsPhotoWidth = Math.min(width - 40, 500);

  useEffect(() => {
    const targetUserId = selectedLikeProfile?.person.id;
    if (!targetUserId || targetUserId === userId) return;
    void recordProfileView(targetUserId).catch((error: unknown) => {
      setLikesError(
        error instanceof Error
          ? error.message
          : "Could not record this profile visit.",
      );
    });
  }, [selectedLikeProfile?.person.id, userId]);

  useEffect(() => {
    profileDetailsPhotoIndexRef.current = 0;
    setProfileDetailsPhotoIndex(0);
    profileDetailsPhotoScroll.current?.scrollTo({ x: 0, animated: false });
  }, [selectedLikeProfile?.person.id]);

  useEffect(() => {
    if (!selectedLikeProfile || profileDetailsPhotos.length < 2) return;
    const timer = setInterval(() => {
      const nextIndex =
        (profileDetailsPhotoIndexRef.current + 1) % profileDetailsPhotos.length;
      profileDetailsPhotoIndexRef.current = nextIndex;
      setProfileDetailsPhotoIndex(nextIndex);
      profileDetailsPhotoScroll.current?.scrollTo({
        x: nextIndex * profileDetailsPhotoWidth,
        animated: true,
      });
    }, 4_000);
    return () => clearInterval(timer);
  }, [
    profileDetailsPhotoWidth,
    profileDetailsPhotos.length,
    selectedLikeProfile?.person.id,
  ]);

  if (editingStep && localProfile) {
    return (
      <OnboardingFlow
        initialProfile={localProfile}
        initialStep={editingStep}
        onSave={onSaveProfile}
        onComplete={() => setEditingStep(null)}
        onCancel={() => setEditingStep(null)}
      />
    );
  }

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        activeTab === "profile" && {
          backgroundColor: profileColors.background,
        },
      ]}
    >
      <StatusBar style={isDark ? "light" : "dark"} />
      <View
        style={[
          styles.app,
          activeTab === "profile" && {
            backgroundColor: profileColors.background,
          },
        ]}
      >
        {activeTab !== "profile" &&
        !isVideoCallActive &&
        !isNotificationInboxVisible ? (
          <View style={styles.header}>
            <Image
              accessible
              accessibilityLabel="VEYRA"
              resizeMode="contain"
              source={require("./assets/VeyraLogo.png")}
              style={styles.logoImage}
            />
            <View style={styles.headerActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  unreadNotificationCount > 0
                    ? `Open notifications, ${unreadNotificationCount} unread`
                    : "Open notifications"
                }
                onPress={() => {
                  setIsNotificationInboxVisible(true);
                }}
                style={({ pressed }) => [
                  styles.notificationButton,
                  pressed && styles.headerButtonPressed,
                ]}
              >
                <Bell color={brandColors.magenta} size={17} strokeWidth={1.9} />
                {unreadNotificationCount > 0 ? (
                  <View
                    accessibilityLabel={`${unreadNotificationCount} unread notifications`}
                    style={styles.notificationUnreadBadge}
                  >
                    <Text style={styles.notificationUnreadBadgeText}>
                      {unreadNotificationCount > 99
                        ? "99+"
                        : unreadNotificationCount}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
              <View style={styles.locationButton}>
                <Text style={styles.locationPin}>⌖</Text>
                <Text style={styles.locationText}>
                  {localProfile?.profile.city || "Your city"}
                </Text>
                <Text style={styles.locationChevron}>⌄</Text>
              </View>
            </View>
          </View>
        ) : null}

        <View style={styles.content}>
          {presenceError || onlineStatusError ? (
            <Text accessibilityRole="alert" style={styles.errorMessage}>
              Online status is unavailable: {presenceError || onlineStatusError}
            </Text>
          ) : null}
          {activeTab === "discover" && (
            <View style={styles.discoverScreen}>
              <View style={styles.discoveryModes}>
                {(["daily", "explore"] as const).map((mode) => (
                  <Pressable
                    key={mode}
                    accessibilityRole="button"
                    accessibilityState={{ selected: discoveryMode === mode }}
                    onPress={() => setDiscoveryMode(mode)}
                    style={[
                      styles.discoveryModeButton,
                      discoveryMode === mode && styles.discoveryModeActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.discoveryModeText,
                        discoveryMode === mode &&
                          styles.discoveryModeTextActive,
                      ]}
                    >
                      {mode === "daily" ? "Daily 5" : "Explore"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.sectionHeading}>
                <View>
                  <Text style={styles.eyebrow}>
                    {discoveryMode === "daily" ? "YOUR DAILY 5" : "EXPLORE"}
                  </Text>
                  <Text style={styles.discoveryHeading}>
                    {discoveryMode === "daily"
                      ? "A little spark?"
                      : "Find a connection"}
                  </Text>
                </View>
                <View style={styles.dailyMeta}>
                  <View style={styles.dailyCount}>
                    <Text style={styles.dailyCountText}>
                      {discoveryMode === "daily"
                        ? dailyFeed
                          ? `${dailyFeed.exploredCount} of ${dailyFeed.selectedCount} explored`
                          : "Loading"
                        : exploreFeed
                          ? `${exploreFeed.remainingDecisions} decisions left`
                          : "Loading"}
                    </Text>
                  </View>
                  {discoveryMode === "daily" && dailyFeed ? (
                    <Text style={styles.countdownText}>{nextRefreshText}</Text>
                  ) : discoveryMode === "explore" && exploreFeed ? (
                    <Text style={styles.countdownText}>
                      {nextExploreResetText}
                    </Text>
                  ) : null}
                </View>
              </View>
              {isDailyFeedExpired ? (
                <View style={styles.dailyRefreshNotice}>
                  {dailyFiveError ? (
                    <>
                      <Text
                        accessibilityRole="alert"
                        style={styles.dailyRefreshError}
                      >
                        {dailyFiveError}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void loadDailyFive()}
                        style={styles.dailyRefreshButton}
                      >
                        <Text style={styles.dailyRefreshButtonText}>
                          Try again
                        </Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <ActivityIndicator
                        size="small"
                        color={brandColors.magenta}
                      />
                      <Text style={styles.dailyRefreshText}>
                        Refreshing your Daily 5…
                      </Text>
                    </>
                  )}
                </View>
              ) : null}
              {discoveryMode === "explore" ? (
                <View style={styles.exploreFilters}>
                  <Text style={styles.filterLabel}>DISTANCE</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterOptions}
                  >
                    {[5, 25, 50, 100, 200].map((radius) => (
                      <Pressable
                        key={radius}
                        accessibilityRole="button"
                        accessibilityState={{
                          selected: exploreRadiusKm === radius,
                        }}
                        onPress={() => {
                          setExploreRadiusKm(radius);
                          if (localProfile) {
                            void onSaveProfile({
                              ...localProfile,
                              preferences: {
                                ...localProfile.preferences,
                                exploreRadiusKm: radius,
                              },
                            }).catch((error: unknown) =>
                              setExploreError(
                                error instanceof Error
                                  ? error.message
                                  : "Could not save your distance preference.",
                              ),
                            );
                          }
                        }}
                        style={[
                          styles.filterChip,
                          exploreRadiusKm === radius && styles.filterChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            exploreRadiusKm === radius &&
                              styles.filterChipTextActive,
                          ]}
                        >
                          {radius} km
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                  <Text style={styles.filterLabel}>INTENTION</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterOptions}
                  >
                    {[
                      null,
                      "Meaningful connection",
                      "A genuine relationship",
                      "Taking things slowly",
                      "Growing together",
                    ].map((intention) => (
                      <Pressable
                        key={intention ?? "all"}
                        accessibilityRole="button"
                        accessibilityState={{
                          selected: exploreIntention === intention,
                        }}
                        onPress={() => {
                          setExploreIntention(intention);
                        }}
                        style={[
                          styles.filterChip,
                          exploreIntention === intention &&
                            styles.filterChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            exploreIntention === intention &&
                              styles.filterChipTextActive,
                          ]}
                        >
                          {intention ?? "All intentions"}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
              {(
                discoveryMode === "daily"
                  ? isLoadingDailyFive
                  : isLoadingExplore
              ) ? (
                <View style={styles.discoveryMessage}>
                  <ActivityIndicator color={ACCENT} />
                  <Text style={styles.emptyMessage}>
                    {discoveryMode === "daily"
                      ? "Preparing your Daily 5…"
                      : "Finding people nearby…"}
                  </Text>
                </View>
              ) : !currentPerson &&
                (discoveryMode === "daily" ? dailyFiveError : exploreError) ? (
                <View style={styles.discoveryMessage}>
                  <Text accessibilityRole="alert" style={styles.errorMessage}>
                    {discoveryMode === "daily" ? dailyFiveError : exploreError}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      discoveryMode === "daily"
                        ? void loadDailyFive()
                        : void loadExplore()
                    }
                    style={styles.emptyButton}
                  >
                    <Text style={styles.emptyButtonText}>Try again</Text>
                  </Pressable>
                </View>
              ) : currentPerson ? (
                <>
                  {decisionError ? (
                    <Text accessibilityRole="alert" style={styles.errorMessage}>
                      {decisionError}
                    </Text>
                  ) : null}
                  <Animated.View
                    {...panResponder.panHandlers}
                    style={[
                      styles.profileCard,
                      {
                        transform: [
                          { translateX: swipeX },
                          { translateY: swipeY },
                          { rotate: rotation },
                        ],
                      },
                    ]}
                  >
                    <ImageBackground
                      accessibilityLabel={`${currentPerson.name}${currentPerson.age === null ? "" : `, ${currentPerson.age}`}`}
                      source={
                        currentPerson.image
                          ? { uri: currentPerson.image }
                          : undefined
                      }
                      resizeMode="cover"
                      style={styles.profileImage}
                      imageStyle={styles.profileImageCorners}
                    >
                      {!currentPerson.image ? (
                        <View
                          style={[
                            StyleSheet.absoluteFill,
                            styles.photoPlaceholder,
                          ]}
                        >
                          <Text style={styles.photoPlaceholderMark}>V</Text>
                          <Text style={styles.photoPlaceholderLabel}>
                            PHOTO NOT ADDED
                          </Text>
                        </View>
                      ) : null}
                      <View style={styles.imageShade} />
                      <View style={styles.cardTopRow}>
                        <View style={styles.intentBadge}>
                          <Text style={styles.intentText} numberOfLines={1}>
                            {currentPerson.intentions[0]?.toUpperCase() ??
                              "OPEN TO A CONNECTION"}
                          </Text>
                        </View>
                        <View style={styles.cardTopActions}>
                          {currentPerson.city ||
                          currentPerson.distanceKm !== null ||
                          currentPerson.outOfRadius ? (
                            <View style={styles.distanceBadge}>
                              <InfiniteMarquee
                                style={styles.distanceText}
                                text={[
                                  currentPerson.city,
                                  currentPerson.outOfRadius
                                    ? "OUT OF RADIUS"
                                    : currentPerson.distanceKm === null
                                      ? null
                                      : `${currentPerson.distanceKm} km away`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              />
                            </View>
                          ) : null}
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Safety options for ${currentPerson.name}`}
                            onPress={() => {
                              setSafetyError("");
                              setSafetyPrompt("menu");
                            }}
                            style={styles.safetyMenuButton}
                          >
                            <EllipsisVertical
                              color={brandColors.magenta}
                              size={18}
                              strokeWidth={2.5}
                            />
                          </Pressable>
                        </View>
                      </View>

                      <View style={styles.profileInfo}>
                        <View style={styles.profileSummaryRow}>
                          <ScrollView
                            horizontal
                            nestedScrollEnabled
                            showsHorizontalScrollIndicator={false}
                            style={styles.nameScroller}
                            contentContainerStyle={styles.nameLine}
                          >
                            <Text numberOfLines={1} style={styles.nameText}>
                              {currentPerson.name}
                              {currentPerson.age === null
                                ? ""
                                : `, ${currentPerson.age}`}
                            </Text>
                            {onlineUserIds.has(currentPerson.id) ? (
                              <View
                                accessibilityLabel={`${currentPerson.name} is online`}
                                style={[
                                  styles.onlinePresence,
                                  {
                                    borderColor: `${profileColors.success}66`,
                                    backgroundColor: profileColors.surface,
                                  },
                                ]}
                              >
                                <View
                                  style={[
                                    styles.onlinePresenceDot,
                                    {
                                      backgroundColor: profileColors.success,
                                    },
                                  ]}
                                />
                                <Text
                                  style={[
                                    styles.onlinePresenceText,
                                    { color: profileColors.success },
                                  ]}
                                >
                                  Online
                                </Text>
                              </View>
                            ) : null}
                            {currentPerson.identityVerified ? (
                              <IdentityVerifiedBadge
                                colors={profileColors}
                                compact
                              />
                            ) : null}
                          </ScrollView>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`View ${currentPerson.name}'s details`}
                            onPress={() =>
                              setSelectedLikeProfile({
                                person: currentPerson,
                                canRespond: false,
                              })
                            }
                            style={styles.viewDetailsButton}
                          >
                            <Eye color={brandColors.magenta} size={17} />
                          </Pressable>
                        </View>
                      </View>
                    </ImageBackground>
                    {currentPersonAlreadyLiked ? (
                      <View pointerEvents="none" style={styles.likedBackBadge}>
                        <Text style={styles.likedBackBadgeIcon}>♥</Text>
                        <Text style={styles.likedBackBadgeText}>
                          YOU LIKED BACK
                        </Text>
                      </View>
                    ) : null}
                    {superLikeTargetId === currentPerson.id ? (
                      <Animated.View
                        pointerEvents="none"
                        style={[
                          styles.superLikeBurst,
                          {
                            opacity: superLikeProgress.interpolate({
                              inputRange: [0, 0.1, 0.76, 1],
                              outputRange: [0, 1, 1, 0],
                            }),
                            transform: [
                              {
                                scale: superLikeProgress.interpolate({
                                  inputRange: [0, 0.18, 0.72, 1],
                                  outputRange: [0.45, 1.08, 1.02, 1.42],
                                }),
                              },
                              {
                                rotate: superLikeProgress.interpolate({
                                  inputRange: [0, 0.2, 1],
                                  outputRange: ["-8deg", "0deg", "7deg"],
                                }),
                              },
                            ],
                          },
                        ]}
                      >
                        <View style={styles.superLikeBurstIcon}>
                          <Sparkles
                            color={brandColors.magenta}
                            size={42}
                            strokeWidth={2.2}
                          />
                        </View>
                        <Text style={styles.superLikeBurstLabel}>
                          SUPER LIKE
                        </Text>
                      </Animated.View>
                    ) : null}
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.swipeFeedbackBadge,
                        styles.swipeLikeBadge,
                        {
                          opacity: likeSwipeOpacity,
                          transform: [
                            { rotate: "-12deg" },
                            {
                              scale: swipeX.interpolate({
                                inputRange: [0, 100],
                                outputRange: [0.75, 1],
                                extrapolate: "clamp",
                              }),
                            },
                          ],
                        },
                      ]}
                    >
                      <Text style={styles.swipeFeedbackIcon}>♥</Text>
                      <Text style={styles.swipeFeedbackLabel}>LIKE</Text>
                    </Animated.View>
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.swipeFeedbackBadge,
                        styles.swipePassBadge,
                        {
                          opacity: passSwipeOpacity,
                          transform: [
                            { rotate: "12deg" },
                            {
                              scale: swipeX.interpolate({
                                inputRange: [-100, 0],
                                outputRange: [1, 0.75],
                                extrapolate: "clamp",
                              }),
                            },
                          ],
                        },
                      ]}
                    >
                      <Text
                        style={[styles.swipeFeedbackIcon, styles.swipePassIcon]}
                      >
                        ×
                      </Text>
                      <Text style={styles.swipeFeedbackLabel}>PASS</Text>
                    </Animated.View>
                  </Animated.View>

                  <View style={styles.actionsArea}>
                    {currentPersonAlreadyLiked ? (
                      <View style={styles.likedBackNotice}>
                        <Text style={styles.likedBackNoticeText}>
                          You’ve liked this person back. No more action needed.
                        </Text>
                      </View>
                    ) : currentPerson.outOfRadius ? (
                      <Text style={styles.outOfRadiusWarning}>
                        Over 200 km away. Preview only: you cannot like or pass
                        this profile. Shown because no eligible profiles matched
                        your selected radius.
                      </Text>
                    ) : null}
                    <Text
                      accessibilityRole={decisionError ? "alert" : undefined}
                      style={styles.feedback}
                      numberOfLines={1}
                    >
                      {currentPerson.outOfRadius
                        ? "OUTSIDE YOUR SEARCH AREA"
                        : isSavingDecision
                          ? "SAVING YOUR DECISION…"
                          : feedback || "TAKE YOUR TIME. GO WITH YOUR GUT."}
                    </Text>
                    {currentPerson.outOfRadius ? (
                      <View style={styles.outOfRadiusControls}>
                        {exploreProfileIndex > 0 ? (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() =>
                              setExploreProfileIndex((index) =>
                                Math.max(0, index - 1),
                              )
                            }
                            style={styles.outOfRadiusButton}
                          >
                            <Text style={styles.emptyButtonText}>Previous</Text>
                          </Pressable>
                        ) : null}
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => {
                            if (
                              exploreFeed &&
                              exploreProfileIndex <
                                exploreFeed.profiles.length - 1
                            ) {
                              setExploreProfileIndex((index) => index + 1);
                            } else {
                              void loadExplore();
                            }
                          }}
                          style={styles.outOfRadiusButton}
                        >
                          <Text style={styles.emptyButtonText}>
                            {exploreFeed &&
                            exploreProfileIndex <
                              exploreFeed.profiles.length - 1
                              ? `Next preview (${exploreProfileIndex + 2}/${exploreFeed.profiles.length})`
                              : "Refresh previews"}
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View style={styles.actionRow}>
                        <ActionButton
                          accessibilityLabel="Pass on this profile"
                          label="×"
                          kind="pass"
                          onPress={() => void finishSwipe("pass")}
                        />
                        <ActionButton
                          accessibilityLabel="Send a super like"
                          label="✦"
                          kind="spark"
                          onPress={handleSuperLike}
                        />
                        <ActionButton
                          accessibilityLabel="Like this profile"
                          label="♥"
                          kind="like"
                          onPress={() => void finishSwipe("like")}
                        />
                      </View>
                    )}
                  </View>
                </>
              ) : discoveryMode === "daily" ? (
                <View style={styles.discoveryMessage}>
                  <Text style={styles.emptySymbol}>✦</Text>
                  <Text style={styles.emptyTitle}>
                    {dailyFeed?.selectedCount === 0
                      ? "A little quiet today."
                      : "You’ve explored today’s set"}
                  </Text>
                  <Text style={styles.emptyMessage}>
                    {dailyFeed?.selectedCount === 0
                      ? `We’re preparing your next curated connections. ${nextRefreshText}.`
                      : `Your next five arrive when this timer ends. ${nextRefreshText}.`}
                  </Text>
                  <View style={styles.exploreInvitation}>
                    <Text style={styles.exploreInvitationTitle}>
                      There are more people to discover.
                    </Text>
                    <Text style={styles.emptyMessage}>
                      Browse eligible members nearby while you wait.
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setDiscoveryMode("explore")}
                      style={styles.emptyButton}
                    >
                      <Text style={styles.emptyButtonText}>
                        Explore people →
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.discoveryMessage}>
                  <Text style={styles.emptySymbol}>⌖</Text>
                  <Text style={styles.emptyTitle}>
                    {exploreFeed?.remainingDecisions === 0
                      ? "That’s your Explore limit for today."
                      : localProfile?.location.latitude === null
                        ? "Add your city to explore nearby."
                        : "No one nearby just yet."}
                  </Text>
                  <Text style={styles.emptyMessage}>
                    {exploreFeed?.remainingDecisions === 0
                      ? `Your 20 Explore decisions reset every 10 minutes. ${nextExploreResetText}.`
                      : localProfile?.location.latitude === null
                        ? "Choose your city in your profile. Exact coordinates are never shown to other members."
                        : "Try a wider radius or another intention. Your exact location stays private."}
                  </Text>
                  {exploreFeed?.remainingDecisions !== 0 &&
                  localProfile?.location.latitude !== null ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setExploreRadiusKm(200);
                        void loadExplore(200, exploreIntention);
                      }}
                      style={styles.emptyButton}
                    >
                      <Text style={styles.emptyButtonText}>
                        Search up to 200 km
                      </Text>
                    </Pressable>
                  ) : null}
                  {exploreFeed?.remainingDecisions !== 0 &&
                  localProfile?.location.latitude === null ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setEditingStep("profile")}
                      style={styles.emptyButton}
                    >
                      <Text style={styles.emptyButtonText}>Set my city</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setDiscoveryMode("daily")}
                    style={styles.emptyButton}
                  >
                    <Text style={styles.emptyButtonText}>Back to Daily 5</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}

          <Modal
            animationType="fade"
            transparent
            visible={safetyPrompt !== null}
            onRequestClose={() => {
              if (!isUpdatingSafety) setSafetyPrompt(null);
            }}
          >
            <View style={styles.safetyModalBackdrop}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close safety options"
                disabled={isUpdatingSafety}
                onPress={() => setSafetyPrompt(null)}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.safetyModal}>
                <Text style={styles.safetyModalTitle}>
                  {safetyPrompt === "menu"
                    ? "Manage this profile"
                    : safetyPrompt === "hide"
                      ? "Hide this profile?"
                      : "Block this member?"}
                </Text>
                <Text style={styles.safetyModalCopy}>
                  {safetyPrompt === "menu"
                    ? "Choose how you want this profile to appear in Discovery."
                    : safetyPrompt === "hide"
                      ? "They’ll be removed from your recommendations. Hiding won’t affect existing likes or send a notification."
                      : "They’ll be removed from Discovery, and neither account will receive new recommendations of the other. No notification is sent."}
                </Text>
                {safetyPrompt === "menu" ? (
                  <>
                    <Pressable
                      onPress={() => setSafetyPrompt("hide")}
                      style={styles.safetyOption}
                    >
                      <Text style={styles.safetyOptionTitle}>
                        Hide from Discovery
                      </Text>
                      <Text style={styles.safetyOptionCopy}>
                        You can restore this profile later.
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setSafetyPrompt("block")}
                      style={styles.safetyOption}
                    >
                      <Text style={styles.safetyOptionTitle}>Block member</Text>
                      <Text style={styles.safetyOptionCopy}>
                        Exclude both accounts from Discovery.
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    {safetyError ? (
                      <Text
                        accessibilityRole="alert"
                        style={styles.errorMessage}
                      >
                        {safetyError}
                      </Text>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      disabled={isUpdatingSafety}
                      onPress={() => void updateSafetyList()}
                      style={[
                        styles.safetyConfirmButton,
                        isUpdatingSafety && styles.disabled,
                      ]}
                    >
                      <Text style={styles.safetyConfirmText}>
                        {isUpdatingSafety
                          ? "Saving…"
                          : safetyPrompt === "hide"
                            ? "Hide profile"
                            : "Block member"}
                      </Text>
                    </Pressable>
                  </>
                )}
                <Pressable
                  accessibilityRole="button"
                  disabled={isUpdatingSafety}
                  onPress={() =>
                    setSafetyPrompt(safetyPrompt === "menu" ? null : "menu")
                  }
                  style={styles.safetyCancelButton}
                >
                  <Text style={styles.safetyCancelText}>
                    {safetyPrompt === "menu" ? "Close" : "Back"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          <Modal
            animationType="slide"
            transparent
            visible={selectedLikeProfile !== null}
            onRequestClose={() => setSelectedLikeProfile(null)}
          >
            <View style={styles.profileDetailsBackdrop}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close profile details"
                onPress={() => setSelectedLikeProfile(null)}
                style={StyleSheet.absoluteFill}
              />
              {selectedLikeProfile ? (
                <View style={styles.profileDetailsSheet}>
                  <View style={styles.profileDetailsTopBar}>
                    <View style={styles.profileDetailsHandle} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Close profile details"
                      onPress={() => setSelectedLikeProfile(null)}
                      style={styles.profileDetailsClose}
                    >
                      <Text style={styles.profileDetailsCloseText}>×</Text>
                    </Pressable>
                  </View>
                  <ScrollView
                    contentContainerStyle={styles.likeProfileContent}
                    showsVerticalScrollIndicator={false}
                  >
                    <View style={styles.profileDetailsHeroFrame}>
                      {profileDetailsPhotos.length ? (
                        <ScrollView
                          ref={profileDetailsPhotoScroll}
                          horizontal
                          pagingEnabled
                          showsHorizontalScrollIndicator={false}
                          onMomentumScrollEnd={(event) => {
                            const nextIndex = Math.max(
                              0,
                              Math.min(
                                profileDetailsPhotos.length - 1,
                                Math.round(
                                  event.nativeEvent.contentOffset.x /
                                    profileDetailsPhotoWidth,
                                ),
                              ),
                            );
                            profileDetailsPhotoIndexRef.current = nextIndex;
                            setProfileDetailsPhotoIndex(nextIndex);
                          }}
                          style={styles.profileDetailsPhotoScroller}
                        >
                          {profileDetailsPhotos.map((photo, index) => (
                            <View
                              key={photo}
                              style={[
                                styles.profileDetailsPhotoPage,
                                { width: profileDetailsPhotoWidth },
                              ]}
                            >
                              <Image
                                source={{ uri: photo }}
                                resizeMode="contain"
                                style={styles.profileDetailsHeroPhoto}
                              />
                              {index === 0 ? (
                                <View style={styles.profileDetailsHeroShade}>
                                  <View style={styles.profileDetailsHeroCopy}>
                                    {selectedLikeProfile.canRespond ? (
                                      <Text
                                        style={styles.profileDetailsEyebrow}
                                      >
                                        THEY LIKE YOU
                                      </Text>
                                    ) : null}
                                    <View style={styles.profileDetailsNameRow}>
                                      <Text style={styles.profileDetailsName}>
                                        {selectedLikeProfile.person.name}
                                        {selectedLikeProfile.person.age === null
                                          ? ""
                                          : `, ${selectedLikeProfile.person.age}`}
                                      </Text>
                                      {onlineUserIds.has(
                                        selectedLikeProfile.person.id,
                                      ) ? (
                                        <View
                                          accessibilityLabel={`${selectedLikeProfile.person.name} is online`}
                                          style={styles.onlinePresence}
                                        >
                                          <View
                                            style={styles.onlinePresenceDot}
                                          />
                                          <Text
                                            style={styles.onlinePresenceText}
                                          >
                                            Online
                                          </Text>
                                        </View>
                                      ) : null}
                                      {selectedLikeProfile.person
                                        .identityVerified ? (
                                        <IdentityVerifiedBadge
                                          colors={profileColors}
                                          compact
                                        />
                                      ) : null}
                                    </View>
                                    {selectedLikeProfile.person.city ||
                                    selectedLikeProfile.person.distanceKm !==
                                      null ? (
                                      <Text
                                        style={styles.profileDetailsLocation}
                                      >
                                        {[
                                          selectedLikeProfile.person.city,
                                          selectedLikeProfile.person
                                            .distanceKm === null
                                            ? null
                                            : `${selectedLikeProfile.person.distanceKm} km away`,
                                        ]
                                          .filter(Boolean)
                                          .join(" · ")}
                                      </Text>
                                    ) : null}
                                  </View>
                                </View>
                              ) : null}
                            </View>
                          ))}
                        </ScrollView>
                      ) : (
                        <View style={styles.profileDetailsPhotoPlaceholder}>
                          <Text style={styles.profileDetailsPlaceholderMark}>
                            V
                          </Text>
                          <Text style={styles.profileDetailsPlaceholderLabel}>
                            PHOTO NOT ADDED
                          </Text>
                          <View style={styles.profileDetailsPlaceholderCopy}>
                            <Text style={styles.profileDetailsName}>
                              {selectedLikeProfile.person.name}
                              {selectedLikeProfile.person.age === null
                                ? ""
                                : `, ${selectedLikeProfile.person.age}`}
                            </Text>
                            {onlineUserIds.has(
                              selectedLikeProfile.person.id,
                            ) ? (
                              <View
                                accessibilityLabel={`${selectedLikeProfile.person.name} is online`}
                                style={styles.onlinePresence}
                              >
                                <View style={styles.onlinePresenceDot} />
                                <Text style={styles.onlinePresenceText}>
                                  Online
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                      )}
                      {profileDetailsPhotos.length > 1 ? (
                        <View
                          pointerEvents="none"
                          style={styles.profileDetailsPhotoIndicators}
                        >
                          {profileDetailsPhotos.map((photo, index) => (
                            <View
                              key={photo}
                              style={[
                                styles.profileDetailsPhotoIndicator,
                                index === profileDetailsPhotoIndex &&
                                  styles.profileDetailsPhotoIndicatorActive,
                              ]}
                            />
                          ))}
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.profileDetailsBody}>
                      {selectedLikeProfile.person.occupation ? (
                        <View style={styles.profileDetailsSection}>
                          <Text style={styles.likeProfileLabel}>WORKS AS</Text>
                          <Text style={styles.profileDetailsOccupation}>
                            {selectedLikeProfile.person.occupation}
                          </Text>
                        </View>
                      ) : null}
                      {selectedLikeProfile.person.bio ? (
                        <View style={styles.profileDetailsSection}>
                          <Text style={styles.likeProfileLabel}>ABOUT</Text>
                          <Text style={styles.profileDetailsBio}>
                            {selectedLikeProfile.person.bio}
                          </Text>
                        </View>
                      ) : null}
                      {selectedLikeProfile.person.interests.length ? (
                        <View style={styles.profileDetailsSection}>
                          <Text style={styles.likeProfileLabel}>INTERESTS</Text>
                          <View style={styles.profileDetailsChips}>
                            {selectedLikeProfile.person.interests.map(
                              (interest) => (
                                <View
                                  key={interest}
                                  style={styles.profileDetailsChip}
                                >
                                  <Text style={styles.profileDetailsChipText}>
                                    {interest}
                                  </Text>
                                </View>
                              ),
                            )}
                          </View>
                        </View>
                      ) : null}
                      {selectedLikeProfile.person.intentions.length ? (
                        <View style={styles.profileDetailsSection}>
                          <Text style={styles.likeProfileLabel}>
                            LOOKING FOR
                          </Text>
                          <View style={styles.profileDetailsChips}>
                            {selectedLikeProfile.person.intentions.map(
                              (intention) => (
                                <View
                                  key={intention}
                                  style={styles.profileDetailsChip}
                                >
                                  <Text style={styles.profileDetailsChipText}>
                                    {intention}
                                  </Text>
                                </View>
                              ),
                            )}
                          </View>
                        </View>
                      ) : null}
                      {selectedLikeProfile.person.compatibilityScore !==
                      null ? (
                        <Pressable
                          accessibilityRole="button"
                          disabled={
                            !selectedLikeProfile.person.compatibilityBreakdown
                          }
                          onPress={() => {
                            setCompatibilityPerson(selectedLikeProfile.person);
                            setSelectedLikeProfile(null);
                          }}
                          style={styles.likeProfileCompatibility}
                        >
                          <View style={styles.profileDetailsCompatibilityCopy}>
                            <Text
                              style={styles.profileDetailsCompatibilityLabel}
                            >
                              YOUR CHEMISTRY
                            </Text>
                            <Text style={styles.likeProfileCompatibilityScore}>
                              {selectedLikeProfile.person.compatibilityScore}%
                              match
                            </Text>
                          </View>
                          <Text style={styles.profileDetailsCompatibilityArrow}>
                            ›
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </ScrollView>
                  <View style={styles.profileDetailsFooter}>
                    {selectedLikeProfile.canRespond ? (
                      <View style={styles.receivedLikeActions}>
                        <Pressable
                          accessibilityRole="button"
                          disabled={isRespondingToLike}
                          onPress={() => void decideReceivedLike("pass")}
                          style={[
                            styles.receivedLikePass,
                            isRespondingToLike && styles.disabled,
                          ]}
                        >
                          <Text style={styles.receivedLikePassText}>Pass</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          disabled={isRespondingToLike}
                          onPress={() => void decideReceivedLike("like")}
                          style={[
                            styles.receivedLikeBack,
                            isRespondingToLike && styles.disabled,
                          ]}
                        >
                          <Text style={styles.receivedLikeBackText}>
                            {isRespondingToLike ? "Saving…" : "Like back"}
                          </Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setSelectedLikeProfile(null)}
                        style={styles.profileDetailsDoneButton}
                      >
                        <Text style={styles.profileDetailsDoneText}>Done</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ) : null}
            </View>
          </Modal>

          <Modal
            animationType="slide"
            transparent
            visible={compatibilityPerson !== null}
            onRequestClose={() => setCompatibilityPerson(null)}
          >
            <View style={styles.safetyModalBackdrop}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close compatibility breakdown"
                onPress={() => setCompatibilityPerson(null)}
                style={StyleSheet.absoluteFill}
              />
              {compatibilityPerson?.compatibilityBreakdown ? (
                <View style={styles.compatibilityModal}>
                  <Text style={styles.compatibilityModalEyebrow}>
                    A CLOSER LOOK
                  </Text>
                  <Text style={styles.compatibilityModalTitle}>
                    Why you might connect
                  </Text>
                  <View style={styles.compatibilitySummary}>
                    <Text style={styles.compatibilitySummaryScore}>
                      {compatibilityPerson.compatibilityScore}%
                    </Text>
                    <Text style={styles.compatibilitySummaryLabel}>
                      {getAlignmentLabel(
                        compatibilityPerson.compatibilityScore ?? 0,
                      )}
                    </Text>
                  </View>
                  <Text style={styles.compatibilityDisclaimer}>
                    This estimates profile alignment, not the likelihood of
                    relationship success.
                  </Text>
                  {compatibilityPerson.compatibilityConfidence !== null ? (
                    <Text style={styles.compatibilityConfidence}>
                      Based on {compatibilityPerson.compatibilityConfidence}% of
                      the weighted profile signals. Missing answers don't count
                      against either of you.
                    </Text>
                  ) : null}
                  <ScrollView
                    style={styles.compatibilityDimensions}
                    contentContainerStyle={
                      styles.compatibilityDimensionsContent
                    }
                  >
                    {COMPATIBILITY_DIMENSIONS.map((dimension) => {
                      const score =
                        compatibilityPerson.compatibilityBreakdown?.[
                          dimension.key
                        ] ?? null;
                      return (
                        <View
                          key={dimension.key}
                          style={styles.compatibilityDimension}
                        >
                          <View style={styles.compatibilityDimensionCopy}>
                            <Text style={styles.compatibilityDimensionName}>
                              {dimension.label}
                            </Text>
                            <Text style={styles.compatibilityDimensionWeight}>
                              {dimension.weight}% weight
                            </Text>
                          </View>
                          <Text style={styles.compatibilityDimensionScore}>
                            {score === null
                              ? "Not enough shared information"
                              : `${getAlignmentLabel(score)} · ${score}%`}
                          </Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setCompatibilityPerson(null)}
                    style={styles.safetyCancelButton}
                  >
                    <Text style={styles.safetyCancelText}>Close</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </Modal>

          {activeTab === "likes" && (
            <View style={styles.secondaryScreen}>
              <Text style={styles.eyebrow}>INTEREST, BOTH WAYS</Text>
              <Text style={styles.heading}>Likes</Text>
              <Text style={styles.likesSubtitle}>
                Browse likes, matches, and profile visitors.
              </Text>
              <View style={styles.likesSections}>
                {(
                  [
                    ["likes", "Likes"],
                    ["matches", "Matches"],
                    ["visitors", "Visitors"],
                  ] as const
                ).map(([section, label]) => (
                  <Pressable
                    key={section}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: likesSection === section }}
                    onPress={() => {
                      setLikesSection(section);
                      if (section === "visitors") {
                        void loadProfileVisitors();
                      }
                    }}
                    style={[
                      styles.likesSectionButton,
                      likesSection === section &&
                        styles.likesSectionButtonActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.likesSectionText,
                        likesSection === section &&
                          styles.likesSectionTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {likesSection === "likes" ? (
                <View style={styles.likesDirectionTabs}>
                  {(
                    [
                      [
                        "received",
                        `Received${incomingLikes.length ? ` ${incomingLikes.length}` : ""}`,
                      ],
                      [
                        "sent",
                        `Sent${sentLikes.length ? ` ${sentLikes.length}` : ""}`,
                      ],
                    ] as const
                  ).map(([direction, label]) => (
                    <Pressable
                      key={direction}
                      accessibilityRole="tab"
                      accessibilityState={{
                        selected: likeDirection === direction,
                      }}
                      onPress={() => {
                        setLikeDirection(direction);
                        if (direction === "sent") void loadLikes();
                      }}
                      style={[
                        styles.likesDirectionButton,
                        likeDirection === direction &&
                          styles.likesDirectionButtonActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.likesDirectionText,
                          likeDirection === direction &&
                            styles.likesDirectionTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {likesSection === "visitors" ? (
                <View style={styles.visitorFilterTabs}>
                  {(
                    [
                      ["all", "All"],
                      ["new", "New"],
                      ["recent", "Recent"],
                    ] as const
                  ).map(([filter, label]) => (
                    <Pressable
                      key={filter}
                      accessibilityRole="tab"
                      accessibilityState={{
                        selected: visitorFilter === filter,
                      }}
                      onPress={() => setVisitorFilter(filter)}
                      style={[
                        styles.visitorFilterButton,
                        visitorFilter === filter &&
                          styles.visitorFilterButtonActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.visitorFilterText,
                          visitorFilter === filter &&
                            styles.visitorFilterTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {likesMessage ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={styles.likesMessage}
                >
                  {likesMessage}
                </Text>
              ) : null}
              {likesError ? (
                <Text accessibilityRole="alert" style={styles.errorMessage}>
                  {likesError}
                </Text>
              ) : null}
              {likesFeed || likesSection !== "likes" ? (
                <View style={styles.likesSectionHeader}>
                  <Text style={styles.likesSectionHeading}>
                    {likesSection === "likes"
                      ? likeDirection === "received"
                        ? "People who like you"
                        : "People you’ve liked"
                      : likesSection === "matches"
                        ? "Your matches"
                        : "Who viewed you"}
                  </Text>
                  {likesSection === "likes" &&
                  likeDirection === "received" &&
                  incomingLikes.length > 0 ? (
                    <View style={styles.likesNewCount}>
                      <Text style={styles.likesNewCountText}>
                        {incomingLikes.length} new
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
              {(
                likesSection === "visitors"
                  ? isLoadingVisitors && filteredProfileVisitors.length === 0
                  : isLoadingLikes && !likesFeed
              ) ? (
                <View style={styles.likesLoading}>
                  <ActivityIndicator color={ACCENT} />
                </View>
              ) : (
                <ScrollView
                  style={styles.likesScroll}
                  contentContainerStyle={[
                    styles.likesList,
                    isSingleProfileResult && styles.likesListSingle,
                  ]}
                  showsVerticalScrollIndicator={false}
                >
                  {likesSection === "likes" &&
                  likeDirection === "received" &&
                  incomingLikes.length > 0 ? (
                    <View style={styles.profileTilesGrid}>
                      {incomingLikes.map((like) => (
                        <View
                          key={like.id}
                          style={[
                            styles.profileTileColumn,
                            isSingleProfileResult &&
                              styles.profileTileColumnSingle,
                          ]}
                        >
                          <ProfileTile
                            person={like.person}
                            detail="Liked you"
                            fillAvailableSpace={isSingleProfileResult}
                            onPress={() =>
                              setSelectedLikeProfile({
                                person: like.person,
                                canRespond: true,
                              })
                            }
                          />
                          <View style={styles.profileTileActions}>
                            <Pressable
                              accessibilityRole="button"
                              disabled={isRespondingToLike}
                              onPress={() =>
                                void decideReceivedLike("pass", like.person.id)
                              }
                              style={[
                                styles.receivedLikePass,
                                isRespondingToLike && styles.disabled,
                              ]}
                            >
                              <Text style={styles.receivedLikePassText}>
                                Pass
                              </Text>
                            </Pressable>
                            <Pressable
                              accessibilityRole="button"
                              disabled={isRespondingToLike}
                              onPress={() =>
                                void decideReceivedLike("like", like.person.id)
                              }
                              style={[
                                styles.receivedLikeBack,
                                isRespondingToLike && styles.disabled,
                              ]}
                            >
                              <Text style={styles.receivedLikeBackText}>
                                Like back
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : likesSection === "likes" &&
                    likeDirection === "sent" &&
                    likesFeed?.sent.length ? (
                    <View style={styles.profileTilesGrid}>
                      {likesFeed.sent.map((like) => (
                        <View
                          key={like.id}
                          style={[
                            styles.profileTileColumn,
                            isSingleProfileResult &&
                              styles.profileTileColumnSingle,
                          ]}
                        >
                          <ProfileTile
                            person={like.person}
                            detail={
                              like.status === "matched"
                                ? "Matched"
                                : `Liked ${formatLikeDate(like.createdAt)}`
                            }
                            fillAvailableSpace={isSingleProfileResult}
                            onPress={() =>
                              setSelectedLikeProfile({
                                person: like.person,
                                canRespond: false,
                              })
                            }
                          />
                        </View>
                      ))}
                    </View>
                  ) : likesSection === "matches" &&
                    likesFeed?.matches.length ? (
                    <View style={styles.profileTilesGrid}>
                      {likesFeed.matches.map((match) => (
                        <View
                          key={match.id}
                          style={[
                            styles.profileTileColumn,
                            isSingleProfileResult &&
                              styles.profileTileColumnSingle,
                          ]}
                        >
                          <ProfileTile
                            person={match.person}
                            detail={
                              isMatchInactive(match.lastActivityAt)
                                ? "No activity in 30 days"
                                : formatRelativeTime(
                                    match.lastActivityAt,
                                    "Active",
                                  )
                            }
                            fillAvailableSpace={isSingleProfileResult}
                            onPress={() =>
                              setSelectedLikeProfile({
                                person: match.person,
                                canRespond: false,
                              })
                            }
                          />
                        </View>
                      ))}
                    </View>
                  ) : likesSection === "visitors" &&
                    filteredProfileVisitors.length ? (
                    <View style={styles.profileTilesGrid}>
                      {filteredProfileVisitors.map((visitor) => (
                        <View
                          key={visitor.id}
                          style={[
                            styles.profileTileColumn,
                            isSingleProfileResult &&
                              styles.profileTileColumnSingle,
                          ]}
                        >
                          <ProfileTile
                            person={visitor.person}
                            firstNameOnly
                            location={visitor.person.city}
                            compatibility={visitor.person.compatibilityScore}
                            detail={formatRelativeTime(visitor.viewedAt)}
                            fillAvailableSpace={isSingleProfileResult}
                            onPress={() =>
                              setSelectedLikeProfile({
                                person: visitor.person,
                                canRespond: false,
                              })
                            }
                          />
                          {visitor.hasActiveMatch ? (
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => setActiveTab("chats")}
                              style={styles.visitorMessageButton}
                            >
                              <MessageCircle
                                color="#331B1D"
                                fill="#331B1D"
                                size={14}
                              />
                              <Text style={styles.receivedLikeBackText}>
                                Message
                              </Text>
                            </Pressable>
                          ) : (
                            <View style={styles.profileTileActions}>
                              <Pressable
                                accessibilityRole="button"
                                disabled={isRespondingToLike}
                                onPress={() =>
                                  void decideProfileVisitor(visitor.id, "pass")
                                }
                                style={[
                                  styles.receivedLikePass,
                                  isRespondingToLike && styles.disabled,
                                ]}
                              >
                                <Text style={styles.receivedLikePassText}>
                                  Pass
                                </Text>
                              </Pressable>
                              <Pressable
                                accessibilityRole="button"
                                disabled={isRespondingToLike}
                                onPress={() =>
                                  void decideProfileVisitor(visitor.id, "like")
                                }
                                style={[
                                  styles.receivedLikeBack,
                                  isRespondingToLike && styles.disabled,
                                ]}
                              >
                                <Heart
                                  color="#331B1D"
                                  fill="#331B1D"
                                  size={14}
                                />
                                <Text style={styles.receivedLikeBackText}>
                                  Like
                                </Text>
                              </Pressable>
                            </View>
                          )}
                        </View>
                      ))}
                    </View>
                  ) : likesSection === "visitors" ? (
                    likesError ? null : (
                      <EmptyState
                        symbol="◉"
                        title={
                          profileVisitors.length
                            ? "No visitors in this filter"
                            : "No profile visitors yet"
                        }
                        message={
                          profileVisitors.length
                            ? "Try another visitor filter."
                            : "When someone opens your profile, they’ll show up here."
                        }
                        onPress={() => setActiveTab("discover")}
                        buttonText="Meet someone"
                      />
                    )
                  ) : likesSection === "likes" &&
                    likeDirection === "received" &&
                    incomingLikes.length === 0 ? (
                    <EmptyState
                      symbol="♡"
                      title="No likes just yet"
                      message="When someone likes your profile, you can get to know them here."
                      onPress={() => setActiveTab("discover")}
                      buttonText="Meet someone"
                    />
                  ) : likesSection === "likes" &&
                    likeDirection === "sent" &&
                    !likesFeed?.sent.length ? (
                    <EmptyState
                      symbol="↑"
                      title="Your sent likes will appear here"
                      message="Like someone in Daily 5 or Explore to keep track of your interest."
                      onPress={() => setActiveTab("discover")}
                      buttonText="Meet someone"
                    />
                  ) : likesSection === "matches" &&
                    !likesFeed?.matches.length ? (
                    <EmptyState
                      symbol="✦"
                      title="Your mutual matches will appear here"
                      message="When you and someone like each other, you’ll find your connection here."
                      onPress={() => setActiveTab("discover")}
                      buttonText="Meet someone"
                    />
                  ) : null}
                </ScrollView>
              )}
            </View>
          )}

          {activeTab === "video" && (
            <VideoDiscoveryScreen
              userId={userId}
              colors={profileColors}
              onCallActive={setIsVideoCallActive}
              onViewMatches={() => {
                setLikesSection("matches");
                setActiveTab("likes");
              }}
            />
          )}

          {activeTab === "chats" && (
            <ChatScreen
              userId={userId}
              colors={profileColors}
              onSessionExpired={onSessionExpired}
              onCallActive={setIsVideoCallActive}
            />
          )}

          {activeTab === "chemistry" && (
            <ChemistryScreen
              userId={userId}
              localProfile={localProfile}
              colors={profileColors}
            />
          )}

          {activeTab === "profile" && (
            <ProfileScreen
              profile={localProfile}
              userId={userId}
              userEmail={userEmail}
              onEditProfile={(step) => setEditingStep(step ?? "profile")}
              onSignOut={() => {
                void removePushNotificationRegistration(userId)
                  .then(onSignOut)
                  .catch((removeError: unknown) => {
                    setPushSetupMessage(
                      removeError instanceof Error
                        ? removeError.message
                        : "Could not remove this device's push registration.",
                    );
                  });
              }}
              onAccountDeleted={onAccountDeleted}
            />
          )}
        </View>

        {isNotificationInboxVisible ? (
          <View style={styles.notificationPage}>
            <View style={styles.notificationPageHeader}>
              <View style={styles.notificationHeaderTopline}>
                <View style={styles.notificationHeaderCopy}>
                  <Text style={styles.notificationModalTitle}>Notifications</Text>
                  <Text style={styles.notificationHeaderEyebrow}>
                    UPDATES, ALL IN ONE PLACE
                  </Text>
                </View>
                <View style={styles.notificationHeaderActions}>
                  {unreadNotificationCount > 0 ? (
                    <View style={styles.notificationUnreadPill}>
                      <Text style={styles.notificationUnreadPillText}>
                        {unreadNotificationCount} unread
                      </Text>
                    </View>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Refresh notifications"
                    disabled={isLoadingNotifications}
                    onPress={() =>
                      setNotificationRefreshKey((current) => current + 1)
                    }
                    style={styles.notificationCloseButton}
                  >
                    {isLoadingNotifications ? (
                      <ActivityIndicator color="#FAF7F4" size="small" />
                    ) : (
                      <RefreshCw color="#FAF7F4" size={16} />
                    )}
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      selectedNotificationId
                        ? "Back to notifications"
                        : "Close notifications"
                    }
                    onPress={() => {
                      if (selectedNotificationId) {
                        setSelectedNotificationId(null);
                      } else {
                        setSelectedNotificationId(null);
                        setIsNotificationInboxVisible(false);
                      }
                    }}
                    style={styles.notificationCloseButton}
                  >
                    {selectedNotificationId ? (
                      <ChevronLeft color="#FAF7F4" size={18} />
                    ) : (
                      <X color="#FAF7F4" size={18} />
                    )}
                  </Pressable>
                </View>
              </View>
              {!selectedNotificationId ? (
                <View style={styles.notificationFilterBar}>
                  {([
                    ["all", "All"],
                    ["unread", "Unread"],
                    ["read", "Read"],
                  ] as const).map(([filter, label]) => {
                    const selected = notificationFilter === filter;
                    return (
                      <Pressable
                        key={filter}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setNotificationFilter(filter)}
                        style={[
                          styles.notificationFilterChip,
                          selected && styles.notificationFilterChipSelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.notificationFilterChipText,
                            selected && styles.notificationFilterChipTextSelected,
                          ]}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
            <ScrollView
              contentContainerStyle={styles.notificationList}
              keyboardShouldPersistTaps="handled"
            >
              {notificationError ? (
                <View style={styles.notificationNotice}>
                  <Text style={styles.notificationNoticeText}>
                    {notificationError}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      setNotificationRefreshKey((current) => current + 1)
                    }
                  >
                    <Text style={styles.notificationRetry}>Try again</Text>
                  </Pressable>
                </View>
              ) : null}
              {pushSetupMessage ? (
                <Text
                  accessibilityRole="alert"
                  style={styles.notificationPushNote}
                >
                  {pushSetupMessage}
                </Text>
              ) : null}
              {isLoadingNotifications ? (
                <View
                  accessibilityRole="progressbar"
                  style={styles.notificationEmptyState}
                >
                  <ActivityIndicator color={ACCENT} />
                  <Text style={styles.notificationEmptyCopy}>
                    Loading notifications…
                  </Text>
                </View>
              ) : selectedNotificationId ? (
                (() => {
                  const notification = memberNotifications.find(
                    (item) => item.id === selectedNotificationId,
                  );
                  if (!notification) return null;
                  return (
                    <View style={styles.notificationDetail}>
                      <View style={styles.notificationDetailTopline}>
                        <View style={styles.notificationSenderAvatar}>
                          <Bell color={ACCENT} size={19} />
                        </View>
                        <View style={styles.notificationDetailSender}>
                          <Text style={styles.notificationDetailFromLabel}>
                            FROM
                          </Text>
                          <Text style={styles.notificationDetailFrom}>
                            {notification.from_name}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.notificationReadState,
                            notification.read_at === null
                              ? styles.notificationUnreadState
                              : styles.notificationReadStateMuted,
                          ]}
                        >
                          <View
                            accessibilityLabel={
                              notification.read_at === null ? "Unread" : "Read"
                            }
                            style={[
                              styles.notificationStatusDot,
                              notification.read_at === null
                                ? styles.notificationUnreadDot
                                : styles.notificationReadDot,
                            ]}
                          />
                          <Text style={styles.notificationReadStateText}>
                            {notification.read_at === null ? "New" : "Read"}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.notificationDetailDivider} />
                      <Text style={styles.notificationDetailTitle}>
                        {notification.title}
                      </Text>
                      <Text style={styles.notificationDetailDate}>
                        {new Intl.DateTimeFormat("en-ZA", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "Africa/Johannesburg",
                        }).format(new Date(notification.created_at))}
                      </Text>
                      <Text style={styles.notificationDetailBody}>
                        {notification.body}
                      </Text>
                      {notification.link_url ? (
                        <Pressable
                          accessibilityRole="link"
                          accessibilityLabel={`Open link: ${notification.link_url}`}
                          onPress={() => {
                            const linkUrl = notification.link_url;
                            if (!linkUrl) return;
                            void openMemberNotificationLink(linkUrl).catch(
                              (openError: unknown) => {
                                setNotificationError(
                                  openError instanceof Error
                                    ? openError.message
                                    : "Could not open this notification link.",
                                );
                              },
                            );
                          }}
                          style={styles.notificationDetailLink}
                        >
                          <ExternalLink color={ACCENT} size={14} />
                          <Text style={styles.notificationDetailLinkText}>
                            Open link
                          </Text>
                          <ChevronRight color={ACCENT} size={16} />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })()
              ) : filteredNotifications.length ? (
                filteredNotifications.map((notification, index) => {
                  const group = notificationDateGroup(notification.created_at);
                  const previousGroup = index > 0
                    ? notificationDateGroup(
                        filteredNotifications[index - 1].created_at,
                      )
                    : null;
                  return (
                    <Fragment key={notification.id}>
                      {group !== previousGroup ? (
                        <Text style={styles.notificationDateGroup}>
                          {group}
                        </Text>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${notification.read_at === null ? "Unread" : "Read"} notification: ${notification.title}`}
                        accessibilityHint="Opens the notification"
                        onPress={() =>
                          void openNotificationDetail(notification)
                        }
                        style={({ pressed }) => [
                          styles.notificationCard,
                          pressed && styles.notificationCardPressed,
                        ]}
                      >
                        <View style={styles.notificationCardIcon}>
                          <Bell color="#A25A78" size={19} />
                        </View>
                        <View style={styles.notificationCardContent}>
                          <View style={styles.notificationCardHeading}>
                            <Text
                              numberOfLines={2}
                              style={styles.notificationCardTitle}
                            >
                              {notification.title}
                            </Text>
                            {notification.read_at === null ? (
                              <View style={styles.notificationNewPill}>
                                <Text style={styles.notificationNewPillText}>
                                  New
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          <Text
                            numberOfLines={2}
                            style={styles.notificationCardBody}
                          >
                            {notification.body}
                          </Text>
                          <Text style={styles.notificationCardDate}>
                            {notificationTimeLabel(notification.created_at)} ·{" "}
                            {notification.from_name}
                          </Text>
                        </View>
                      </Pressable>
                    </Fragment>
                  );
                })
              ) : !notificationError ? (
                <View style={styles.notificationEmptyState}>
                  <View style={styles.notificationEmptyIcon}>
                    <Bell color={ACCENT} size={22} />
                  </View>
                  <Text style={styles.notificationEmptyTitle}>
                    You’re all caught up
                  </Text>
                  <Text style={styles.notificationEmptyCopy}>
                    {notificationFilter === "unread"
                      ? "You have no unread notifications."
                      : notificationFilter === "read"
                        ? "Read notifications will appear here."
                        : "New updates from VEYRA Support will appear here."}
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          </View>
        ) : null}

        {!isVideoCallActive ? (
          <View
            style={[
              styles.tabBar,
              activeTab === "profile" && {
                backgroundColor: profileColors.tabBar,
                borderTopColor: profileColors.border,
              },
            ]}
          >
            <TabButton
              label="Discover"
              icon={Compass}
              active={activeTab === "discover"}
              onPress={() => setActiveTab("discover")}
              themeColors={activeTab === "profile" ? profileColors : undefined}
            />
            <TabButton
              label="Video"
              icon={Video}
              active={activeTab === "video"}
              onPress={() => setActiveTab("video")}
              themeColors={activeTab === "profile" ? profileColors : undefined}
            />
            <TabButton
              label="Likes"
              icon={Heart}
              active={activeTab === "likes"}
              onPress={() => setActiveTab("likes")}
              count={incomingLikes.length}
              themeColors={activeTab === "profile" ? profileColors : undefined}
            />
            <TabButton
              label="Chats"
              icon={MessageCircle}
              active={activeTab === "chats"}
              onPress={() => setActiveTab("chats")}
              themeColors={activeTab === "profile" ? profileColors : undefined}
            />
            <TabButton
              label="Chemistry"
              icon={Sparkles}
              active={activeTab === "chemistry"}
              onPress={() => setActiveTab("chemistry")}
              themeColors={activeTab === "profile" ? profileColors : undefined}
            />
            <TabButton
              label="Profile"
              icon={UserRound}
              active={activeTab === "profile"}
              onPress={() => setActiveTab("profile")}
              themeColors={activeTab === "profile" ? profileColors : undefined}
            />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function LoadingScreen() {
  return (
    <SafeAreaView style={gateStyles.screen}>
      <View style={gateStyles.centered}>
        <Text style={gateStyles.wordmark}>VEYRA</Text>
        <ActivityIndicator color={ACCENT} />
      </View>
    </SafeAreaView>
  );
}

function StartupErrorScreen({
  message,
  onRetry,
  onSignOut,
}: {
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
}) {
  return (
    <SafeAreaView style={gateStyles.screen}>
      <View style={gateStyles.centered}>
        <Text style={gateStyles.wordmark}>VEYRA</Text>
        <Text style={gateStyles.errorTitle}>We couldn’t load your profile</Text>
        <Text style={gateStyles.errorMessage}>{message}</Text>
        <Pressable onPress={onRetry} style={gateStyles.retryButton}>
          <Text style={gateStyles.retryText}>Try again</Text>
        </Pressable>
        <Pressable onPress={onSignOut} style={gateStyles.signOutButton}>
          <Text style={gateStyles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function ActionButton({
  accessibilityLabel,
  label,
  kind,
  disabled = false,
  onPress,
}: {
  accessibilityLabel: string;
  label: string;
  kind: "pass" | "spark" | "like";
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        styles[`${kind}Button`],
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.actionSymbol, styles[`${kind}Symbol`]]}>
        {label}
      </Text>
    </Pressable>
  );
}

function TabButton({
  label,
  icon: Icon,
  active,
  onPress,
  count,
  themeColors,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onPress: () => void;
  count?: number;
  themeColors?: SystemColors;
}) {
  const iconColor = themeColors
    ? active
      ? themeColors.brandMagenta
      : themeColors.textMuted
    : active
      ? brandColors.magenta
      : "#796D72";

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.tab}
    >
      <View style={styles.tabSymbolWrap}>
        <Icon color={iconColor} size={21} strokeWidth={active ? 2.25 : 1.8} />
        {!!count && (
          <View style={styles.tabCount}>
            <Text style={styles.tabCountText}>{count}</Text>
          </View>
        )}
      </View>
      <Text
        numberOfLines={1}
        ellipsizeMode="tail"
        style={[
          styles.tabLabel,
          active && styles.tabLabelActive,
          themeColors && {
            color: active ? themeColors.brandMagenta : themeColors.textMuted,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function InfiniteMarquee({
  text,
  style,
}: {
  text: string;
  style: React.ComponentProps<typeof Text>["style"];
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [viewportWidth, setViewportWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);
  const gap = 24;

  useEffect(() => {
    translateX.stopAnimation();
    translateX.setValue(0);

    if (textWidth <= viewportWidth || textWidth === 0 || viewportWidth === 0) {
      return;
    }

    const distance = textWidth + gap;
    const animation = Animated.loop(
      Animated.timing(translateX, {
        toValue: -distance,
        duration: Math.max(4000, distance * 40),
        useNativeDriver: true,
      }),
    );
    animation.start();

    return () => animation.stop();
  }, [gap, text, textWidth, translateX, viewportWidth]);

  return (
    <View
      onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
      style={styles.marqueeViewport}
    >
      <Animated.View
        style={[styles.marqueeTrack, { transform: [{ translateX }] }]}
      >
        <Text
          numberOfLines={1}
          onLayout={(event) => setTextWidth(event.nativeEvent.layout.width)}
          style={[style, styles.marqueeText]}
        >
          {text}
        </Text>
        <View style={{ width: gap }} />
        <Text numberOfLines={1} style={[style, styles.marqueeText]}>
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

function PersonRow({
  person,
  detail,
  colors,
  identityVerified,
}: {
  person: Person;
  detail: string;
  colors: SystemColors;
  identityVerified: boolean;
}) {
  return (
    <View style={styles.personRow}>
      {person.image ? (
        <Image source={{ uri: person.image }} style={styles.personAvatar} />
      ) : (
        <View style={styles.personAvatar} />
      )}
      <View style={styles.personRowCopy}>
        <View style={styles.personRowNameLine}>
          <Text style={styles.personRowName}>
            {person.name}
            {person.age === null ? "" : `, ${person.age}`}
          </Text>
          {identityVerified ? (
            <IdentityVerifiedBadge colors={colors} compact />
          ) : null}
        </View>
        <Text style={styles.personRowDetail}>{detail}</Text>
      </View>
      <Text style={styles.personRowArrow}>›</Text>
    </View>
  );
}

function ProfileTile({
  person,
  detail,
  fillAvailableSpace = false,
  firstNameOnly = false,
  location,
  compatibility,
  onPress,
}: {
  person: Person;
  detail: string;
  fillAvailableSpace?: boolean;
  firstNameOnly?: boolean;
  location?: string | null;
  compatibility?: number | null;
  onPress: () => void;
}) {
  const content = (
    <View style={styles.profileTileContent}>
      {isNewUser(person.accountCreatedAt) ? (
        <View style={styles.profileTileNewBadge}>
          <Text style={styles.profileTileNewText}>New</Text>
        </View>
      ) : null}
      <View style={styles.profileTileBottom}>
        <View style={styles.profileTileNameLine}>
          <Text numberOfLines={1} style={styles.profileTileName}>
            {firstNameOnly ? getFirstName(person.name) : person.name}
            {person.age === null ? "" : `, ${person.age}`}
          </Text>
          {person.identityVerified ? (
            <BadgeCheck
              accessibilityLabel="Identity verified"
              color="#58B8F4"
              size={14}
            />
          ) : null}
        </View>
        {detail ? (
          <Text numberOfLines={1} style={styles.profileTileDetail}>
            {detail}
          </Text>
        ) : null}
        {location ? (
          <Text numberOfLines={1} style={styles.profileTileDetail}>
            {location}
          </Text>
        ) : null}
        {typeof compatibility === "number" ? (
          <Text numberOfLines={1} style={styles.profileTileCompatibility}>
            {compatibility}% compatible
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${person.name}'s profile${isNewUser(person.accountCreatedAt) ? ", new user" : ""}`}
      onPress={onPress}
      style={[styles.profileTile, fillAvailableSpace && styles.profileTileFill]}
    >
      {person.image ? (
        <ImageBackground
          source={{ uri: person.image }}
          resizeMode="cover"
          style={[
            styles.profileTileImage,
            fillAvailableSpace && styles.profileTileImageFill,
          ]}
          imageStyle={styles.profileTileImageBorder}
        >
          {content}
        </ImageBackground>
      ) : (
        <View
          style={[
            styles.profileTileImage,
            styles.profileTileImagePlaceholder,
            fillAvailableSpace && styles.profileTileImageFill,
          ]}
        >
          {content}
        </View>
      )}
    </Pressable>
  );
}

function EmptyState({
  symbol,
  title,
  message,
  buttonText,
  onPress,
}: {
  symbol: string;
  title: string;
  message: string;
  buttonText: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}>
        <Text style={styles.emptySymbol}>{symbol}</Text>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      <Pressable onPress={onPress} style={styles.emptyButton}>
        <Text style={styles.emptyButtonText}>{buttonText}</Text>
      </Pressable>
    </View>
  );
}

function getAlignmentLabel(score: number): string {
  if (score >= 90) return "Excellent alignment";
  if (score >= 75) return "Very strong alignment";
  if (score >= 60) return "Good alignment";
  return "Some alignment";
}

function formatLikeDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function isNewUser(createdAt?: string): boolean {
  if (!createdAt) return false;
  const accountCreated = Date.parse(createdAt);
  if (Number.isNaN(accountCreated)) return false;
  const hoursSinceCreation = (Date.now() - accountCreated) / (1000 * 60 * 60);
  return hoursSinceCreation >= 0 && hoursSinceCreation <= 24;
}

function getFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function isNewVisitor(firstViewedAt: string): boolean {
  const firstViewed = Date.parse(firstViewedAt);
  const hoursSinceFirstVisit = (Date.now() - firstViewed) / (1000 * 60 * 60);
  return (
    !Number.isNaN(firstViewed) &&
    hoursSinceFirstVisit >= 0 &&
    hoursSinceFirstVisit <= 24
  );
}

function isRecentVisitor(viewedAt: string): boolean {
  const lastViewed = Date.parse(viewedAt);
  const hoursSinceLastVisit = (Date.now() - lastViewed) / (1000 * 60 * 60);
  return (
    !Number.isNaN(lastViewed) &&
    hoursSinceLastVisit >= 0 &&
    hoursSinceLastVisit <= 24
  );
}

function isMatchInactive(lastActivityAt: string): boolean {
  const lastActivity = Date.parse(lastActivityAt);
  return (
    Number.isFinite(lastActivity) &&
    Date.now() - lastActivity >= 30 * 24 * 60 * 60 * 1000
  );
}

function formatRelativeTime(value: string, subject = "Viewed"): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return `${subject} recently`;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return `${subject} just now`;
  if (minutes < 60) {
    return `${subject} ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${subject} ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${subject} ${days} ${days === 1 ? "day" : "days"} ago`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#171315",
  },
  app: {
    flex: 1,
    paddingHorizontal: 20,
  },
  header: {
    height: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  notificationButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#3B3236",
    backgroundColor: "#211B1E",
  },
  notificationUnreadBadge: {
    position: "absolute",
    top: -4,
    right: -5,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#211B1E",
    backgroundColor: brandColors.magenta,
  },
  notificationUnreadBadgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
    lineHeight: 11,
  },
  headerButtonPressed: {
    opacity: 0.72,
  },
  logoImage: {
    width: 100,
    height: 56,
  },
  locationButton: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#3B3236",
    backgroundColor: "#211B1E",
  },
  locationPin: {
    color: brandColors.magenta,
    fontSize: 18,
    marginRight: 5,
  },
  locationText: {
    color: brandColors.magenta,
    fontSize: 12,
    fontWeight: "600",
  },
  locationChevron: {
    color: brandColors.magenta,
    fontSize: 14,
    marginLeft: 7,
    marginTop: -4,
  },
  notificationPage: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 61,
    left: 0,
    flex: 1,
    backgroundColor: "#FAF7F4",
  },
  notificationPageHeader: {
    minHeight: 112,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 10,
    backgroundColor: "#291D2A",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#493A4A",
  },
  notificationHeaderTopline: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  notificationHeaderCopy: {
    flex: 1,
  },
  notificationHeaderEyebrow: {
    color: "#DDA8B8",
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 0.6,
    marginTop: 4,
  },
  notificationModalTitle: {
    color: "#FAF7F4",
    fontSize: 19,
    fontWeight: "700",
  },
  notificationHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  notificationCloseButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
  },
  notificationFilterBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  notificationFilterChip: {
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: "#493A4A",
    paddingHorizontal: 13,
  },
  notificationFilterChipSelected: {
    backgroundColor: "#FAF7F4",
  },
  notificationFilterChipText: {
    color: "#E8DFE8",
    fontSize: 11,
    fontWeight: "500",
  },
  notificationFilterChipTextSelected: {
    color: "#291D2A",
    fontWeight: "700",
  },
  notificationEmptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  notificationList: {
    flexGrow: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 28,
  },
  notificationDateGroup: {
    color: "#766A75",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 5,
    marginBottom: 3,
  },
  notificationUnreadPill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    backgroundColor: "#1E3A2C",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  notificationUnreadPillText: {
    color: "#86D7A7",
    fontSize: 9,
    fontWeight: "700",
  },
  notificationNotice: {
    borderRadius: 12,
    backgroundColor: "#F3E4E5",
    padding: 14,
  },
  notificationNoticeText: {
    color: "#291D2A",
    fontSize: 12,
    lineHeight: 18,
  },
  notificationRetry: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 8,
  },
  notificationPushNote: {
    color: "#766A75",
    fontSize: 11,
    lineHeight: 17,
    paddingHorizontal: 2,
  },
  notificationCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E7E0DB",
    backgroundColor: "#FAF7F4",
    paddingVertical: 16,
  },
  notificationCardPressed: {
    opacity: 0.72,
  },
  notificationCardIcon: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "#F1DDE5",
  },
  notificationCardContent: {
    flex: 1,
    minWidth: 0,
  },
  notificationCardHeading: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  notificationCardTitle: {
    flex: 1,
    color: "#291D2A",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 19,
  },
  notificationNewPill: {
    borderRadius: 12,
    backgroundColor: "#D9F0E2",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  notificationNewPillText: {
    color: "#257449",
    fontSize: 10,
    fontWeight: "700",
  },
  notificationStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  notificationUnreadDot: {
    backgroundColor: "#43866A",
  },
  notificationReadDot: {
    backgroundColor: "#766A75",
  },
  notificationDetail: {
    flex: 1,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E7E0DB",
    backgroundColor: "#FFFFFF",
    padding: 20,
  },
  notificationDetailTopline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  notificationSenderAvatar: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "#F1DDE5",
  },
  notificationDetailSender: {
    flex: 1,
    gap: 3,
  },
  notificationDetailFromLabel: {
    color: "#766A75",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  notificationDetailFrom: {
    color: "#291D2A",
    fontSize: 12,
    fontWeight: "700",
  },
  notificationReadState: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  notificationUnreadState: {
    backgroundColor: "#D9F0E2",
  },
  notificationReadStateMuted: {
    backgroundColor: "#F0EAE7",
  },
  notificationReadStateText: {
    color: "#766A75",
    fontSize: 9,
    fontWeight: "700",
  },
  notificationDetailDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E7E0DB",
    marginTop: 18,
    marginBottom: 18,
  },
  notificationDetailTitle: {
    color: "#291D2A",
    fontSize: 21,
    fontWeight: "700",
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  notificationDetailDate: {
    color: "#766A75",
    fontSize: 11,
    marginTop: 7,
  },
  notificationDetailBody: {
    color: "#493A4A",
    fontSize: 14,
    lineHeight: 24,
    marginTop: 22,
  },
  notificationDetailLink: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DDA8B8",
    backgroundColor: "#FAF7F4",
    marginTop: 24,
    paddingHorizontal: 13,
  },
  notificationDetailLinkText: {
    flex: 1,
    color: "#8F4261",
    fontSize: 12,
    fontWeight: "700",
  },
  notificationCardBody: {
    color: "#766A75",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 5,
  },
  notificationCardDate: {
    color: "#A49AA3",
    fontSize: 9,
    marginTop: 5,
  },
  notificationEmptyIcon: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 27,
    backgroundColor: "#F1DDE5",
  },
  notificationEmptyTitle: {
    color: "#291D2A",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 14,
  },
  notificationEmptyCopy: {
    color: "#766A75",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 6,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  discoverScreen: {
    flex: 1,
    minHeight: 0,
  },
  discoveryModes: {
    flexDirection: "row",
    padding: 3,
    marginBottom: 8,
    borderRadius: 18,
    backgroundColor: "#2A2124",
  },
  discoveryModeButton: {
    flex: 1,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
  },
  discoveryModeActive: {
    backgroundColor: brandColors.magentaAccessible,
  },
  discoveryModeText: {
    color: "#B8AEB2",
    fontSize: 11,
    fontWeight: "700",
  },
  discoveryModeTextActive: {
    color: "#FFFFFF",
  },
  sectionHeading: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dailyMeta: {
    alignItems: "flex-end",
    gap: 5,
  },
  eyebrow: {
    color: brandColors.magenta,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 5,
  },
  discoveryHeading: {
    color: "#FFF8F4",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.35,
  },
  heading: {
    color: "#FFF8F4",
    fontSize: 25,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  dailyCount: {
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: "#2A2124",
  },
  dailyCountText: {
    color: "#E9CDC4",
    fontSize: 10,
    fontWeight: "600",
  },
  countdownText: {
    color: "#B8AEB2",
    fontSize: 9,
    fontWeight: "600",
  },
  exploreFilters: {
    marginBottom: 8,
    gap: 5,
  },
  filterLabel: {
    color: brandColors.magenta,
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginTop: 2,
  },
  filterOptions: {
    gap: 6,
    paddingVertical: 2,
  },
  filterChip: {
    minHeight: 27,
    justifyContent: "center",
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "#59494E",
    borderRadius: 14,
  },
  filterChipActive: {
    borderColor: brandColors.magenta,
    backgroundColor: "#52353A",
  },
  filterChipText: {
    color: "#B8AEB2",
    fontSize: 9,
    fontWeight: "600",
  },
  filterChipTextActive: {
    color: "#FFF8F4",
  },
  exploreInvitation: {
    width: "100%",
    alignItems: "center",
    paddingTop: 20,
    marginTop: 26,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#59494E",
  },
  exploreInvitationTitle: {
    color: "#FFF8F4",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  discoveryMessage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  dailyRefreshNotice: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: "#34292D",
  },
  dailyRefreshText: {
    color: "#E9CDC4",
    fontSize: 11,
    fontWeight: "600",
  },
  dailyRefreshError: {
    flex: 1,
    color: "#F0A7A3",
    fontSize: 10,
    lineHeight: 15,
  },
  dailyRefreshButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  dailyRefreshButtonText: {
    color: "#FFF8F4",
    fontSize: 10,
    fontWeight: "700",
  },
  errorMessage: {
    color: "#F0A7A3",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginBottom: 10,
  },
  profileCard: {
    flex: 1,
    minHeight: 300,
    borderRadius: 25,
    backgroundColor: "#34292D",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 8,
  },
  swipeFeedbackBadge: {
    position: "absolute",
    top: 24,
    minWidth: 86,
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderRadius: 16,
    backgroundColor: "rgba(33, 27, 30, 0.82)",
    zIndex: 5,
  },
  superLikeBurst: {
    position: "absolute",
    top: "38%",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 8,
  },
  superLikeBurstIcon: {
    width: 82,
    height: 82,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(253, 21, 102, 0.6)",
    borderRadius: 41,
    backgroundColor: "rgba(33, 27, 30, 0.92)",
  },
  superLikeBurstLabel: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.8,
    marginTop: 10,
    textShadowColor: "#4802A2",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  swipeLikeBadge: {
    left: 22,
    borderColor: "#FF8FA3",
  },
  swipePassBadge: {
    right: 22,
    borderColor: "#FFFFFF",
  },
  likedBackBadge: {
    position: "absolute",
    top: 76,
    left: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#FF8FA3",
    borderRadius: 18,
    backgroundColor: "rgba(33, 27, 30, 0.9)",
    zIndex: 6,
  },
  likedBackBadgeIcon: {
    color: "#FF8FA3",
    fontSize: 14,
    fontWeight: "800",
  },
  likedBackBadgeText: {
    color: "#FFF8F4",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  likedBackNotice: {
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  likedBackNoticeText: {
    color: "#D9C5C6",
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
  },
  swipeFeedbackIcon: {
    color: "#FF8FA3",
    fontSize: 28,
    lineHeight: 31,
    fontWeight: "800",
  },
  swipePassIcon: {
    color: "#FFFFFF",
  },
  swipeFeedbackLabel: {
    color: "#FFF8F4",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  profileImage: {
    flex: 1,
    justifyContent: "space-between",
    overflow: "hidden",
    borderRadius: 25,
    backgroundColor: "#4B383D",
  },
  profileImageCorners: {
    borderRadius: 25,
  },
  photoPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4B383D",
  },
  photoPlaceholderMark: {
    color: "#D5A49A",
    fontSize: 64,
    fontWeight: "300",
    letterSpacing: 4,
  },
  photoPlaceholderLabel: {
    color: "#D9C5C6",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 2,
  },
  imageShade: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(20, 13, 16, 0.12)",
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 14,
  },
  cardTopActions: {
    maxWidth: "62%",
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  intentBadge: {
    flex: 1,
    minWidth: 0,
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: "rgba(28, 22, 24, 0.68)",
  },
  intentText: {
    color: "#FFF8F4",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1,
  },
  distanceBadge: {
    flexShrink: 1,
    maxWidth: 110,
    minHeight: 30,
    justifyContent: "center",
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: "rgba(28, 22, 24, 0.68)",
  },
  distanceText: {
    color: "#FFF8F4",
    fontSize: 10,
    fontWeight: "600",
    flexShrink: 1,
  },
  marqueeViewport: {
    width: "100%",
    overflow: "hidden",
  },
  marqueeTrack: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
  },
  marqueeText: {
    flexShrink: 0,
  },
  safetyMenuButton: {
    flexShrink: 0,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  profileInfo: {
    paddingHorizontal: 19,
    paddingTop: 72,
    paddingBottom: 22,
    backgroundColor: "rgba(20, 13, 16, 0.58)",
  },
  profileSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  nameScroller: {
    flex: 1,
    minWidth: 0,
  },
  viewDetailsButton: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: brandColors.magenta,
    borderRadius: 18,
    backgroundColor: "rgba(28, 22, 24, 0.65)",
  },
  viewDetailsText: {
    color: "#FFF8F4",
    fontSize: 10,
    fontWeight: "700",
  },
  compatibilityPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
    marginTop: 11,
    borderRadius: 16,
    backgroundColor: "rgba(255, 248, 244, 0.16)",
  },
  compatibilityScore: {
    color: "#DFF2E6",
    fontSize: 16,
    fontWeight: "800",
  },
  compatibilityTitle: {
    color: "#FFF8F4",
    fontSize: 10,
    fontWeight: "700",
  },
  compatibilitySubtitle: {
    color: "#C9DCCF",
    fontSize: 9,
    marginTop: 2,
  },
  compatibilityUnavailable: {
    color: "#D9C5C6",
    fontSize: 10,
    marginTop: 8,
  },
  compatibilityArrow: {
    color: "#FFF8F4",
    fontSize: 20,
  },
  nameLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  onlinePresence: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    minHeight: 23,
    borderWidth: 1,
    borderRadius: 999,
  },
  onlinePresenceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  onlinePresenceText: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "700",
  },
  nameText: {
    color: brandColors.magenta,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.35,
    flexShrink: 0,
  },
  occupationText: {
    color: "#F1D2C9",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
  },
  bioText: {
    color: "#F4EBE8",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
    maxWidth: 290,
  },
  interestRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 12,
  },
  interestPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
    marginBottom: 3,
    borderRadius: 13,
    backgroundColor: "rgba(255, 248, 244, 0.16)",
  },
  interestText: {
    color: "#FFF8F4",
    fontSize: 10,
    fontWeight: "600",
  },
  photoCount: {
    position: "absolute",
    top: 24,
    alignSelf: "center",
    flexDirection: "row",
  },
  photoDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginHorizontal: 3,
    backgroundColor: "rgba(255, 248, 244, 0.52)",
  },
  photoDotActive: {
    width: 16,
    backgroundColor: "#FFF8F4",
  },
  actionsArea: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 10,
  },
  outOfRadiusWarning: {
    color: "#F1C7A7",
    fontSize: 10,
    lineHeight: 15,
    textAlign: "center",
    marginBottom: 8,
    maxWidth: 330,
  },
  outOfRadiusControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 8,
  },
  outOfRadiusButton: {
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: brandColors.magentaAccessible,
  },
  feedback: {
    height: 15,
    color: "#978A8E",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1.6,
  },
  actionRow: {
    width: 236,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  actionButton: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 40,
  },
  passButton: {
    width: 54,
    height: 54,
    borderWidth: 1,
    borderColor: "#4B3C41",
    backgroundColor: "#241D20",
  },
  sparkButton: {
    width: 46,
    height: 46,
    borderWidth: 1,
    borderColor: "#60433E",
    backgroundColor: "#2B2021",
  },
  likeButton: {
    width: 62,
    height: 62,
    backgroundColor: ACCENT,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.24,
    shadowRadius: 9,
    elevation: 5,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.94 }],
  },
  disabled: {
    opacity: 0.55,
  },
  safetyModalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "rgba(0, 0, 0, 0.62)",
  },
  profileDetailsBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.68)",
  },
  safetyModal: {
    width: "100%",
    maxWidth: 420,
    padding: 22,
    borderWidth: 1,
    borderColor: "#493A3F",
    borderRadius: 22,
    backgroundColor: "#211B1E",
  },
  safetyModalTitle: {
    color: "#FFF8F4",
    fontSize: 19,
    fontWeight: "700",
  },
  safetyModalCopy: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
    marginBottom: 14,
  },
  safetyOption: {
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#493A3F",
  },
  safetyOptionTitle: {
    color: "#FFF8F4",
    fontSize: 14,
    fontWeight: "700",
  },
  safetyOptionCopy: {
    color: MUTED,
    fontSize: 11,
    marginTop: 4,
  },
  safetyConfirmButton: {
    alignItems: "center",
    paddingVertical: 13,
    borderRadius: 18,
    backgroundColor: ACCENT,
  },
  safetyConfirmText: {
    color: "#331B1D",
    fontSize: 13,
    fontWeight: "700",
  },
  safetyCancelButton: {
    alignItems: "center",
    paddingVertical: 12,
    marginTop: 5,
  },
  safetyCancelText: {
    color: "#F1D2C9",
    fontSize: 12,
    fontWeight: "600",
  },
  compatibilityModal: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "88%",
    padding: 22,
    borderWidth: 1,
    borderColor: "#493A3F",
    borderRadius: 22,
    backgroundColor: "#211B1E",
  },
  profileDetailsSheet: {
    width: "100%",
    maxWidth: 540,
    height: "92%",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#4A393F",
    borderBottomWidth: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#211B1E",
  },
  profileDetailsTopBar: {
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  profileDetailsHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#6A585E",
  },
  profileDetailsClose: {
    position: "absolute",
    top: 8,
    right: 16,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#493A3F",
    borderRadius: 16,
    backgroundColor: "#30262A",
  },
  profileDetailsCloseText: {
    color: "#FFF8F4",
    fontSize: 22,
    lineHeight: 24,
    fontWeight: "400",
  },
  profileDetailsHeroFrame: {
    height: 330,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#3A3034",
  },
  profileDetailsPhotoIndicators: {
    position: "absolute",
    top: 12,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
  },
  profileDetailsPhotoIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255, 248, 244, 0.48)",
  },
  profileDetailsPhotoIndicatorActive: {
    width: 16,
    backgroundColor: "#FFF8F4",
  },
  profileDetailsPhotoScroller: {
    flex: 1,
  },
  profileDetailsPhotoPage: {
    height: 330,
    overflow: "hidden",
  },
  profileDetailsHeroPhoto: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    backgroundColor: "#211B1E",
  },
  profileDetailsHeroShade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "flex-end",
    padding: 18,
    backgroundColor: "rgba(18, 12, 15, 0.20)",
  },
  profileDetailsHeroCopy: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(20, 13, 16, 0.68)",
  },
  profileDetailsEyebrow: {
    color: ACCENT,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.6,
    marginBottom: 5,
  },
  profileDetailsNameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  profileDetailsName: {
    color: "#FFF8F4",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.5,
    flexShrink: 1,
  },
  profileDetailsLocation: {
    color: "#E8DAD8",
    fontSize: 12,
    fontWeight: "500",
    marginTop: 4,
  },
  profileDetailsPhotoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#34292D",
  },
  profileDetailsPlaceholderMark: {
    color: "#D5A49A",
    fontSize: 72,
    fontWeight: "300",
    letterSpacing: 5,
  },
  profileDetailsPlaceholderLabel: {
    color: "#D9C5C6",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.8,
  },
  profileDetailsPlaceholderCopy: {
    position: "absolute",
    left: 18,
    bottom: 18,
  },
  profileDetailsBody: {
    paddingHorizontal: 4,
    paddingTop: 6,
    paddingBottom: 18,
  },
  likeProfileContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  likeProfileLabel: {
    color: brandColors.magenta,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginTop: 16,
  },
  likeProfileCompatibility: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 15,
    marginTop: 18,
    borderWidth: 1,
    borderColor: "#60433E",
    borderRadius: 18,
    backgroundColor: "#302327",
  },
  likeProfileCompatibilityScore: {
    color: "#FFF8F4",
    fontSize: 16,
    fontWeight: "800",
    marginTop: 3,
  },
  profileDetailsSection: {
    marginTop: 18,
  },
  profileDetailsOccupation: {
    color: "#FFF8F4",
    fontSize: 15,
    fontWeight: "600",
    marginTop: 6,
  },
  profileDetailsBio: {
    color: "#E3D8D8",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
  },
  profileDetailsChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  profileDetailsChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#59494E",
    borderRadius: 16,
    backgroundColor: "#30262A",
  },
  profileDetailsChipText: {
    color: "#F1E5E1",
    fontSize: 11,
    fontWeight: "600",
  },
  profileDetailsCompatibilityCopy: {
    flex: 1,
  },
  profileDetailsCompatibilityLabel: {
    color: brandColors.magenta,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  profileDetailsCompatibilityArrow: {
    color: "#FFF8F4",
    fontSize: 25,
    marginLeft: 10,
  },
  profileDetailsFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#493A3F",
    backgroundColor: "#211B1E",
  },
  profileDetailsDoneButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    backgroundColor: ACCENT,
  },
  profileDetailsDoneText: {
    color: "#331B1D",
    fontSize: 14,
    fontWeight: "800",
  },
  receivedLikeActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  receivedLikePass: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#59494E",
    borderRadius: 22,
  },
  receivedLikePassText: {
    color: "#E9CDC4",
    fontSize: 13,
    fontWeight: "700",
  },
  receivedLikeBack: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: ACCENT,
  },
  receivedLikeBackText: {
    color: "#331B1D",
    fontSize: 13,
    fontWeight: "700",
  },
  compatibilityModalEyebrow: {
    color: brandColors.magenta,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.8,
  },
  compatibilityModalTitle: {
    color: "#FFF8F4",
    fontSize: 21,
    fontWeight: "700",
    marginTop: 5,
  },
  compatibilitySummary: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
    marginTop: 15,
  },
  compatibilitySummaryScore: {
    color: "#DFF2E6",
    fontSize: 34,
    fontWeight: "800",
  },
  compatibilitySummaryLabel: {
    color: "#C9DCCF",
    fontSize: 12,
    fontWeight: "600",
  },
  compatibilityDisclaimer: {
    color: MUTED,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  compatibilityConfidence: {
    color: "#D6C8CE",
    fontSize: 10,
    lineHeight: 15,
    marginTop: 8,
  },
  compatibilityDimensions: {
    flexGrow: 0,
    marginTop: 13,
  },
  compatibilityDimensionsContent: {
    paddingBottom: 2,
  },
  compatibilityDimension: {
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#493A3F",
  },
  compatibilityDimensionCopy: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  compatibilityDimensionName: {
    color: "#FFF8F4",
    fontSize: 12,
    fontWeight: "600",
  },
  compatibilityDimensionWeight: {
    color: MUTED,
    fontSize: 10,
  },
  compatibilityDimensionScore: {
    color: "#D6C8CE",
    fontSize: 10,
    marginTop: 4,
  },
  actionSymbol: {
    fontWeight: "500",
    textAlign: "center",
  },
  passSymbol: {
    color: "#D5B8B1",
    fontSize: 31,
    lineHeight: 34,
  },
  sparkSymbol: {
    color: brandColors.magenta,
    fontSize: 20,
  },
  likeSymbol: {
    color: "#331B1D",
    fontSize: 25,
    marginTop: 2,
  },
  tabBar: {
    height: 61,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#342B2F",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  tabSymbolWrap: {
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  tabLabel: {
    maxWidth: "100%",
    color: "#83777B",
    fontSize: 9,
    fontWeight: "500",
    marginTop: 2,
    textAlign: "center",
  },
  tabLabelActive: {
    color: brandColors.magenta,
    fontWeight: "700",
  },
  tabCount: {
    position: "absolute",
    top: -1,
    right: -9,
    minWidth: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
    backgroundColor: ACCENT,
  },
  tabCountText: {
    color: "#331B1D",
    fontSize: 8,
    fontWeight: "800",
  },
  secondaryScreen: {
    flex: 1,
    paddingTop: 16,
  },
  likesSubtitle: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  likesSections: {
    flexDirection: "row",
    gap: 6,
    padding: 4,
    marginTop: 16,
    borderRadius: 18,
    backgroundColor: "#2A2124",
  },
  likesSectionButton: {
    flex: 1,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  likesSectionButtonActive: {
    backgroundColor: ACCENT,
  },
  likesSectionText: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "700",
  },
  likesSectionTextActive: {
    color: "#331B1D",
  },
  likesDirectionTabs: {
    flexDirection: "row",
    alignSelf: "flex-start",
    gap: 8,
    marginTop: 10,
  },
  likesDirectionButton: {
    minHeight: 30,
    justifyContent: "center",
    paddingHorizontal: 13,
    borderRadius: 15,
    backgroundColor: "#2A2124",
  },
  likesDirectionButtonActive: {
    backgroundColor: "#49383D",
  },
  likesDirectionText: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "700",
  },
  likesDirectionTextActive: {
    color: "#FFF8F4",
  },
  visitorFilterTabs: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  visitorFilterButton: {
    minHeight: 28,
    justifyContent: "center",
    paddingHorizontal: 11,
    borderRadius: 14,
    backgroundColor: "#2A2124",
  },
  visitorFilterButtonActive: {
    backgroundColor: "#49383D",
  },
  visitorFilterText: {
    color: MUTED,
    fontSize: 10,
    fontWeight: "700",
  },
  visitorFilterTextActive: {
    color: "#FFF8F4",
  },
  likesList: {
    flexGrow: 1,
    paddingTop: 12,
    paddingBottom: 24,
  },
  likesScroll: {
    flex: 1,
  },
  likesListSingle: {
    flexGrow: 1,
  },
  profileTilesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    flexGrow: 1,
    rowGap: 14,
  },
  profileTileColumn: {
    width: "48%",
  },
  profileTileColumnSingle: {
    width: "100%",
    flex: 1,
  },
  profileTile: {
    width: "100%",
    aspectRatio: 0.72,
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: "#3A3034",
  },
  profileTileFill: {
    flex: 1,
    aspectRatio: undefined,
    minHeight: 420,
  },
  profileTileImage: {
    flex: 1,
  },
  profileTileImageFill: {
    minHeight: 420,
  },
  profileTileImageBorder: {
    borderRadius: 16,
  },
  profileTileImagePlaceholder: {
    backgroundColor: "#3A3034",
  },
  profileTileContent: {
    flex: 1,
    justifyContent: "space-between",
    padding: 8,
  },
  profileTileNewBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: ACCENT,
  },
  profileTileNewText: {
    color: "#331B1D",
    fontSize: 10,
    fontWeight: "800",
  },
  profileTileBottom: {
    marginHorizontal: -8,
    marginBottom: -8,
    paddingHorizontal: 8,
    paddingTop: 16,
    paddingBottom: 8,
    backgroundColor: "rgba(18, 14, 16, 0.72)",
  },
  profileTileNameLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  profileTileName: {
    flexShrink: 1,
    color: "#FFF8F4",
    fontSize: 12,
    fontWeight: "800",
  },
  profileTileDetail: {
    color: "#E2DADD",
    fontSize: 9,
    marginTop: 3,
  },
  profileTileCompatibility: {
    color: "#F4B19F",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 3,
  },
  profileTileActions: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
  },
  visitorMessageButton: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 6,
    borderRadius: 12,
    backgroundColor: ACCENT,
  },
  likesSectionHeader: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  likesSectionHeading: {
    color: "#FFF8F4",
    fontSize: 13,
    fontWeight: "700",
  },
  likesNewCount: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "#063E24",
  },
  likesNewCountText: {
    color: "#29D678",
    fontSize: 10,
    fontWeight: "700",
  },
  receivedLikeCard: {
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#493A3F",
    borderRadius: 18,
    backgroundColor: "#211B1E",
  },
  receivedLikeProfile: {
    flexDirection: "row",
    alignItems: "center",
  },
  receivedLikeAvatar: {
    width: 70,
    height: 82,
    borderRadius: 13,
    backgroundColor: "#3A3034",
  },
  receivedLikeBio: {
    color: "#B8AEB2",
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
  },
  likesLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  likesMessage: {
    color: "#DFF2E6",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  chemistryCard: {
    padding: 20,
    borderWidth: 1,
    borderColor: "#493A3F",
    borderRadius: 20,
    backgroundColor: "#211B1E",
    marginTop: 24,
  },
  chemistrySpark: {
    color: ACCENT,
    fontSize: 24,
  },
  chemistryTitle: {
    color: "#FFF8F4",
    fontSize: 17,
    fontWeight: "700",
    marginTop: 13,
  },
  chemistryCopy: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  chemistryDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#493A3F",
    marginVertical: 18,
  },
  chemistryLabel: {
    color: "#E98B78",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.4,
    marginTop: 12,
  },
  chemistryValue: {
    color: "#F5EDEA",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  peopleList: {
    paddingTop: 24,
  },
  personRow: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#3A3034",
  },
  personAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#3A3034",
  },
  personRowCopy: {
    flex: 1,
    marginLeft: 13,
  },
  personRowName: {
    color: "#FFF8F4",
    fontSize: 15,
    fontWeight: "700",
  },
  personRowNameLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  personRowDetail: {
    color: MUTED,
    fontSize: 11,
    marginTop: 4,
  },
  personRowArrow: {
    color: "#9A898F",
    fontSize: 27,
    paddingHorizontal: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 25,
    paddingBottom: 48,
  },
  emptyIcon: {
    width: 74,
    height: 74,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 37,
    backgroundColor: "#2A2124",
  },
  emptySymbol: {
    color: brandColors.magenta,
    fontSize: 34,
  },
  emptyTitle: {
    color: "#FFF8F4",
    fontSize: 20,
    fontWeight: "700",
    marginTop: 20,
  },
  emptyMessage: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 9,
    maxWidth: 290,
  },
  emptyButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 22,
    marginTop: 22,
    backgroundColor: brandColors.magentaAccessible,
  },
  emptyButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
});

const gateStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#171315",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  wordmark: {
    color: "#FFF8F4",
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 4.5,
    marginBottom: 22,
  },
  errorTitle: {
    color: "#FFF8F4",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 20,
  },
  errorMessage: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 9,
  },
  retryButton: {
    minWidth: 140,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 18,
    marginTop: 22,
    backgroundColor: ACCENT,
  },
  retryText: {
    color: "#331B1D",
    fontSize: 12,
    fontWeight: "700",
  },
  signOutButton: {
    padding: 12,
    marginTop: 5,
  },
  signOutText: {
    color: "#BDAEB3",
    fontSize: 12,
  },
});

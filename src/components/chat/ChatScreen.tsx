import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ComponentRef, ComponentType, ReactNode } from "react";
import { isRunningInExpoGo } from "expo";
import {
  AppState,
  Animated,
  Dimensions,
  Easing,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  Check,
  CheckCheck,
  Archive,
  ArchiveRestore,
  Ban,
  Camera,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Flag,
  Heart,
  HeartCrack,
  LockKeyhole,
  LockKeyholeOpen,
  Mic,
  MoreVertical,
  Paperclip,
  Pause,
  Play,
  Reply,
  Search,
  Send,
  ShieldCheck,
  Smile,
  SlidersHorizontal,
  Square,
  Sparkles,
  Trash2,
  X,
  Video,
  Eye,
  EyeOff,
  Users,
  MessageCircle,
} from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  addScreenshotListener,
  allowScreenCaptureAsync,
  disableAppSwitcherProtectionAsync,
  enableAppSwitcherProtectionAsync,
  preventScreenCaptureAsync,
} from "expo-screen-capture";
import { IdentityVerifiedBadge } from "../IdentityVerifiedBadge";
import { ProfilePhotoGallery } from "../ProfilePhotoGallery";
import { blockUser } from "../../data/privacySettings";
import { reportChatMessage } from "../../data/support";
import EmojiPicker from "../../lib/EmojiPicker";
import {
  getChatFeed,
  getConversationMessages,
  clearViewOnceLocalCache,
  deleteConversationMessageForEveryone,
  deleteLocalChatFile,
  deleteLocalViewOnceFile,
  downloadViewOnceMedia,
  hideConversationMessage,
  markConversationRead,
  reportConversationMember,
  sendConversationMessage,
  sendConversationAttachment,
  sendConversationDraft,
  setConversationMessageReaction,
  setConversationArchived,
  setConversationLocked,
  getChatLockPinConfigured,
  getLockedChatFeed,
  revokeLockedChatAccess,
  resetChatLockPin,
  setChatLockPin,
  subscribeToConversation,
  subscribeToConversationList,
  unmatchConversation,
  type ChatAttachmentKind,
  type ChatConversation,
  type ChatAttachment,
  type ChatDraftAttachment,
  type ChatMessage,
  type ChatReactionValue,
  type ChatPerson,
  type NewChatMatch,
} from "../../data/chat";
import { useOnlineStatuses } from "../../data/onlinePresence";
import { recordProfileView } from "../../data/dailyDiscovery";
import { systemColors, type SystemColors } from "../../systemColors";
import {
  endVideoDiscoveryCall,
  getVideoCallToken,
  getVideoDiscoveryStatus,
  requestVideoCallWithMatch,
  respondToVideoDiscovery,
  type VideoCallToken,
  type VideoDiscoveryStatus,
} from "../../data/videoDiscovery";
import { initializeLiveKit } from "../../lib/liveKit";
import type { VideoCallRoomProps } from "../video/VideoCallRoom";
import VeyraLoader from "../../reusables/VeyraLoader";

type ChatFilter = "all" | "unread" | "new" | "archived";
type ActiveConversation = {
  id: string;
  matchId: string;
  person: ChatPerson;
  locked?: boolean;
};
type SafetyAction =
  | "menu"
  | "block"
  | "unmatch"
  | "report"
  | "report-message"
  | null;
type ReportReason =
  | "inappropriate"
  | "harassment"
  | "spam"
  | "fake_profile"
  | "other";
type ChatStyles = ReturnType<typeof createStyles>;
type PreviewAttachment = Omit<ChatAttachment, "kind"> & {
  kind: ChatAttachmentKind;
  viewOnce?: boolean;
  messageId?: string;
  localUri?: string;
};
type VideoPreviewAttachment = Omit<ChatAttachment, "kind"> & {
  kind: "video";
};
type PendingViewOnce = {
  uri: string;
  kind: ChatAttachmentKind;
  mimeType?: string | null;
  deleteAfterSend?: boolean;
};
type PendingVoiceRecording = {
  uri: string;
  durationMs: number;
  viewOnce: boolean;
};
type MediaDraft = ChatDraftAttachment & {
  id: string;
  fileSize?: number;
};

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "harassment", label: "Threats or intimidation" },
  { value: "spam", label: "Spam or scam" },
  { value: "inappropriate", label: "Sexual content" },
  { value: "fake_profile", label: "Fake profile" },
  { value: "other", label: "Something else" },
];
const VOICE_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: "document" as const,
  isMeteringEnabled: true,
};
const NATIVE_VIDEO_CALLS = Platform.OS !== "web" && !isRunningInExpoGo();
const NATIVE_SCREEN_PROTECTION = Platform.OS !== "web" && !isRunningInExpoGo();
const STARTER_PROMPTS = [
  "What’s something you’re looking forward to?",
  "What does a perfect weekend look like for you?",
  "What’s a place you’d love to visit together?",
];
const REPLY_MESSAGE_MARKER = "__veyra_reply__:";
const CHAT_ACCENT = "#E98B78";
const MESSAGE_REACTIONS: {
  value: ChatReactionValue;
  emoji: string;
  label: string;
}[] = [
  { value: "heart", emoji: "❤️", label: "Heart" },
  { value: "laugh", emoji: "😂", label: "Laugh" },
  { value: "wow", emoji: "😮", label: "Wow" },
  { value: "celebrate", emoji: "🎉", label: "Celebrate" },
  { value: "support", emoji: "🙌", label: "Support" },
];

export function ChatScreen({
  userId,
  colors,
  onSessionExpired,
  onCallActive,
  onUnreadCountChange,
  initialPersonId,
  onInitialConversationOpened,
  onOpenChemistry,
}: {
  userId: string;
  colors: SystemColors;
  onSessionExpired: () => Promise<void>;
  onCallActive: (active: boolean) => void;
  onUnreadCountChange: (count: number) => void;
  initialPersonId: string | null;
  onInitialConversationOpened: () => void;
  onOpenChemistry: (matchId: string) => void;
}) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 250);
  const recordingStarted = useRef(false);
  const recordingRequested = useRef(false);
  const recordingConversation = useRef<ActiveConversation | null>(null);
  const recordingViewOnce = useRef(false);
  const openingViewOnceRef = useRef(false);
  const [feed, setFeed] = useState<{
    conversations: ChatConversation[];
    newMatches: NewChatMatch[];
    cleanupWarning: string | null;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [messageView, setMessageView] = useState<
    "search" | "online" | "locked"
  >("search");
  const [isFilterPanelVisible, setIsFilterPanelVisible] = useState(true);
  const [search, setSearch] = useState("");
  const [pinEntryMode, setPinEntryMode] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState("");
  const [lockedConversations, setLockedConversations] = useState<
    ChatConversation[] | null
  >(null);
  const [pinSetupVisible, setPinSetupVisible] = useState(false);
  const [pinResetVisible, setPinResetVisible] = useState(false);
  const [pinModalError, setPinModalError] = useState("");
  const [isPinBusy, setIsPinBusy] = useState(false);
  const [pendingLockConversation, setPendingLockConversation] =
    useState<ActiveConversation | null>(null);
  const lockedAccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeConversation, setActiveConversation] =
    useState<ActiveConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadDividerMessageId, setUnreadDividerMessageId] = useState<
    string | null
  >(null);
  const [unreadDividerCount, setUnreadDividerCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [mediaDrafts, setMediaDrafts] = useState<MediaDraft[]>([]);
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploadProgressPercent, setUploadProgressPercent] = useState<
    number | null
  >(null);
  const [mediaSendFailed, setMediaSendFailed] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [messageMenuTarget, setMessageMenuTarget] =
    useState<ChatMessage | null>(null);
  const [isAttachmentMenuVisible, setIsAttachmentMenuVisible] = useState(false);
  const [isViewOnceMode, setIsViewOnceMode] = useState(false);
  const [pendingViewOnce, setPendingViewOnce] =
    useState<PendingViewOnce | null>(null);
  const [pendingVoiceRecording, setPendingVoiceRecording] =
    useState<PendingVoiceRecording | null>(null);
  const [openingViewOnceId, setOpeningViewOnceId] = useState<string | null>(
    null,
  );
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isEmojiPickerVisible, setIsEmojiPickerVisible] = useState(false);
  const [safetyAction, setSafetyAction] = useState<SafetyAction>(null);
  const [reportedMessageId, setReportedMessageId] = useState<string | null>(
    null,
  );
  const [reportReason, setReportReason] =
    useState<ReportReason>("inappropriate");
  const [isSavingSafety, setIsSavingSafety] = useState(false);
  const [profilePerson, setProfilePerson] = useState<ChatPerson | null>(null);
  const [previewAttachment, setPreviewAttachment] =
    useState<PreviewAttachment | null>(null);
  const [previewGallery, setPreviewGallery] = useState<PreviewAttachment[]>([]);
  const [previewGalleryIndex, setPreviewGalleryIndex] = useState(0);
  const [notice, setNotice] = useState("");
  const [messageError, setMessageError] = useState("");
  const revokeLockedChatView = useCallback(() => {
    if (lockedAccessTimer.current) {
      clearTimeout(lockedAccessTimer.current);
      lockedAccessTimer.current = null;
    }
    setLockedConversations(null);
    setMessageView("search");
    setPinEntryMode(false);
    setPinValue("");
    setActiveConversation((current) => (current?.locked ? null : current));
    void revokeLockedChatAccess().catch((cause: unknown) => {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Locked Chats access could not be revoked.",
      );
    });
  }, []);
  const grantLockedChatView = useCallback(() => {
    if (lockedAccessTimer.current) clearTimeout(lockedAccessTimer.current);
    lockedAccessTimer.current = setTimeout(
      revokeLockedChatView,
      15 * 60 * 1000,
    );
  }, [revokeLockedChatView]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active" && lockedAccessTimer.current) {
        revokeLockedChatView();
      }
    });
    return () => {
      subscription.remove();
      if (lockedAccessTimer.current) {
        clearTimeout(lockedAccessTimer.current);
        lockedAccessTimer.current = null;
      }
    };
  }, [revokeLockedChatView]);
  const [videoCallStatus, setVideoCallStatus] =
    useState<VideoDiscoveryStatus | null>(null);
  const [videoCallToken, setVideoCallToken] = useState<VideoCallToken | null>(
    null,
  );
  const [CallRoom, setCallRoom] =
    useState<ComponentType<VideoCallRoomProps> | null>(null);
  const [isVideoCallBusy, setIsVideoCallBusy] = useState(false);
  const [videoCallError, setVideoCallError] = useState("");
  const [isArchivingConversation, setIsArchivingConversation] = useState(false);
  const videoCallAttempted = useRef<string | null>(null);
  const videoCallRequestInFlight = useRef(false);
  const videoCallPollInFlight = useRef(false);
  const unreadCountOnOpen = useRef(0);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const composerInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const sessionExpiryHandled = useRef(false);
  const onlineTargetIds = useMemo(
    () =>
      [
        ...(feed?.conversations.map((conversation) => conversation.person.id) ??
          []),
        ...(feed?.newMatches.map((match) => match.person.id) ?? []),
        activeConversation?.person.id,
      ].filter((id): id is string => Boolean(id)),
    [activeConversation?.person.id, feed?.conversations, feed?.newMatches],
  );
  const { onlineUserIds, error: presenceError } = useOnlineStatuses(
    userId,
    onlineTargetIds,
  );
  const isOtherOnline = activeConversation
    ? onlineUserIds.has(activeConversation.person.id)
    : false;
  const onlineConversationIds = useMemo(
    () =>
      new Set(
        feed?.conversations
          .filter((conversation) => onlineUserIds.has(conversation.person.id))
          .map((conversation) => conversation.id) ?? [],
      ),
    [feed?.conversations, onlineUserIds],
  );
  const conversationIdsKey = useMemo(
    () =>
      (feed?.conversations ?? [])
        .map((conversation) => conversation.id)
        .sort()
        .join(","),
    [feed?.conversations],
  );
  const activeConversationCount = useMemo(
    () =>
      feed?.conversations.filter(
        (conversation) => conversation.archivedAt === null,
      ).length ?? 0,
    [feed?.conversations],
  );
  const conversationCount = feed?.conversations.length ?? 0;

  useEffect(() => {
    const targetUserId = profilePerson?.id;
    if (!targetUserId || targetUserId === userId) return;
    void recordProfileView(targetUserId).catch((error: unknown) => {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not record this profile visit.",
      );
    });
  }, [profilePerson?.id, userId]);

  const loadFeed = useCallback(
    async (background = false) => {
      if (!background) setIsLoading(true);
      setError("");
      try {
        const nextFeed = await getChatFeed();
        setFeed(nextFeed);
        if (nextFeed.cleanupWarning) {
          setNotice(
            `Expired View Once media cleanup is pending: ${nextFeed.cleanupWarning}`,
          );
        } else {
          setNotice((current) =>
            current.startsWith("Expired View Once media cleanup is pending:")
              ? ""
              : current,
          );
        }
      } catch (loadError) {
        if (isExpiredSessionError(loadError)) {
          if (!sessionExpiryHandled.current) {
            sessionExpiryHandled.current = true;
            void onSessionExpired().catch((signOutError: unknown) => {
              setError(
                signOutError instanceof Error
                  ? `Your session expired, but sign-out failed: ${signOutError.message}`
                  : "Your session expired, but sign-out failed.",
              );
            });
          }
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load your conversations.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [onSessionExpired],
  );

  useEffect(() => {
    if (!feed) return;
    onUnreadCountChange(
      feed.conversations.reduce(
        (total, conversation) =>
          total +
          (conversation.archivedAt === null ? conversation.unreadCount : 0),
        0,
      ),
    );
  }, [feed, onUnreadCountChange]);

  const loadMessages = useCallback(
    async (conversationId: string, markRead: boolean) => {
      setMessageError("");
      try {
        const nextMessages = await getConversationMessages(conversationId);
        setMessages(nextMessages);
        if (markRead) {
          let firstUnreadIndex = -1;
          let unreadSeen = 0;
          for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
            if (nextMessages[index].senderId === userId) continue;
            unreadSeen += 1;
            if (unreadSeen >= unreadCountOnOpen.current) {
              firstUnreadIndex = index;
              break;
            }
          }
          if (unreadCountOnOpen.current > 0 && firstUnreadIndex >= 0) {
            setUnreadDividerMessageId(
              (current) => current ?? nextMessages[firstUnreadIndex].id,
            );
            setUnreadDividerCount((current) => current || unreadSeen);
          }
          await markConversationRead(conversationId);
          await loadFeed(true);
        }
      } catch (loadError) {
        if (isExpiredSessionError(loadError)) {
          if (!sessionExpiryHandled.current) {
            sessionExpiryHandled.current = true;
            void onSessionExpired().catch((signOutError: unknown) => {
              setMessageError(
                signOutError instanceof Error
                  ? `Your session expired, but sign-out failed: ${signOutError.message}`
                  : "Your session expired, but sign-out failed.",
              );
            });
          }
          return;
        }
        setMessageError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load this conversation.",
        );
      } finally {
        setIsLoadingMessages(false);
      }
    },
    [loadFeed, onSessionExpired, userId],
  );

  const reactToMessage = useCallback(
    async (reaction: ChatReactionValue) => {
      const target = messageMenuTarget;
      if (!target || !activeConversation) return;
      try {
        await setConversationMessageReaction(target.id, reaction);
        setMessages(await getConversationMessages(activeConversation.id));
      } catch (reactionError) {
        setMessageError(
          reactionError instanceof Error
            ? reactionError.message
            : "Could not save your reaction.",
        );
      } finally {
        setMessageMenuTarget(null);
      }
    },
    [activeConversation, messageMenuTarget],
  );

  const deleteMessageForMe = useCallback(async () => {
    const target = messageMenuTarget;
    if (!target) return;
    try {
      await hideConversationMessage(target.id);
      setMessages((current) =>
        current.filter((message) => message.id !== target.id),
      );
      setNotice("Message deleted for you.");
      if (activeConversation) void loadFeed(true);
    } catch (deleteError) {
      setMessageError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete the message for you.",
      );
    } finally {
      setMessageMenuTarget(null);
    }
  }, [activeConversation, loadFeed, messageMenuTarget]);

  const deleteMessageForEveryone = useCallback(async () => {
    const target = messageMenuTarget;
    const conversation = activeConversation;
    if (!target || !conversation || target.senderId !== userId) return;
    setMessageError("");
    try {
      await deleteConversationMessageForEveryone(target.id);
      setNotice("You deleted this message.");
    } catch (deleteError) {
      setMessageError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete this message for everyone.",
      );
    } finally {
      setMessageMenuTarget(null);
      void loadMessages(conversation.id, false);
      void loadFeed(true);
    }
  }, [activeConversation, loadFeed, loadMessages, messageMenuTarget, userId]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed, userId]);

  useEffect(() => {
    void clearViewOnceLocalCache().catch((cacheError: unknown) => {
      setNotice(
        cacheError instanceof Error
          ? `Could not clear previous protected media: ${cacheError.message}`
          : "Could not clear previous protected media.",
      );
    });
  }, []);

  const startMatchCall = useCallback(
    async (sessionId: string) => {
      if (
        videoCallAttempted.current === sessionId ||
        videoCallRequestInFlight.current
      )
        return;
      videoCallRequestInFlight.current = true;
      videoCallAttempted.current = sessionId;
      setIsVideoCallBusy(true);
      setVideoCallError("");
      try {
        await initializeLiveKit();
        setVideoCallToken(await getVideoCallToken(sessionId));
        onCallActive(true);
      } catch (cause) {
        videoCallAttempted.current = null;
        setVideoCallError(
          cause instanceof Error
            ? cause.message
            : "Could not join this video call.",
        );
      } finally {
        videoCallRequestInFlight.current = false;
        setIsVideoCallBusy(false);
      }
    },
    [onCallActive],
  );

  useEffect(() => {
    if (!videoCallToken || !NATIVE_VIDEO_CALLS) {
      setCallRoom(null);
      return;
    }
    let active = true;
    import("../video/VideoCallRoom")
      .then((module) => {
        if (active) setCallRoom(() => module.VideoCallRoom);
      })
      .catch((cause: unknown) => {
        if (active) {
          setVideoCallError(
            cause instanceof Error
              ? cause.message
              : "Could not load the native video call.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [videoCallToken]);

  useEffect(() => {
    if (!NATIVE_VIDEO_CALLS) return;
    let active = true;
    const poll = async () => {
      if (videoCallPollInFlight.current) return;
      videoCallPollInFlight.current = true;
      try {
        const next = await getVideoDiscoveryStatus();
        if (!active) return;
        if (
          next.source !== "match" ||
          !next.sessionId ||
          !["pending_acceptance", "accepted", "connected"].includes(next.state)
        ) {
          setVideoCallStatus(null);
          setVideoCallToken(null);
          setCallRoom(null);
          videoCallAttempted.current = null;
          onCallActive(false);
          return;
        }
        setVideoCallStatus(next);
        const otherUserId = next.otherParticipant?.userId;
        const conversation = feed?.conversations.find(
          (item) => item.person.id === otherUserId,
        );
        if (conversation) {
          setActiveConversation((current) =>
            current?.id === conversation.id
              ? current
              : {
                  id: conversation.id,
                  matchId: conversation.matchId,
                  person: conversation.person,
                },
          );
        }
        if (next.state === "accepted" && !videoCallToken && !CallRoom) {
          void startMatchCall(next.sessionId);
        }
      } catch (cause) {
        if (active) {
          setVideoCallError(
            cause instanceof Error
              ? cause.message
              : "Could not check for video call invitations.",
          );
        }
      } finally {
        videoCallPollInFlight.current = false;
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 3_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [
    CallRoom,
    feed?.conversations,
    onCallActive,
    startMatchCall,
    videoCallToken,
  ]);

  const requestMatchCall = async () => {
    if (!activeConversation || isVideoCallBusy) return;
    if (!NATIVE_VIDEO_CALLS) {
      setMessageError(
        "Video calls require the VEYRA Android or iOS app build.",
      );
      return;
    }
    setIsVideoCallBusy(true);
    setVideoCallError("");
    setMessageError("");
    try {
      const invitation = await requestVideoCallWithMatch(
        activeConversation.matchId,
      );
      setVideoCallStatus(invitation);
    } catch (cause) {
      setVideoCallError(
        cause instanceof Error
          ? cause.message
          : "Could not request a video call.",
      );
    } finally {
      setIsVideoCallBusy(false);
    }
  };

  const respondToMatchCall = async (accept: boolean) => {
    const sessionId = videoCallStatus?.sessionId;
    if (!sessionId || isVideoCallBusy) return;
    setIsVideoCallBusy(true);
    setVideoCallError("");
    try {
      const next = await respondToVideoDiscovery(sessionId, accept);
      if (accept) {
        setVideoCallStatus(next);
        if (next.state === "accepted") void startMatchCall(sessionId);
      } else {
        setVideoCallStatus(null);
      }
    } catch (cause) {
      setVideoCallError(
        cause instanceof Error
          ? cause.message
          : "Could not respond to the video call request.",
      );
    } finally {
      setIsVideoCallBusy(false);
    }
  };

  const endMatchCall = async () => {
    const sessionId = videoCallStatus?.sessionId ?? videoCallToken?.sessionId;
    if (!sessionId || isVideoCallBusy) return;
    setIsVideoCallBusy(true);
    setVideoCallError("");
    try {
      await endVideoDiscoveryCall(sessionId);
      setVideoCallToken(null);
      setCallRoom(null);
      setVideoCallStatus(null);
      videoCallAttempted.current = null;
      onCallActive(false);
    } catch (cause) {
      setVideoCallError(
        cause instanceof Error
          ? cause.message
          : "Could not end the video call.",
      );
    } finally {
      setIsVideoCallBusy(false);
    }
  };

  useEffect(() => () => onCallActive(false), [onCallActive]);

  const videoCallModal = (
    <Modal
      visible={
        videoCallStatus?.source === "match" &&
        Boolean(videoCallStatus.sessionId)
      }
      transparent={false}
      animationType="slide"
      onRequestClose={() => {
        if (videoCallStatus?.myAccepted !== true) {
          void respondToMatchCall(false);
        }
      }}
    >
      <View
        style={[styles.videoCallModal, { backgroundColor: colors.background }]}
      >
        {videoCallToken &&
        CallRoom &&
        videoCallStatus?.sessionId === videoCallToken.sessionId ? (
          <CallRoom
            token={videoCallToken}
            colors={colors}
            otherName={videoCallStatus.otherParticipant?.name ?? "Your match"}
            onEnd={() => void endMatchCall()}
            onConnected={() => {
              setVideoCallStatus((current) =>
                current ? { ...current, state: "connected" } : current,
              );
            }}
            onError={(cause) => setVideoCallError(cause.message)}
          />
        ) : (
          <View style={styles.videoCallPrompt}>
            <View style={styles.videoCallIcon}>
              <Video color={CHAT_ACCENT} size={26} />
            </View>
            <Text style={styles.videoCallTitle}>
              Video call with{" "}
              {videoCallStatus?.otherParticipant?.name ?? "your match"}
            </Text>
            <Text style={styles.videoCallCopy}>
              {videoCallStatus?.state === "accepted"
                ? "Connecting you now…"
                : videoCallStatus?.myAccepted
                  ? "Your request is sent. Waiting for your match to respond."
                  : "Your match would like to start a video call. You can accept or decline."}
            </Text>
            {isVideoCallBusy ? (
              <VeyraLoader
                label="Video call busy…"
                imageWidth={48}
                imageHeight={48}
                imageMarginBottom={10}
              />
            ) : null}
            {videoCallError ? (
              <Text style={styles.videoCallError}>{videoCallError}</Text>
            ) : null}
            {videoCallError && videoCallStatus?.state === "accepted" ? (
              <Pressable
                accessibilityRole="button"
                disabled={isVideoCallBusy}
                onPress={() => {
                  if (videoCallStatus.sessionId) {
                    videoCallAttempted.current = null;
                    void startMatchCall(videoCallStatus.sessionId);
                  }
                }}
                style={[
                  styles.videoCallSecondaryAction,
                  { borderColor: colors.border },
                ]}
              >
                <Text
                  style={[
                    styles.videoCallSecondaryText,
                    { color: colors.text },
                  ]}
                >
                  Retry connection
                </Text>
              </Pressable>
            ) : null}
            {videoCallStatus?.state === "accepted" ? (
              <Pressable
                accessibilityRole="button"
                disabled={isVideoCallBusy}
                onPress={() => void endMatchCall()}
                style={[
                  styles.videoCallSecondaryAction,
                  { borderColor: colors.border },
                ]}
              >
                <Text
                  style={[
                    styles.videoCallSecondaryText,
                    { color: colors.text },
                  ]}
                >
                  End call
                </Text>
              </Pressable>
            ) : null}
            {videoCallStatus?.state === "pending_acceptance" &&
            videoCallStatus.myAccepted !== true ? (
              <View style={styles.videoCallActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={isVideoCallBusy}
                  onPress={() => void respondToMatchCall(false)}
                  style={[
                    styles.videoCallSecondaryAction,
                    { borderColor: colors.border },
                  ]}
                >
                  <Text
                    style={[
                      styles.videoCallSecondaryText,
                      { color: colors.text },
                    ]}
                  >
                    Decline
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isVideoCallBusy}
                  onPress={() => void respondToMatchCall(true)}
                  style={[
                    styles.videoCallPrimaryAction,
                    { backgroundColor: CHAT_ACCENT },
                  ]}
                >
                  <Text
                    style={[styles.videoCallPrimaryText, { color: "#331B1D" }]}
                  >
                    Accept call
                  </Text>
                </Pressable>
              </View>
            ) : videoCallStatus?.state === "pending_acceptance" ? (
              <Pressable
                accessibilityRole="button"
                disabled={isVideoCallBusy}
                onPress={() => void endMatchCall()}
                style={[
                  styles.videoCallSecondaryAction,
                  { borderColor: colors.border },
                ]}
              >
                <Text
                  style={[
                    styles.videoCallSecondaryText,
                    { color: colors.text },
                  ]}
                >
                  Cancel request
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </Modal>
  );

  useEffect(() => {
    if (activeConversation || !conversationIdsKey) return;
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToConversationList(
      conversationIdsKey.split(","),
      () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          if (active) void loadFeed(true);
        }, 150);
      },
    );

    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [activeConversation, conversationIdsKey, loadFeed]);

  useEffect(() => {
    if (!activeConversation) return;
    setIsLoadingMessages(true);
    void loadMessages(activeConversation.id, true);
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToConversation(activeConversation.id, () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void loadMessages(activeConversation.id, true);
      }, 100);
    });
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [activeConversation, loadMessages]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const filteredConversations = useMemo(() => {
    if (!feed) return [];
    const query = search.trim().toLocaleLowerCase();
    return feed.conversations.filter((conversation) => {
      const archived = conversation.archivedAt !== null;
      if (filter === "archived" && !archived) return false;
      if (filter !== "archived" && archived) return false;
      if (filter === "unread" && conversation.unreadCount === 0) return false;
      if (filter === "new") return false;
      if (!query) return true;
      return (
        conversation.person.name.toLocaleLowerCase().includes(query) ||
        conversation.lastMessage?.body.toLocaleLowerCase().includes(query)
      );
    });
  }, [feed, filter, search]);

  const filteredNewMatches = useMemo(() => {
    if (!feed || filter !== "new") return [];
    const query = search.trim().toLocaleLowerCase();
    return feed.newMatches.filter(
      (match) =>
        !feed.conversations.some(
          (conversation) =>
            conversation.matchId === match.matchId &&
            conversation.archivedAt !== null,
        ) &&
        (!query || match.person.name.toLocaleLowerCase().includes(query)),
    );
  }, [feed, filter, search]);

  const onlinePeople = useMemo(() => {
    if (!feed) return [];
    const people = new Map<string, ActiveConversation>();
    const conversationMatchIds = new Set(
      feed.conversations.map((conversation) => conversation.matchId),
    );
    for (const conversation of feed.conversations) {
      if (
        conversation.archivedAt === null &&
        onlineUserIds.has(conversation.person.id)
      ) {
        people.set(conversation.person.id, {
          id: conversation.id,
          matchId: conversation.matchId,
          person: conversation.person,
        });
      }
    }
    for (const match of feed.newMatches) {
      if (
        !conversationMatchIds.has(match.matchId) &&
        onlineUserIds.has(match.person.id)
      ) {
        people.set(match.person.id, {
          id: match.conversationId,
          matchId: match.matchId,
          person: match.person,
        });
      }
    }
    return Array.from(people.values());
  }, [feed, onlineUserIds]);

  const openConversation = useCallback(
    (conversation: ActiveConversation) => {
      unreadCountOnOpen.current =
        feed?.conversations.find((item) => item.id === conversation.id)
          ?.unreadCount ?? 0;
      setNotice("");
      setMessageError("");
      setMessages([]);
      setUnreadDividerMessageId(null);
      setUnreadDividerCount(0);
      setDraft("");
      setMediaDrafts([]);
      setUploadProgress("");
      setUploadProgressPercent(null);
      setMediaSendFailed(false);
      setIsLoadingMessages(true);
      setActiveConversation(conversation);
    },
    [feed],
  );

  const openExistingConversation = useCallback(
    (conversation: ChatConversation) => {
      openConversation({
        id: conversation.id,
        matchId: conversation.matchId,
        person: conversation.person,
        locked: conversation.lockedAt !== null,
      });
    },
    [openConversation],
  );

  const archiveConversation = useCallback(
    async (conversation: ChatConversation, archived: boolean) => {
      if (isArchivingConversation) return;
      setIsArchivingConversation(true);
      setError("");
      setNotice("");
      try {
        await setConversationArchived(conversation.id, archived);
        const archivedAt = archived ? new Date().toISOString() : null;
        setFeed((current) =>
          current
            ? {
                ...current,
                conversations: current.conversations.map((item) =>
                  item.id === conversation.id ? { ...item, archivedAt } : item,
                ),
              }
            : current,
        );
        setNotice(
          archived
            ? `${conversation.person.name}’s conversation was archived.`
            : `${conversation.person.name}’s conversation was restored.`,
        );
        void loadFeed(true);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not update this conversation.",
        );
      } finally {
        setIsArchivingConversation(false);
      }
    },
    [isArchivingConversation, loadFeed],
  );

  const openLockedChatsPinEntry = async (enteredPin?: string) => {
    setPinError("");
    setSearch("");
    setMessageView("search");
    try {
      const configured = await getChatLockPinConfigured();
      if (!configured) {
        setPinModalError("");
        setPinSetupVisible(true);
        return;
      }
      if (enteredPin) {
        setPinValue(enteredPin);
        setPinEntryMode(true);
        await submitLockedChatsPin(enteredPin);
        return;
      }
      setPinValue("");
      setPinEntryMode(true);
    } catch (cause) {
      setPinError(
        cause instanceof Error
          ? cause.message
          : "Could not check Lock Chats setup.",
      );
    }
  };

  const submitLockedChatsPin = async (submittedPin = pinValue) => {
    if (submittedPin.length !== 6) {
      setPinError("Enter your six-digit Lock Chats PIN.");
      return;
    }
    setPinError("");
    setIsPinBusy(true);
    try {
      const conversations = await getLockedChatFeed(submittedPin);
      grantLockedChatView();
      setLockedConversations(conversations);
      setMessageView("locked");
      setPinEntryMode(false);
      setPinValue("");
    } catch (cause) {
      setPinError(
        cause instanceof Error ? cause.message : "Could not open Locked Chats.",
      );
    } finally {
      setIsPinBusy(false);
    }
  };

  const saveInitialLockPin = async (pin: string) => {
    setPinModalError("");
    setIsPinBusy(true);
    let pinSaved = false;
    try {
      await setChatLockPin(pin);
      pinSaved = true;
      setPinSetupVisible(false);
      setPinValue("");
      setPinEntryMode(false);
      if (pendingLockConversation) {
        await setConversationLocked(pendingLockConversation.id, true);
        setPendingLockConversation(null);
        setActiveConversation(null);
        setNotice(
          `${pendingLockConversation.person.name}’s conversation was locked.`,
        );
        void loadFeed(true);
      } else {
        const conversations = await getLockedChatFeed(pin);
        grantLockedChatView();
        setLockedConversations(conversations);
        setMessageView("locked");
      }
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Could not set your PIN.";
      if (pinSaved && pendingLockConversation) {
        setPinSetupVisible(false);
        setPendingLockConversation(null);
        setMessageError(message);
      } else if (pinSaved) {
        setPinSetupVisible(false);
        setPinEntryMode(true);
        setPinError(message);
      } else {
        setPinModalError(message);
      }
    } finally {
      setIsPinBusy(false);
    }
  };

  const resetLockPin = async (password: string, pin: string) => {
    setPinModalError("");
    setIsPinBusy(true);
    try {
      await resetChatLockPin(pin, password);
      setPinResetVisible(false);
      setPinValue("");
      setPinEntryMode(true);
      setPinError("Your PIN was reset. Enter your new PIN to continue.");
    } catch (cause) {
      setPinModalError(
        cause instanceof Error
          ? cause.message
          : "Could not reset your Lock Chats PIN.",
      );
    } finally {
      setIsPinBusy(false);
    }
  };

  const toggleActiveConversationLock = async () => {
    const conversation = activeConversation;
    if (!conversation) return;
    setSafetyAction(null);
    setMessageError("");
    if (conversation.locked) {
      try {
        await setConversationLocked(conversation.id, false);
        setActiveConversation({ ...conversation, locked: false });
        setLockedConversations(
          (current) =>
            current?.filter((item) => item.id !== conversation.id) ?? null,
        );
        setNotice(`${conversation.person.name}’s conversation was unlocked.`);
        void loadFeed(true);
      } catch (cause) {
        setMessageError(
          cause instanceof Error
            ? cause.message
            : "Could not unlock this conversation.",
        );
      }
      return;
    }

    try {
      if (!(await getChatLockPinConfigured())) {
        setPendingLockConversation(conversation);
        setPinModalError("");
        setPinSetupVisible(true);
        return;
      }
      await setConversationLocked(conversation.id, true);
      setActiveConversation(null);
      if (messageView === "locked") revokeLockedChatView();
      setNotice(`${conversation.person.name}’s conversation was locked.`);
      void loadFeed(true);
    } catch (cause) {
      setMessageError(
        cause instanceof Error
          ? cause.message
          : "Could not lock this conversation.",
      );
    }
  };

  const unlockConversationFromLockedList = async (
    conversation: ChatConversation,
  ) => {
    try {
      await setConversationLocked(conversation.id, false);
      setLockedConversations(
        (current) =>
          current?.filter((item) => item.id !== conversation.id) ?? null,
      );
      setNotice(`${conversation.person.name}’s conversation was unlocked.`);
      void loadFeed(true);
    } catch (cause) {
      setPinError(
        cause instanceof Error
          ? cause.message
          : "Could not unlock this conversation.",
      );
    }
  };

  useEffect(() => {
    if (!initialPersonId || !feed) return;
    const conversation = feed.conversations.find(
      (item) => item.person.id === initialPersonId,
    );
    if (conversation) {
      openExistingConversation(conversation);
      onInitialConversationOpened();
      return;
    }
    const newMatch = feed.newMatches.find(
      (item) => item.person.id === initialPersonId,
    );
    if (newMatch) {
      openConversation({
        id: newMatch.conversationId,
        matchId: newMatch.matchId,
        person: newMatch.person,
      });
      onInitialConversationOpened();
    }
  }, [
    feed,
    initialPersonId,
    onInitialConversationOpened,
    openConversation,
    openExistingConversation,
  ]);

  const sendMessage = useCallback(async () => {
    const conversation = activeConversation;
    const text = draft.trim();
    if (!conversation || (!text && mediaDrafts.length === 0) || isSending)
      return;
    const replyText = replyTarget
      ? replyTarget.body.replace(/\s+/g, " ").trim().slice(0, 160)
      : null;
    if (mediaDrafts.length > 0) {
      setMessageError("");
      setUploadProgress("");
      setUploadProgressPercent(0);
      setMediaSendFailed(false);
      setIsSending(true);
      try {
        const saved = await sendConversationDraft(
          conversation.id,
          userId,
          text,
          replyText,
          mediaDrafts,
          (completed, total) => {
            setUploadProgressPercent(
              total > 0
                ? Math.min(100, Math.round((completed / total) * 100))
                : 0,
            );
            setUploadProgress(
              completed >= total
                ? "Finishing message…"
                : `Uploading ${completed + 1} of ${total} attachments…`,
            );
          },
        );
        setMessages((current) => [...current, saved]);
        setDraft("");
        setMediaDrafts([]);
        setMediaSendFailed(false);
        setReplyTarget(null);
        void loadMessages(conversation.id, false);
        void loadFeed(true);
      } catch (sendError) {
        setMediaSendFailed(true);
        setMessageError(
          sendError instanceof Error
            ? sendError.message
            : "Could not send this message.",
        );
      } finally {
        setIsSending(false);
        setUploadProgress("");
        setUploadProgressPercent(null);
      }
      return;
    }
    const replyQuote = replyTarget
      ? `${REPLY_MESSAGE_MARKER}${replyTarget.body.replace(/\s+/g, " ").trim().slice(0, 160)}\n\n`
      : "";
    const body = `${replyQuote}${text}`;
    if (body.length > 2000) {
      setMessageError(
        `This reply is too long. Keep it under ${2000 - replyQuote.length} characters.`,
      );
      return;
    }
    setDraft("");
    setMessageError("");
    setIsSending(true);
    const temporaryId = `local-${Date.now()}`;
    const optimisticMessage: ChatMessage = {
      id: temporaryId,
      senderId: userId,
      body: text,
      replyQuote: replyTarget
        ? replyTarget.body.replace(/\s+/g, " ").trim().slice(0, 160)
        : null,
      reactions: [],
      attachment: null,
      attachments: [],
      deletedForEveryone: false,
      viewOnce: false,
      viewOnceOpenedAt: null,
      viewOnceExpiresAt: null,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    setMessages((current) => [...current, optimisticMessage]);
    try {
      const saved = await sendConversationMessage(conversation.id, body);
      setMessages((current) =>
        current.map((message) =>
          message.id === temporaryId ? saved : message,
        ),
      );
      setReplyTarget(null);
      void loadFeed(true);
    } catch (sendError) {
      setMessages((current) =>
        current.filter((message) => message.id !== temporaryId),
      );
      setDraft(text);
      setMessageError(
        sendError instanceof Error
          ? sendError.message
          : "Could not send this message.",
      );
    } finally {
      setIsSending(false);
    }
  }, [
    activeConversation,
    draft,
    isSending,
    loadFeed,
    loadMessages,
    mediaDrafts,
    replyTarget,
    userId,
  ]);

  const openViewOnce = useCallback(
    async (
      message: ChatMessage,
      attachment: NonNullable<ChatMessage["attachment"]>,
    ) => {
      const attachmentIndex = attachment.attachmentIndex ?? 0;
      const attachmentKey = `${message.id}:${attachmentIndex}`;
      if (
        !attachment.viewOnce ||
        message.senderId === userId ||
        attachment.openedAt ||
        openingViewOnceRef.current
      ) {
        return;
      }

      const captureKey = `view-once-${attachmentKey}`;
      openingViewOnceRef.current = true;
      setOpeningViewOnceId(attachmentKey);
      setPreviewGallery([]);
      setPreviewGalleryIndex(0);
      setMessageError("");
      let localUri: string | null = null;
      try {
        if (NATIVE_SCREEN_PROTECTION) {
          await preventScreenCaptureAsync(captureKey);
          if (Platform.OS === "ios") {
            await enableAppSwitcherProtectionAsync(0.9);
          }
        }
        localUri = await downloadViewOnceMedia(
          message.id,
          attachment.kind,
          attachmentIndex,
        );
        if (AppState.currentState !== "active") {
          throw new Error(
            "The attachment was consumed while the app was inactive. It cannot be reopened.",
          );
        }
        setPreviewAttachment({
          ...attachment,
          path: "",
          kind: attachment.kind,
          url: localUri,
          localUri,
          viewOnce: true,
          messageId: message.id,
          attachmentIndex,
        });
        if (activeConversation) {
          void loadMessages(activeConversation.id, false);
        }
      } catch (openError) {
        let temporaryCleanupError = "";
        if (localUri) {
          try {
            await deleteLocalViewOnceFile(localUri);
          } catch (cleanupError) {
            temporaryCleanupError =
              cleanupError instanceof Error
                ? ` Temporary file cleanup failed: ${cleanupError.message}`
                : " Temporary file cleanup failed.";
          }
        }
        let protectionCleanupError = "";
        if (NATIVE_SCREEN_PROTECTION) {
          try {
            await allowScreenCaptureAsync(captureKey);
          } catch (cleanupError) {
            protectionCleanupError =
              cleanupError instanceof Error
                ? cleanupError.message
                : "Could not restore screenshot settings.";
          }
          if (Platform.OS === "ios") {
            try {
              await disableAppSwitcherProtectionAsync();
            } catch (cleanupError) {
              protectionCleanupError ||=
                cleanupError instanceof Error
                  ? cleanupError.message
                  : "Could not restore app-switcher privacy.";
            }
          }
        }
        const errorMessage = [
          openError instanceof Error
            ? openError.message
            : "Could not open this View Once attachment.",
          temporaryCleanupError,
          protectionCleanupError,
        ]
          .filter(Boolean)
          .join(" ");
        if (activeConversation) {
          void loadMessages(activeConversation.id, false).then(() => {
            setMessageError(errorMessage);
          });
        } else {
          setMessageError(errorMessage);
        }
      } finally {
        openingViewOnceRef.current = false;
        setOpeningViewOnceId(null);
      }
    },
    [activeConversation, loadMessages, userId],
  );

  const closeViewOncePreview = useCallback(async () => {
    const preview = previewAttachment;
    setPreviewAttachment(null);
    if (!preview?.viewOnce || !preview.localUri || !preview.messageId) return;
    try {
      await deleteLocalViewOnceFile(preview.localUri);
    } catch (fileError) {
      setMessageError(
        fileError instanceof Error
          ? `Could not clear the temporary protected media: ${fileError.message}`
          : "Could not clear the temporary protected media.",
      );
    }
    const captureKey = `view-once-${preview.messageId}:${preview.attachmentIndex ?? 0}`;
    if (NATIVE_SCREEN_PROTECTION) {
      void allowScreenCaptureAsync(captureKey).catch(
        (captureError: unknown) => {
          setMessageError(
            captureError instanceof Error
              ? `Could not restore screen-capture settings: ${captureError.message}`
              : "Could not restore screen-capture settings.",
          );
        },
      );
      if (Platform.OS === "ios") {
        void disableAppSwitcherProtectionAsync().catch(
          (captureError: unknown) => {
            setMessageError(
              captureError instanceof Error
                ? `Could not restore app-switcher privacy: ${captureError.message}`
                : "Could not restore app-switcher privacy.",
            );
          },
        );
      }
    }
    if (activeConversation) {
      void loadMessages(activeConversation.id, false);
    }
  }, [activeConversation, loadMessages, previewAttachment]);

  const sendPendingViewOnce = useCallback(async () => {
    const conversation = activeConversation;
    const pending = pendingViewOnce;
    if (!conversation || !pending || isSending) return;
    setIsSending(true);
    setMessageError("");
    try {
      const saved = await sendConversationAttachment(
        conversation.id,
        userId,
        pending.uri,
        pending.kind,
        pending.mimeType,
        true,
      );
      setMessages((current) => [...current, saved]);
      if (pending.deleteAfterSend) {
        try {
          deleteLocalChatFile(pending.uri);
        } catch (fileError) {
          setNotice(
            fileError instanceof Error
              ? `View Once sent, but the local recording could not be removed: ${fileError.message}`
              : "View Once sent, but the local recording could not be removed.",
          );
        }
      }
      setPendingViewOnce(null);
      if (!pending.deleteAfterSend) {
        setNotice(
          "View Once attachment sent. It will expire if it is not opened.",
        );
      }
      void loadFeed(true);
    } catch (sendError) {
      setMessageError(
        sendError instanceof Error
          ? sendError.message
          : "Could not send this View Once attachment.",
      );
    } finally {
      setIsSending(false);
    }
  }, [activeConversation, isSending, loadFeed, pendingViewOnce, userId]);

  const cancelPendingViewOnce = useCallback(() => {
    const pending = pendingViewOnce;
    if (pending?.deleteAfterSend) {
      try {
        deleteLocalChatFile(pending.uri);
      } catch (fileError) {
        setMessageError(
          fileError instanceof Error
            ? `Could not remove the temporary voice recording: ${fileError.message}`
            : "Could not remove the temporary voice recording.",
        );
      }
    }
    setPendingViewOnce(null);
  }, [pendingViewOnce]);

  const pickMedia = useCallback(
    async (source: "library" | "camera" = "library") => {
      const conversation = activeConversation;
      if (!conversation || isSending) return;
      const availableSlots = 5 - mediaDrafts.length;
      if (availableSlots < 1) {
        setMessageError("A message can include up to five photos or videos.");
        return;
      }
      setIsSending(true);
      setMessageError("");
      try {
        const permission =
          source === "camera"
            ? await ImagePicker.requestCameraPermissionsAsync()
            : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setMessageError(
            source === "camera"
              ? "Allow camera access to capture a photo or video."
              : "Allow photo library access to share images and videos.",
          );
          return;
        }
        setIsAttachmentMenuVisible(false);
        const result =
          source === "camera"
            ? await ImagePicker.launchCameraAsync({
                mediaTypes: ["images", "videos"],
                quality: 0.8,
              })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images", "videos"],
                quality: 0.8,
                allowsMultipleSelection: true,
                selectionLimit: availableSlots,
              });
        if (result.canceled) return;

        const selected: MediaDraft[] = result.assets.map((asset, index) => {
          const kind: "image" | "video" =
            asset.type === "video" ||
            asset.type === "pairedVideo" ||
            asset.mimeType?.startsWith("video/")
              ? "video"
              : "image";
          return {
            id: `${Date.now()}-${index}`,
            uri: asset.uri,
            kind,
            mimeType: asset.mimeType,
            fileSize: asset.fileSize,
            caption: "",
            viewOnce: isViewOnceMode,
          };
        });
        setMediaDrafts((current) => [...current, ...selected]);
        setMediaSendFailed(false);
      } catch (pickerError) {
        setMessageError(
          pickerError instanceof Error
            ? pickerError.message
            : "Could not add these attachments.",
        );
      } finally {
        setIsSending(false);
      }
    },
    [activeConversation, isSending, isViewOnceMode, mediaDrafts.length],
  );

  const startVoiceRecording = useCallback(
    async (viewOnceOverride?: boolean) => {
      if (!activeConversation || isSending || recordingStarted.current) return;
      recordingRequested.current = true;
      recordingViewOnce.current = viewOnceOverride ?? isViewOnceMode;
      setIsRecording(true);
      setMessageError("");
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!permission.granted) {
          recordingRequested.current = false;
          setIsRecording(false);
          setMessageError("Allow microphone access to record a voice message.");
          return;
        }
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
        await recorder.prepareToRecordAsync();
        recordingConversation.current = activeConversation;
        recordingStarted.current = true;
        recorder.record({ forDuration: 60 });
        if (!recordingRequested.current) {
          await recorder.stop();
          setIsRecording(false);
        }
      } catch (recordingError) {
        recordingRequested.current = false;
        recordingStarted.current = false;
        setIsRecording(false);
        setMessageError(
          recordingError instanceof Error
            ? recordingError.message
            : "Could not start a voice recording.",
        );
      }
    },
    [activeConversation, isSending, isViewOnceMode, recorder],
  );

  const stopVoiceRecording = useCallback(async () => {
    recordingRequested.current = false;
    setIsRecording(false);
    if (!recordingStarted.current || !recorderState.isRecording) return;
    try {
      await recorder.stop();
    } catch (recordingError) {
      recordingStarted.current = false;
      setIsRecording(false);
      setMessageError(
        recordingError instanceof Error
          ? recordingError.message
          : "Could not finish the voice recording.",
      );
    }
  }, [recorder, recorderState.isRecording]);

  useEffect(() => {
    if (!recordingStarted.current || recorderState.isRecording) {
      return;
    }
    const recordingUri = recorderState.url ?? recorder.uri;
    recordingStarted.current = false;
    recordingRequested.current = false;
    setIsRecording(false);
    const conversation = recordingConversation.current;
    recordingConversation.current = null;
    void setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
    }).catch((audioModeError: unknown) => {
      setMessageError(
        audioModeError instanceof Error
          ? audioModeError.message
          : "Could not restore audio playback mode.",
      );
    });
    if (!recordingUri) {
      setMessageError("The voice recording could not be saved.");
      return;
    }
    if (!conversation) {
      try {
        deleteLocalChatFile(recordingUri);
      } catch (fileError) {
        setMessageError(
          fileError instanceof Error
            ? `Could not remove the temporary voice recording: ${fileError.message}`
            : "Could not remove the temporary voice recording.",
        );
      }
      return;
    }
    setPendingVoiceRecording({
      uri: recordingUri,
      durationMs: recorderState.durationMillis,
      viewOnce: recordingViewOnce.current,
    });
    recordingViewOnce.current = false;
  }, [
    recorder,
    recorderState.isRecording,
    recorderState.durationMillis,
    recorderState.url,
  ]);

  const sendPendingVoiceRecording = useCallback(async () => {
    const conversation = activeConversation;
    const pending = pendingVoiceRecording;
    if (!conversation || !pending || isSending) return;
    setIsSending(true);
    setMessageError("");
    try {
      const saved = await sendConversationAttachment(
        conversation.id,
        userId,
        pending.uri,
        "audio",
        "audio/mp4",
        pending.viewOnce,
      );
      setMessages((current) => [...current, saved]);
      setPendingVoiceRecording(null);
      try {
        deleteLocalChatFile(pending.uri);
      } catch (fileError) {
        setNotice(
          fileError instanceof Error
            ? `Voice message sent, but the temporary recording could not be removed: ${fileError.message}`
            : "Voice message sent, but the temporary recording could not be removed.",
        );
      }
      if (pending.viewOnce) {
        setNotice(
          "View Once voice message sent. It will expire if it is not opened.",
        );
      }
      void loadFeed(true);
    } catch (sendError) {
      setMessageError(
        sendError instanceof Error
          ? sendError.message
          : "Could not send this voice message.",
      );
    } finally {
      setIsSending(false);
    }
  }, [activeConversation, isSending, loadFeed, pendingVoiceRecording, userId]);

  const cancelPendingVoiceRecording = useCallback(() => {
    const pending = pendingVoiceRecording;
    if (pending) {
      try {
        deleteLocalChatFile(pending.uri);
      } catch (fileError) {
        setMessageError(
          fileError instanceof Error
            ? `Could not remove the temporary voice recording: ${fileError.message}`
            : "Could not remove the temporary voice recording.",
        );
      }
    }
    setPendingVoiceRecording(null);
  }, [pendingVoiceRecording]);

  const retryVoiceRecording = useCallback(async () => {
    const viewOnce = pendingVoiceRecording?.viewOnce ?? isViewOnceMode;
    cancelPendingVoiceRecording();
    setIsViewOnceMode(viewOnce);
    await startVoiceRecording(viewOnce);
  }, [
    cancelPendingVoiceRecording,
    isViewOnceMode,
    pendingVoiceRecording,
    startVoiceRecording,
  ]);

  const performSafetyAction = useCallback(async () => {
    const conversation = activeConversation;
    if (!conversation || !safetyAction || isSavingSafety) return;
    setIsSavingSafety(true);
    setMessageError("");
    try {
      if (safetyAction === "block") {
        await blockUser(userId, conversation.person.id);
        setNotice("This member is blocked. The conversation is closed.");
      } else if (safetyAction === "unmatch") {
        await unmatchConversation(conversation.id);
        setNotice("You’ve unmatched. This conversation is now closed.");
      } else if (safetyAction === "report-message") {
        if (!reportedMessageId) {
          throw new Error("Select a message to report.");
        }
        await reportChatMessage(reportedMessageId, reportReason);
        setNotice("Message reported. Our team will review it.");
        setReportedMessageId(null);
        setSafetyAction(null);
        return;
      } else {
        await reportConversationMember(conversation.id, reportReason);
        setNotice("Report received. Our team will review it.");
      }
      setSafetyAction(null);
      setReportedMessageId(null);
      setActiveConversation(null);
      await loadFeed();
    } catch (actionError) {
      setMessageError(
        actionError instanceof Error
          ? actionError.message
          : "Could not complete this safety action.",
      );
    } finally {
      setIsSavingSafety(false);
    }
  }, [
    activeConversation,
    isSavingSafety,
    loadFeed,
    reportReason,
    reportedMessageId,
    safetyAction,
    userId,
  ]);

  if (activeConversation) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.screen, { backgroundColor: colors.background }]}
      >
        <View style={styles.chatHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to messages"
            disabled={isSending || isRecording || pendingViewOnce !== null}
            onPress={() => setActiveConversation(null)}
            style={styles.headerIconButton}
          >
            <Text style={styles.headerIcon}>‹</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setProfilePerson(activeConversation.person)}
            style={styles.chatHeaderPerson}
          >
            <View style={styles.chatHeaderAvatarWrap}>
              <Avatar
                person={activeConversation.person}
                size={44}
                styles={styles}
              />
              <View
                style={[
                  styles.chatHeaderPresence,
                  isOtherOnline && styles.chatHeaderPresenceOnline,
                ]}
              />
            </View>
            <View style={styles.chatHeaderCopy}>
              <View style={styles.nameWithBadge}>
                <Text numberOfLines={1} style={styles.chatHeaderName}>
                  {activeConversation.person.name}
                </Text>
                <View
                  accessibilityLabel="Your VEYRA match"
                  accessibilityRole="image"
                >
                  <Heart color={CHAT_ACCENT} size={14} fill={CHAT_ACCENT} />
                </View>
                {activeConversation.person.identityVerified ? (
                  <IdentityVerifiedBadge colors={colors} compact />
                ) : null}
              </View>
              <View style={styles.onlineStatus}>
                <View
                  style={[
                    styles.onlineStatusDot,
                    isOtherOnline && styles.onlineStatusDotActive,
                  ]}
                />
                <Text
                  style={[
                    styles.chatHeaderSubtitle,
                    isOtherOnline && styles.onlineStatusTextActive,
                  ]}
                >
                  {isOtherOnline ? "Online" : "Offline"}
                </Text>
              </View>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Request a video call"
            accessibilityState={{
              disabled: isSending || isRecording || isVideoCallBusy,
            }}
            disabled={isSending || isRecording || isVideoCallBusy}
            onPress={() => void requestMatchCall()}
            style={styles.headerIconButton}
          >
            {isVideoCallBusy ? (
              <VeyraLoader
                label="Video call busy…"
                imageWidth={48}
                imageHeight={48}
                imageMarginBottom={10}
              />
            ) : (
              <Video color={CHAT_ACCENT} size={19} />
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Explore Chemistry with this match"
            onPress={() => onOpenChemistry(activeConversation.matchId)}
            style={styles.headerIconButton}
          >
            <Sparkles color={CHAT_ACCENT} size={19} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Conversation safety options"
            disabled={isSending || isRecording}
            onPress={() => setSafetyAction("menu")}
            style={styles.headerIconButton}
          >
            <MoreVertical color={colors.textSecondary} size={20} />
          </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.messageScroll}
          contentContainerStyle={styles.messageList}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: true })
          }
        >
          {!isLoadingMessages &&
          !isSending &&
          !isRecording &&
          messages.length === 0 ? (
            <View style={styles.connectionIntro}>
              <Avatar
                person={activeConversation.person}
                size={68}
                styles={styles}
              />
              <Text style={styles.connectionIntroTitle}>
                Something meaningful could start here.
              </Text>
              <Text style={styles.connectionIntroCopy}>
                You and {activeConversation.person.name} liked each other. Start
                with a kind, curious question.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setProfilePerson(activeConversation.person)}
                style={styles.profileLink}
              >
                <Text style={styles.profileLinkText}>View profile</Text>
              </Pressable>
              <View style={styles.starterPrompts}>
                <Text style={styles.starterPromptsTitle}>
                  Not sure what to say?
                </Text>
                {STARTER_PROMPTS.map((prompt) => (
                  <Pressable
                    key={prompt}
                    accessibilityRole="button"
                    onPress={() => {
                      setDraft(prompt);
                      setTimeout(() => composerInputRef.current?.focus(), 100);
                    }}
                    style={styles.starterPrompt}
                  >
                    <Text style={styles.starterPromptText}>{prompt}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => onOpenChemistry(activeConversation.matchId)}
                style={styles.connectionChemistryButton}
              >
                <Sparkles color={CHAT_ACCENT} size={15} />
                <Text style={styles.connectionChemistryText}>
                  Explore Chemistry together
                </Text>
              </Pressable>
            </View>
          ) : null}
          {isLoadingMessages ? (
            <>
              <VeyraLoader
                label="Loading messages…"
                imageWidth={48}
                imageHeight={48}
                imageMarginBottom={10}
              />
            </>
          ) : null}
          {messages.map((message, index) => {
            const isMine = message.senderId === userId;
            const previousMessage = messages[index - 1];
            const nextMessage = messages[index + 1];
            const showDate =
              !previousMessage ||
              getMessageDateKey(previousMessage.createdAt) !==
                getMessageDateKey(message.createdAt);
            const isLastInGroup =
              !nextMessage ||
              nextMessage.senderId !== message.senderId ||
              getMessageDateKey(nextMessage.createdAt) !==
                getMessageDateKey(message.createdAt);
            const isFirstInGroup =
              !previousMessage ||
              previousMessage.senderId !== message.senderId ||
              getMessageDateKey(previousMessage.createdAt) !==
                getMessageDateKey(message.createdAt);
            const reply = message.replyQuote
              ? { quote: message.replyQuote, text: message.body }
              : null;
            return (
              <View key={message.id}>
                {showDate ? (
                  <View style={styles.dateSeparator}>
                    <View style={styles.dateSeparatorLine} />
                    <Text style={styles.dateSeparatorText}>
                      {formatMessageDate(message.createdAt)}
                    </Text>
                    <View style={styles.dateSeparatorLine} />
                  </View>
                ) : null}
                {message.id === unreadDividerMessageId ? (
                  <View accessibilityRole="text" style={styles.unreadDivider}>
                    <View style={styles.unreadDividerLine} />
                    <Text style={styles.unreadDividerText}>
                      {unreadDividerCount > 1
                        ? `${unreadDividerCount} UNREAD MESSAGES`
                        : "UNREAD MESSAGES"}
                    </Text>
                    <View style={styles.unreadDividerLine} />
                  </View>
                ) : null}
                <View
                  style={[
                    styles.messageRow,
                    isMine ? styles.messageRowMine : styles.messageRowTheirs,
                    { marginTop: isFirstInGroup ? 8 : 2 },
                    { marginBottom: isLastInGroup ? 7 : 1 },
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      message.deletedForEveryone
                        ? "Deleted message"
                        : isMine
                          ? "Your message"
                          : `Message from ${activeConversation.person.name}`
                    }
                    accessibilityHint={
                      message.deletedForEveryone
                        ? undefined
                        : message.attachment?.kind === "audio"
                          ? "Long press or tap voice message options"
                          : "Long press to open message actions"
                    }
                    disabled={message.deletedForEveryone}
                    onLongPress={() => {
                      if (!message.deletedForEveryone) {
                        setMessageMenuTarget(message);
                      }
                    }}
                    delayLongPress={350}
                    style={[
                      styles.messageBubble,
                      isMine
                        ? styles.messageBubbleMine
                        : styles.messageBubbleTheirs,
                      !isFirstInGroup &&
                        (isMine
                          ? styles.messageBubbleGroupedTopMine
                          : styles.messageBubbleGroupedTopTheirs),
                      !isLastInGroup &&
                        (isMine
                          ? styles.messageBubbleGroupedBottomMine
                          : styles.messageBubbleGroupedBottomTheirs),
                      message.deletedForEveryone && styles.messageBubbleDeleted,
                    ]}
                  >
                    {message.deletedForEveryone ? (
                      <Text style={styles.deletedMessageNotice}>
                        You deleted this message.
                      </Text>
                    ) : (
                      <>
                        {reply ? (
                          <View style={styles.replyQuote}>
                            <Text
                              numberOfLines={2}
                              style={[
                                styles.replyQuoteText,
                                isMine && styles.messageBodyMine,
                              ]}
                            >
                              {reply.quote}
                            </Text>
                          </View>
                        ) : null}
                        {message.attachments.length > 1 ? (
                          <GroupedAttachmentView
                            messageId={message.id}
                            attachments={message.attachments}
                            isMine={isMine}
                            openingAttachmentKey={openingViewOnceId}
                            colors={colors}
                            styles={styles}
                            onPreview={(attachment, attachmentIndex) => {
                              const gallery = message.attachments
                                .filter(
                                  (item) =>
                                    !item.viewOnce &&
                                    (item.kind === "image" ||
                                      item.kind === "video"),
                                )
                                .map((item) => ({
                                  ...item,
                                  kind: item.kind as "image" | "video",
                                }));
                              const selectedIndex = gallery.findIndex(
                                (item) =>
                                  item.path === attachment.path &&
                                  item.kind === attachment.kind,
                              );
                              setPreviewGallery(gallery);
                              setPreviewGalleryIndex(
                                selectedIndex >= 0
                                  ? selectedIndex
                                  : attachmentIndex,
                              );
                              setPreviewAttachment(attachment);
                            }}
                            onOpenViewOnce={(attachment) =>
                              void openViewOnce(message, attachment)
                            }
                          />
                        ) : message.attachment?.viewOnce ? (
                          <View>
                            <ViewOnceAttachment
                              attachment={message.attachment}
                              isMine={isMine}
                              opening={
                                openingViewOnceId ===
                                `${message.id}:${message.attachment.attachmentIndex ?? 0}`
                              }
                              colors={colors}
                              styles={styles}
                              onOpen={() => {
                                const attachment = message.attachment;
                                if (attachment)
                                  void openViewOnce(message, attachment);
                              }}
                            />
                            {message.attachment.caption ? (
                              <Text
                                style={[
                                  styles.groupedMediaCaption,
                                  { color: colors.textSecondary },
                                ]}
                              >
                                {message.attachment.caption}
                              </Text>
                            ) : null}
                          </View>
                        ) : message.attachment ? (
                          <View>
                            <AttachmentView
                              attachment={message.attachment}
                              isMine={isMine}
                              colors={colors}
                              styles={styles}
                              onPreview={setPreviewAttachment}
                              onOpenMessageActions={() =>
                                setMessageMenuTarget(message)
                              }
                            />
                            {message.attachment.caption ? (
                              <Text
                                style={[
                                  styles.groupedMediaCaption,
                                  { color: colors.textSecondary },
                                ]}
                              >
                                {message.attachment.caption}
                              </Text>
                            ) : null}
                          </View>
                        ) : null}
                        {message.body &&
                        (message.attachments.length === 0 ||
                          message.hasCaption) ? (
                          <Text
                            style={[
                              styles.messageBody,
                              isMine && styles.messageBodyMine,
                            ]}
                          >
                            {reply?.text ?? message.body}
                          </Text>
                        ) : null}
                        {message.reactions.length > 0 ? (
                          <View style={styles.messageReactionRow}>
                            {message.reactions.map((reaction) => {
                              const reactionOption = MESSAGE_REACTIONS.find(
                                (option) => option.value === reaction.value,
                              );
                              if (!reactionOption) return null;
                              return (
                                <View
                                  key={reaction.value}
                                  accessibilityLabel={`${reactionOption.label}, ${reaction.count}${reaction.reactedByMe ? ", your reaction" : ""}`}
                                  style={[
                                    styles.messageReaction,
                                    reaction.reactedByMe &&
                                      styles.messageReactionSelected,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.messageReactionText,
                                      reaction.reactedByMe &&
                                        styles.messageReactionTextSelected,
                                    ]}
                                  >
                                    {reactionOption.emoji} {reaction.count}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        ) : null}
                      </>
                    )}
                    {isLastInGroup ? (
                      <View style={styles.messageMeta}>
                        <Text
                          style={[
                            styles.messageTime,
                            isMine && styles.messageTimeMine,
                          ]}
                        >
                          {formatMessageTime(message.createdAt)}
                        </Text>
                        {isMine ? (
                          message.readAt ? (
                            <>
                              <CheckCheck
                                accessibilityLabel="Read"
                                color={colors.success}
                                size={14}
                                strokeWidth={2.5}
                              />
                              <Text
                                style={[
                                  styles.messageReadLabel,
                                  isMine && styles.messageTimeMine,
                                ]}
                              >
                                Read
                              </Text>
                            </>
                          ) : (
                            <Check
                              accessibilityLabel="Sent, not read"
                              color={colors.textMuted}
                              size={14}
                              strokeWidth={2.5}
                            />
                          )
                        ) : null}
                      </View>
                    ) : null}
                  </Pressable>
                </View>
              </View>
            );
          })}
          {messageError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {messageError}
            </Text>
          ) : null}
          {notice ? (
            <Text accessibilityRole="status" style={styles.notice}>
              {notice}
            </Text>
          ) : null}
        </ScrollView>

        <EmojiPicker
          visible={isEmojiPickerVisible}
          colors={colors}
          onSelect={(emoji) => setDraft((current) => `${current}${emoji}`)}
          onClose={() => setIsEmojiPickerVisible(false)}
        />
        {mediaDrafts.length > 0 ? (
          <View style={styles.mediaDraftTray}>
            <View style={styles.mediaDraftHeader}>
              <Text style={[styles.mediaDraftHeading, { color: colors.text }]}>
                {mediaDrafts.length}{" "}
                {mediaDrafts.length === 1 ? "attachment" : "attachments"}
              </Text>
              <Text
                accessibilityRole={uploadProgress ? "text" : undefined}
                accessibilityLiveRegion="polite"
                style={[
                  styles.mediaDraftStatus,
                  {
                    color: mediaSendFailed
                      ? colors.error
                      : colors.textSecondary,
                  },
                ]}
              >
                {uploadProgress ||
                  (mediaSendFailed
                    ? "Upload failed · draft kept. Tap Send to retry."
                    : "Ready to send")}
              </Text>
            </View>
            {isSending && uploadProgressPercent !== null ? (
              <View
                accessibilityLabel={`Uploading attachments, ${uploadProgressPercent}% complete`}
                accessibilityRole="progressbar"
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: uploadProgressPercent,
                }}
                style={[
                  styles.mediaDraftProgressTrack,
                  { backgroundColor: colors.border },
                ]}
              >
                <View
                  style={[
                    styles.mediaDraftProgressFill,
                    {
                      width: `${uploadProgressPercent}%`,
                      backgroundColor: CHAT_ACCENT,
                    },
                  ]}
                />
              </View>
            ) : null}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.mediaDraftList}
            >
              {mediaDrafts.map((attachment, index) => (
                <View
                  key={attachment.id}
                  style={[
                    styles.mediaDraftCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.mediaDraftThumbnail}>
                    {attachment.kind === "image" ? (
                      <ImageMessageThumbnail
                        uri={attachment.uri}
                        style={styles.mediaDraftImage}
                        styles={styles}
                      />
                    ) : (
                      <VideoMessageThumbnail
                        styles={styles}
                        attachment={{
                          kind: "video",
                          path: "",
                          url: attachment.uri,
                        }}
                      />
                    )}
                    <View style={styles.mediaDraftControls}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Move attachment ${index + 1} earlier`}
                        disabled={isSending || index === 0}
                        onPress={() => {
                          setMediaSendFailed(false);
                          setMediaDrafts((current) => {
                            if (index < 1 || index >= current.length)
                              return current;
                            const next = [...current];
                            [next[index - 1], next[index]] = [
                              next[index],
                              next[index - 1],
                            ];
                            return next;
                          });
                        }}
                        style={styles.mediaDraftControl}
                      >
                        <ChevronUp color="#FFFFFF" size={16} />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Move attachment ${index + 1} later`}
                        disabled={isSending || index === mediaDrafts.length - 1}
                        onPress={() => {
                          setMediaSendFailed(false);
                          setMediaDrafts((current) => {
                            if (index < 0 || index >= current.length - 1)
                              return current;
                            const next = [...current];
                            [next[index], next[index + 1]] = [
                              next[index + 1],
                              next[index],
                            ];
                            return next;
                          });
                        }}
                        style={styles.mediaDraftControl}
                      >
                        <ChevronDown color="#FFFFFF" size={16} />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove attachment ${index + 1}`}
                        disabled={isSending}
                        onPress={() => {
                          setMediaSendFailed(false);
                          setMediaDrafts((current) =>
                            current.filter((item) => item.id !== attachment.id),
                          );
                        }}
                        style={styles.mediaDraftControl}
                      >
                        <X color="#FFFFFF" size={16} />
                      </Pressable>
                    </View>
                    {attachment.viewOnce ? (
                      <View
                        style={[
                          styles.mediaDraftOnceBadge,
                          { backgroundColor: CHAT_ACCENT },
                        ]}
                      >
                        <Text
                          style={[
                            styles.viewOnceBadgeText,
                            { color: "#331B1D" },
                          ]}
                        >
                          1
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.mediaDraftDetails}>
                    <Text
                      style={[
                        styles.mediaDraftMeta,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {attachment.kind === "image" ? "Photo" : "Video"}
                      {` · ${formatFileSize(attachment.fileSize ?? Number.NaN)}`}
                    </Text>
                    <Pressable
                      accessibilityRole="switch"
                      accessibilityState={{ checked: attachment.viewOnce }}
                      accessibilityLabel={`View Once for attachment ${index + 1}`}
                      disabled={isSending}
                      onPress={() => {
                        setMediaSendFailed(false);
                        setMediaDrafts((current) =>
                          current.map((item) =>
                            item.id === attachment.id
                              ? { ...item, viewOnce: !item.viewOnce }
                              : item,
                          ),
                        );
                      }}
                      style={styles.mediaDraftPrivacyToggle}
                    >
                      <Eye
                        color={
                          attachment.viewOnce ? CHAT_ACCENT : colors.textMuted
                        }
                        size={14}
                      />
                      <Text
                        style={[
                          styles.mediaDraftPrivacyText,
                          {
                            color: attachment.viewOnce
                              ? CHAT_ACCENT
                              : colors.textSecondary,
                          },
                        ]}
                      >
                        {attachment.viewOnce ? "View Once" : "Keep normal"}
                      </Text>
                    </Pressable>
                    <TextInput
                      accessibilityLabel={`Caption for attachment ${index + 1}`}
                      editable={!isSending}
                      maxLength={300}
                      onChangeText={(caption) => {
                        setMediaSendFailed(false);
                        setMediaDrafts((current) =>
                          current.map((item) =>
                            item.id === attachment.id
                              ? { ...item, caption }
                              : item,
                          ),
                        );
                      }}
                      placeholder="Add a caption"
                      placeholderTextColor={colors.textMuted}
                      value={attachment.caption}
                      style={[
                        styles.mediaDraftCaption,
                        { color: colors.text, borderColor: colors.border },
                      ]}
                    />
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}
        {replyTarget ? (
          <View style={styles.replyComposerPreview}>
            <View style={styles.replyComposerAccent} />
            <View style={styles.replyComposerCopy}>
              <Text style={styles.replyComposerLabel}>
                Replying to{" "}
                {replyTarget.senderId === userId
                  ? "yourself"
                  : activeConversation.person.name}
              </Text>
              <Text numberOfLines={1} style={styles.replyComposerText}>
                {replyTarget.attachment ? replyTarget.body : replyTarget.body}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel reply"
              onPress={() => setReplyTarget(null)}
              style={styles.replyComposerClose}
            >
              <X color={colors.textSecondary} size={17} />
            </Pressable>
          </View>
        ) : null}
        {isRecording ? (
          <RecordingStatusRow
            metering={recorderState.metering}
            duration={recorderState.durationMillis / 1000}
            styles={styles}
          />
        ) : null}
        <View style={styles.composerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open attachment options"
            disabled={isSending}
            onPress={() => setIsAttachmentMenuVisible(true)}
            style={styles.composerIconButton}
          >
            <Paperclip color={colors.textSecondary} size={21} />
          </Pressable>
          <View style={styles.composerWrap}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose an emoji"
              disabled={isSending || isRecording}
              onPress={() => {
                Keyboard.dismiss();
                setIsEmojiPickerVisible((visible) => !visible);
              }}
              style={styles.emojiButton}
            >
              <Smile color={colors.textSecondary} size={21} />
            </Pressable>
            <TextInput
              ref={composerInputRef}
              accessibilityLabel="Write a message"
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                setMediaSendFailed(false);
              }}
              onFocus={() =>
                setTimeout(
                  () => scrollRef.current?.scrollToEnd({ animated: true }),
                  100,
                )
              }
              placeholder="Message"
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={2000}
              editable={!isSending && !isRecording}
              style={styles.composerInput}
            />
            {!isRecording && (draft.trim() || mediaDrafts.length > 0) ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isSending
                    ? uploadProgress || "Sending message"
                    : mediaSendFailed
                      ? "Retry sending message"
                      : `Send message${mediaDrafts.length ? ` with ${mediaDrafts.length} attachments` : ""}`
                }
                disabled={isSending}
                onPress={() => void sendMessage()}
                style={[
                  styles.sendButton,
                  isSending && styles.sendButtonDisabled,
                ]}
              >
                {isSending ? (
                  <VeyraLoader
                    size={12}
                    imageWidth={16}
                    imageHeight={16}
                    imageMarginBottom={0}
                    loaderShown={false}
                  />
                ) : (
                  <Send color="#331B1D" size={17} />
                )}
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isRecording ? "Stop voice recording" : "Start voice recording"
                }
                accessibilityState={{ disabled: isSending }}
                disabled={isSending}
                onPress={() =>
                  void (isRecording
                    ? stopVoiceRecording()
                    : startVoiceRecording())
                }
                style={[
                  styles.sendButton,
                  isRecording && styles.recordingButton,
                  isSending && styles.sendButtonDisabled,
                ]}
              >
                {isSending ? (
                  <VeyraLoader
                    size={12}
                    imageWidth={16}
                    imageHeight={16}
                    imageMarginBottom={0}
                    loaderShown={false}
                  />
                ) : isRecording ? (
                  <Square color="#331B1D" size={15} fill="#331B1D" />
                ) : (
                  <Mic color="#331B1D" size={18} />
                )}
              </Pressable>
            )}
          </View>
        </View>

        <SafetyModal
          styles={styles}
          colors={colors}
          action={safetyAction}
          setAction={setSafetyAction}
          isLocked={activeConversation.locked === true}
          onToggleLock={() => void toggleActiveConversationLock()}
          reportReason={reportReason}
          setReportReason={setReportReason}
          isSaving={isSavingSafety}
          reportedMessage={safetyAction === "report-message"}
          onConfirm={() => void performSafetyAction()}
        />
        <LockChatsPinModal
          styles={styles}
          colors={colors}
          visible={pinSetupVisible}
          title="Create your Lock Chats PIN"
          description="Choose a six-digit PIN. You’ll use it to reveal conversations you’ve locked."
          busy={isPinBusy}
          error={pinModalError}
          onCancel={() => {
            setPinSetupVisible(false);
            setPendingLockConversation(null);
          }}
          onSubmit={(pin) => void saveInitialLockPin(pin)}
        />
        <LockChatsPinModal
          styles={styles}
          colors={colors}
          visible={pinResetVisible}
          title="Reset your Lock Chats PIN"
          description="Verify your account password, then choose a new six-digit PIN."
          busy={isPinBusy}
          error={pinModalError}
          reset
          onCancel={() => setPinResetVisible(false)}
          onSubmitReset={(password, pin) => void resetLockPin(password, pin)}
        />
        <MessageActionMenu
          message={messageMenuTarget}
          isMine={messageMenuTarget?.senderId === userId}
          styles={styles}
          colors={colors}
          onClose={() => setMessageMenuTarget(null)}
          onCopy={() => {
            if (!messageMenuTarget) return;
            void Clipboard.setStringAsync(messageMenuTarget.body)
              .then(() => setNotice("Message copied."))
              .catch((copyError: unknown) =>
                setMessageError(
                  copyError instanceof Error
                    ? copyError.message
                    : "Could not copy this message.",
                ),
              );
            setMessageMenuTarget(null);
          }}
          onReply={() => {
            if (!messageMenuTarget) return;
            setReplyTarget(messageMenuTarget);
            setMessageMenuTarget(null);
            setTimeout(() => composerInputRef.current?.focus(), 100);
          }}
          onReact={(reaction) => void reactToMessage(reaction)}
          onDelete={() => void deleteMessageForMe()}
          onDeleteForEveryone={() => void deleteMessageForEveryone()}
          onReport={() => {
            if (!messageMenuTarget || messageMenuTarget.senderId === userId)
              return;
            setReportedMessageId(messageMenuTarget.id);
            setReportReason("inappropriate");
            setMessageMenuTarget(null);
            setSafetyAction("report-message");
          }}
        />
        <AttachmentActionMenu
          visible={isAttachmentMenuVisible}
          styles={styles}
          colors={colors}
          disabled={isSending}
          viewOnceEnabled={isViewOnceMode}
          onToggleViewOnce={setIsViewOnceMode}
          onClose={() => setIsAttachmentMenuVisible(false)}
          onChooseLibrary={() => void pickMedia("library")}
          onChooseCamera={() => void pickMedia("camera")}
        />
        {videoCallModal}
        <ProfileModal
          styles={styles}
          person={profilePerson}
          colors={colors}
          isOnline={isOtherOnline}
          onClose={() => setProfilePerson(null)}
        />
        {previewAttachment ? (
          <AttachmentPreview
            attachment={previewAttachment}
            gallery={previewGallery}
            currentIndex={previewGalleryIndex}
            onNavigate={(index) => {
              const nextAttachment = previewGallery[index];
              if (!nextAttachment) return;
              setPreviewGalleryIndex(index);
              setPreviewAttachment(nextAttachment);
            }}
            onClose={
              previewAttachment.viewOnce
                ? closeViewOncePreview
                : () => {
                    setPreviewAttachment(null);
                    setPreviewGallery([]);
                    setPreviewGalleryIndex(0);
                  }
            }
          />
        ) : null}
        {pendingViewOnce ? (
          <ViewOnceSendPreview
            pending={pendingViewOnce}
            colors={colors}
            styles={styles}
            isSending={isSending}
            onCancel={cancelPendingViewOnce}
            onSend={() => void sendPendingViewOnce()}
          />
        ) : null}
        {pendingVoiceRecording ? (
          <VoiceRecordingPreview
            pending={pendingVoiceRecording}
            colors={colors}
            styles={styles}
            isSending={isSending}
            onCancel={cancelPendingVoiceRecording}
            onRetry={() => void retryVoiceRecording()}
            onSend={() => void sendPendingVoiceRecording()}
            onToggleViewOnce={(viewOnce) => {
              setIsViewOnceMode(viewOnce);
              setPendingVoiceRecording((current) =>
                current ? { ...current, viewOnce } : current,
              );
            }}
          />
        ) : null}
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={[styles.screen]}>
      {videoCallModal}
      <LockChatsPinModal
        styles={styles}
        colors={colors}
        visible={pinSetupVisible}
        title="Create your Lock Chats PIN"
        description="Choose a six-digit PIN. You’ll use it to reveal conversations you’ve locked."
        busy={isPinBusy}
        error={pinModalError}
        onCancel={() => {
          setPinSetupVisible(false);
          setPendingLockConversation(null);
        }}
        onSubmit={(pin) => void saveInitialLockPin(pin)}
      />
      <LockChatsPinModal
        styles={styles}
        colors={colors}
        visible={pinResetVisible}
        title="Reset your Lock Chats PIN"
        description="Verify your account password, then choose a new six-digit PIN."
        busy={isPinBusy}
        error={pinModalError}
        reset
        onCancel={() => setPinResetVisible(false)}
        onSubmitReset={(password, pin) => void resetLockPin(password, pin)}
      />
      <View style={styles.listHeader}>
        <View style={styles.listHeaderCopy}>
          <Text style={styles.title}>
            {messageView === "locked" ? "Locked Chats" : "Messages"}
          </Text>
          <Text style={styles.subtitle}>
            {messageView === "locked"
              ? "Only visible to you after PIN verification."
              : "Meaningful conversations start here."}
          </Text>
        </View>
        {messageView === "locked" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Return to messages"
            onPress={() => {
              setPinError("");
              revokeLockedChatView();
            }}
            style={styles.headerFilterButton}
          >
            <ChevronLeft color={colors.primary} size={22} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isFilterPanelVisible
                ? "Hide message filters"
                : "Show message filters"
            }
            accessibilityState={{ expanded: isFilterPanelVisible }}
            onPress={() => setIsFilterPanelVisible((visible) => !visible)}
            style={[
              styles.headerFilterButton,
              isFilterPanelVisible && styles.headerFilterButtonActive,
            ]}
          >
            <SlidersHorizontal
              color={isFilterPanelVisible ? "#331B1D" : colors.primary}
              size={20}
            />
          </Pressable>
        )}
      </View>
      {isFilterPanelVisible && messageView !== "locked" ? (
        <>
          <View style={styles.searchSection}>
            {messageView === "search" ? (
              <View style={styles.searchWrap}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    pinEntryMode
                      ? "Search Locked Chats with PIN"
                      : "Enter a PIN to open Locked Chats"
                  }
                  disabled={isPinBusy}
                  onPress={() => {
                    if (pinEntryMode) {
                      void submitLockedChatsPin();
                    } else {
                      void openLockedChatsPinEntry(
                        /^\d{6}$/.test(search) ? search : undefined,
                      );
                    }
                  }}
                  style={styles.searchSubmit}
                >
                  {isPinBusy ? (
                    <VeyraLoader
                      size={20}
                      imageWidth={20}
                      imageHeight={20}
                      imageMarginBottom={0}
                      loaderShown={false}
                    />
                  ) : (
                    <Search color={colors.textSecondary} size={19} />
                  )}
                </Pressable>
                <TextInput
                  accessibilityLabel={
                    pinEntryMode
                      ? "Enter your six-digit Locked Chats PIN"
                      : "Search conversations"
                  }
                  value={pinEntryMode ? pinValue : search}
                  onChangeText={(value) => {
                    if (pinEntryMode) {
                      setPinValue(value.replace(/\D/g, "").slice(0, 6));
                      setPinError("");
                    } else {
                      setSearch(value);
                    }
                  }}
                  keyboardType={pinEntryMode ? "number-pad" : "default"}
                  secureTextEntry={pinEntryMode}
                  maxLength={pinEntryMode ? 6 : undefined}
                  placeholder={
                    pinEntryMode
                      ? "Enter six-digit PIN"
                      : "Search conversations…"
                  }
                  placeholderTextColor={colors.textMuted}
                  style={styles.searchInput}
                />
                {pinEntryMode ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel PIN entry"
                    onPress={() => {
                      setPinEntryMode(false);
                      setPinValue("");
                      setPinError("");
                    }}
                  >
                    <X color={colors.textSecondary} size={18} />
                  </Pressable>
                ) : search ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    onPress={() => setSearch("")}
                  >
                    <Text style={styles.clearSearch}>×</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : onlinePeople.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.onlinePeopleRow}
                style={styles.onlinePeopleScroll}
              >
                {onlinePeople.map((conversation) => (
                  <Pressable
                    key={conversation.matchId}
                    accessibilityRole="button"
                    accessibilityLabel={`Start chatting with ${conversation.person.name}, online`}
                    onPress={() => openConversation(conversation)}
                    style={styles.onlinePerson}
                  >
                    <View style={styles.onlinePersonAvatar}>
                      <Avatar
                        person={conversation.person}
                        size={30}
                        styles={styles}
                      />
                      <View style={styles.onlinePersonDot} />
                    </View>
                    <Text numberOfLines={1} style={styles.onlinePersonName}>
                      {conversation.person.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <View style={[styles.onlineEmpty, styles.onlineEmptyInRow]}>
                <Text style={styles.onlineEmptyText}>
                  No one online right now
                </Text>
              </View>
            )}
            {!pinEntryMode ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  messageView === "search"
                    ? "Show online users"
                    : "Search conversations"
                }
                onPress={() =>
                  setMessageView((current) =>
                    current === "search" ? "online" : "search",
                  )
                }
                style={styles.messageViewToggle}
              >
                {messageView === "search" ? (
                  <Users color={colors.textSecondary} size={18} />
                ) : (
                  <Search color={colors.textSecondary} size={18} />
                )}
              </Pressable>
            ) : null}
          </View>
          {pinEntryMode || pinError ? (
            <View style={styles.pinEntryHelp}>
              {pinError ? (
                <Text accessibilityRole="alert" style={styles.pinError}>
                  {pinError}
                </Text>
              ) : null}
              {pinEntryMode ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={isPinBusy}
                  onPress={() => {
                    setPinModalError("");
                    setPinResetVisible(true);
                  }}
                >
                  <Text style={styles.pinResetLink}>Forgot PIN?</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {!pinEntryMode ? (
            <View style={styles.filters}>
              {(
                [
                  {
                    value: "all",
                    label: "All conversations",
                    Icon: MessageCircle,
                  },
                  { value: "unread", label: "Unread", Icon: CheckCheck },
                  { value: "new", label: "New matches", Icon: Sparkles },
                  { value: "archived", label: "Archived", Icon: Archive },
                ] as const
              ).map(({ value, label, Icon }) => (
                <Pressable
                  key={value}
                  accessibilityRole="tab"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: filter === value }}
                  onPress={() => setFilter(value)}
                  style={[
                    styles.filterButton,
                    filter === value && styles.filterButtonActive,
                  ]}
                >
                  <Icon
                    color={filter === value ? "#331B1D" : colors.textSecondary}
                    size={17}
                  />
                  {value === "unread" && feed ? (
                    <Text
                      style={[
                        styles.filterCount,
                        filter === value && styles.filterCountActive,
                      ]}
                    >
                      {feed.conversations.reduce(
                        (total, conversation) =>
                          total +
                          (conversation.archivedAt === null
                            ? conversation.unreadCount
                            : 0),
                        0,
                      )}
                    </Text>
                  ) : value === "new" && feed?.newMatches.length ? (
                    <Text
                      style={[
                        styles.filterCount,
                        filter === value && styles.filterCountActive,
                      ]}
                    >
                      {feed.newMatches.length}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      {notice ? (
        <Text accessibilityRole="status" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
      {presenceError ? (
        <Text accessibilityRole="alert" style={styles.presenceError}>
          Online status is unavailable: {presenceError}
        </Text>
      ) : null}
      {error ? (
        <View style={styles.stateWrap}>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Pressable onPress={() => void loadFeed()} style={styles.retryButton}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : isLoading && !feed ? (
        <View style={styles.stateWrap}>
          <VeyraLoader
            size="medium"
            imageWidth={40}
            imageHeight={40}
            imageMarginBottom={8}
          />
        </View>
      ) : messageView === "locked" ? (
        <ScrollView
          contentContainerStyle={styles.conversationList}
          showsVerticalScrollIndicator={false}
        >
          {pinError ? (
            <Text accessibilityRole="alert" style={styles.pinError}>
              {pinError}
            </Text>
          ) : null}
          {lockedConversations?.length ? (
            <>
              <Text style={styles.sectionTitle}>Locked conversations</Text>
              {lockedConversations.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  isOnline={false}
                  colors={colors}
                  styles={styles}
                  onPress={() => openExistingConversation(conversation)}
                  isArchived={false}
                  isArchiving={false}
                  onArchive={() => {}}
                  isLocked
                  onUnlock={() =>
                    void unlockConversationFromLockedList(conversation)
                  }
                />
              ))}
            </>
          ) : (
            <EmptyMessage
              styles={styles}
              title="No locked conversations"
              body="Conversations you lock will be kept here, separate from your inbox."
            />
          )}
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={styles.conversationList}
          showsVerticalScrollIndicator={false}
        >
          {filteredNewMatches.length > 0 ? (
            <View style={styles.newMatchesWrap}>
              <Text style={styles.sectionTitle}>New connections</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.newMatchesRow}
              >
                {filteredNewMatches.map((match) => (
                  <Pressable
                    key={match.matchId}
                    accessibilityRole="button"
                    accessibilityLabel={`Start a conversation with ${match.person.name}`}
                    onPress={() =>
                      openConversation({
                        id: match.conversationId,
                        matchId: match.matchId,
                        person: match.person,
                      })
                    }
                    style={styles.newMatchCard}
                  >
                    <Avatar person={match.person} size={62} styles={styles} />
                    <Text numberOfLines={1} style={styles.newMatchName}>
                      {match.person.name}
                    </Text>
                    <Text style={styles.newMatchLabel}>Say hello</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : filter === "new" && filteredNewMatches.length === 0 ? (
            <EmptyMessage
              styles={styles}
              title="No new matches yet"
              body="When you and someone like each other, you can start a conversation here."
            />
          ) : null}
          {filter !== "new" && filteredConversations.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>
                {filter === "archived"
                  ? "Archived conversations"
                  : "Conversations"}
              </Text>
              {filteredConversations.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  isOnline={onlineConversationIds.has(conversation.id)}
                  colors={colors}
                  styles={styles}
                  onPress={() => openExistingConversation(conversation)}
                  isArchived={conversation.archivedAt !== null}
                  isArchiving={isArchivingConversation}
                  onArchive={() =>
                    void archiveConversation(
                      conversation,
                      conversation.archivedAt === null,
                    )
                  }
                />
              ))}
            </>
          ) : filter === "unread" && filteredConversations.length === 0 ? (
            <EmptyMessage
              styles={styles}
              title="You’re all caught up"
              body="Unread messages from your matches will show up here."
            />
          ) : filter === "archived" && filteredConversations.length === 0 ? (
            <EmptyMessage
              styles={styles}
              title="Nothing archived"
              body="Conversations you archive will be kept here, separate from your active inbox."
            />
          ) : filter === "all" &&
            activeConversationCount === 0 &&
            (feed?.newMatches.length ?? 0) === 0 ? (
            <EmptyMessage
              styles={styles}
              title={
                conversationCount > 0
                  ? "Your inbox is clear"
                  : "Your next connection starts here"
              }
              body={
                conversationCount > 0
                  ? "Your active conversations are quiet. Archived conversations are available in the Archived filter."
                  : "When you and someone like each other, your private conversation will appear here."
              }
            />
          ) : null}
        </ScrollView>
      )}
      <Text style={styles.safetyFooter}>
        Conversations are only available between active mutual matches.
      </Text>
    </View>
  );
}

function ConversationRow({
  conversation,
  isOnline,
  colors,
  styles,
  onPress,
  isArchived,
  isArchiving,
  onArchive,
  isLocked = false,
  onUnlock,
}: {
  conversation: ChatConversation;
  isOnline: boolean;
  colors: SystemColors;
  styles: ChatStyles;
  onPress: () => void;
  isArchived: boolean;
  isArchiving: boolean;
  onArchive: () => void;
  isLocked?: boolean;
  onUnlock?: () => void;
}) {
  const preview = conversation.lastMessage
    ? `${conversation.lastMessage.replyQuote ? "↪ " : ""}${conversation.lastMessage.body}`
    : "Say hello to your match.";
  return (
    <View style={styles.conversationRowWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open conversation with ${conversation.person.name}${isOnline ? ", online" : ""}`}
        onPress={onPress}
        style={styles.conversationRow}
      >
        <View style={styles.conversationAvatar}>
          <Avatar person={conversation.person} size={54} styles={styles} />
          {isOnline ? <View style={styles.avatarOnlineDot} /> : null}
        </View>
        <View style={styles.conversationCopy}>
          <View style={styles.conversationNameLine}>
            <Text numberOfLines={1} style={styles.conversationName}>
              {conversation.person.name}
              {conversation.person.age === null
                ? ""
                : `, ${conversation.person.age}`}
            </Text>
            {conversation.person.identityVerified ? (
              <IdentityVerifiedBadge colors={colors} compact />
            ) : null}
            {isOnline ? (
              <View style={styles.onlineLabel}>
                <View style={styles.onlineLabelDot} />
                <Text style={styles.onlineLabelText}>Online</Text>
              </View>
            ) : null}
          </View>
          <Text
            numberOfLines={1}
            style={[
              styles.conversationPreview,
              conversation.unreadCount > 0 && styles.conversationPreviewUnread,
            ]}
          >
            {preview}
          </Text>
        </View>
        <View style={styles.conversationMeta}>
          <Text style={styles.conversationTime}>
            {formatConversationTime(
              conversation.lastMessage?.createdAt ?? conversation.createdAt,
            )}
          </Text>
          {conversation.unreadCount > 0 ? (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>
                {conversation.unreadCount > 9 ? "9+" : conversation.unreadCount}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          isLocked
            ? `Unlock conversation with ${conversation.person.name}`
            : isArchived
              ? `Restore ${conversation.person.name} to inbox`
              : `Archive conversation with ${conversation.person.name}`
        }
        disabled={isArchiving}
        onPress={isLocked ? onUnlock : onArchive}
        style={styles.archiveButton}
      >
        {isArchiving ? (
          <VeyraLoader
            size={12}
            imageWidth={16}
            imageHeight={16}
            imageMarginBottom={0}
            loaderShown={false}
          />
        ) : isLocked ? (
          <LockKeyholeOpen size={18} color={colors.textSecondary} />
        ) : isArchived ? (
          <ArchiveRestore size={18} color={colors.textSecondary} />
        ) : (
          <Archive size={18} color={colors.textSecondary} />
        )}
      </Pressable>
    </View>
  );
}

function Avatar({
  person,
  size,
  styles,
}: {
  person: ChatPerson;
  size: number;
  styles: ChatStyles;
}) {
  return person.image ? (
    <Image
      source={{ uri: person.image }}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    />
  ) : (
    <View
      style={[
        styles.avatar,
        styles.avatarPlaceholder,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={styles.avatarInitial}>
        {person.name.trim().slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

function EmptyMessage({
  title,
  body,
  styles,
}: {
  title: string;
  body: string;
  styles: ChatStyles;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyMark}>♡</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function AttachmentView({
  attachment,
  isMine,
  colors,
  styles,
  onPreview,
  onOpenMessageActions,
}: {
  attachment: NonNullable<ChatMessage["attachment"]>;
  isMine: boolean;
  colors: SystemColors;
  styles: ChatStyles;
  onPreview: (attachment: PreviewAttachment) => void;
  onOpenMessageActions: () => void;
}) {
  if (attachment.kind === "image") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View shared image"
        onPress={() => onPreview({ ...attachment, kind: "image" })}
      >
        <ImageMessageThumbnail
          uri={attachment.url}
          style={styles.attachmentImage}
          styles={styles}
        />
      </Pressable>
    );
  }
  if (attachment.kind === "video") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Play shared video"
        onPress={() => onPreview({ ...attachment, kind: "video" })}
        style={styles.videoAttachment}
      >
        <VideoMessageThumbnail
          attachment={{ ...attachment, kind: "video" }}
          styles={styles}
        />
        <View style={styles.videoPlayButton}>
          <Play color="#FFFFFF" fill="#FFFFFF" size={23} />
        </View>
      </Pressable>
    );
  }
  return (
    <AudioAttachment
      attachment={attachment}
      isMine={isMine}
      colors={colors}
      styles={styles}
      onOpenMessageActions={onOpenMessageActions}
    />
  );
}

function ViewOnceAttachment({
  attachment,
  isMine,
  opening,
  colors,
  styles,
  onOpen,
}: {
  attachment: NonNullable<ChatMessage["attachment"]>;
  isMine: boolean;
  opening: boolean;
  colors: SystemColors;
  styles: ChatStyles;
  onOpen: () => void;
}) {
  const { kind, openedAt, expiresAt } = attachment;
  const expired = expiresAt != null && Date.parse(expiresAt) <= Date.now();
  const opened = Boolean(openedAt);
  const label =
    kind === "image" ? "Photo" : kind === "video" ? "Video" : "Voice note";
  return (
    <View
      style={[
        styles.viewOnceBubble,
        opened && styles.viewOnceBubbleOpened,
        expired && styles.viewOnceBubbleExpired,
        {
          backgroundColor: colors.surfaceSecondary,
          borderColor: colors.border,
        },
      ]}
    >
      <View
        style={[
          styles.viewOnceBadge,
          opened || expired
            ? styles.viewOnceBadgeViewed
            : { backgroundColor: CHAT_ACCENT },
        ]}
      >
        {opened ? (
          <CheckCheck color={CHAT_ACCENT} size={17} strokeWidth={2.5} />
        ) : expired ? (
          <X color={colors.textMuted} size={16} strokeWidth={2.5} />
        ) : (
          <Text style={[styles.viewOnceBadgeText, { color: "#331B1D" }]}>
            1
          </Text>
        )}
      </View>
      <View style={styles.viewOnceMessageCopy}>
        <Text style={[styles.viewOnceMessageTitle, { color: colors.text }]}>
          {opened ? `${label} viewed` : `View once ${label.toLowerCase()}`}
        </Text>
        <Text
          style={[
            styles.viewOnceMessageStatus,
            { color: colors.textSecondary },
          ]}
        >
          {opened
            ? "No longer available"
            : expired
              ? "Expired · unavailable"
              : isMine
                ? "Waiting to be opened"
                : "Tap to open once"}
        </Text>
      </View>
      {isMine || openedAt || expired ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open View Once ${label.toLowerCase()}`}
          disabled={opening}
          onPress={onOpen}
          style={styles.viewOnceOpenButton}
        >
          {opening ? (
            <VeyraLoader
              size={12}
              imageWidth={16}
              imageHeight={16}
              imageMarginBottom={0}
              loaderShown={false}
            />
          ) : (
            <Eye color={CHAT_ACCENT} size={19} />
          )}
        </Pressable>
      )}
    </View>
  );
}

function ViewOnceSendPreview({
  pending,
  colors,
  styles,
  isSending,
  onCancel,
  onSend,
}: {
  pending: PendingViewOnce;
  colors: SystemColors;
  styles: ChatStyles;
  isSending: boolean;
  onCancel: () => void;
  onSend: () => void;
}) {
  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View
        style={[
          previewStyles.sendPreviewScreen,
          { backgroundColor: colors.background },
        ]}
      >
        <View style={previewStyles.sendPreviewMedia}>
          {pending.kind === "image" ? (
            <Image
              accessibilityLabel="Preview View Once photo"
              source={{ uri: pending.uri }}
              resizeMode="contain"
              style={previewStyles.image}
            />
          ) : pending.kind === "video" ? (
            <SendVideoPreview uri={pending.uri} />
          ) : (
            <AudioAttachment
              attachment={{ kind: "audio", path: "", url: pending.uri }}
              isMine={false}
              colors={colors}
              styles={styles}
            />
          )}
        </View>
        <View style={previewStyles.sendPreviewFooter}>
          <Text
            style={[previewStyles.sendPreviewTitle, { color: colors.text }]}
          >
            Send as View Once
          </Text>
          <Text
            style={[
              previewStyles.sendPreviewDisclosure,
              { color: colors.textSecondary },
            ]}
          >
            It can be opened once and expires if unopened. Screenshots may still
            be possible on some devices.
          </Text>
          <View style={previewStyles.sendPreviewActions}>
            <Pressable
              accessibilityRole="button"
              disabled={isSending}
              onPress={onCancel}
              style={[
                previewStyles.sendPreviewButton,
                { borderColor: colors.border },
              ]}
            >
              <Text style={{ color: colors.text }}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={isSending}
              onPress={onSend}
              style={[
                previewStyles.sendPreviewButton,
                {
                  backgroundColor: CHAT_ACCENT,
                  borderColor: CHAT_ACCENT,
                },
              ]}
            >
              {isSending ? (
                <VeyraLoader
                  size={12}
                  imageWidth={16}
                  imageHeight={16}
                  imageMarginBottom={0}
                  loaderShown={false}
                />
              ) : (
                <Text style={{ color: "#331B1D" }}>Send · 1</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function VoiceRecordingPreview({
  pending,
  colors,
  styles,
  isSending,
  onCancel,
  onRetry,
  onSend,
  onToggleViewOnce,
}: {
  pending: PendingVoiceRecording;
  colors: SystemColors;
  styles: ChatStyles;
  isSending: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onSend: () => void;
  onToggleViewOnce: (viewOnce: boolean) => void;
}) {
  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View
        style={[
          previewStyles.voicePreviewScreen,
          { backgroundColor: colors.background },
        ]}
      >
        <View style={previewStyles.voicePreviewContent}>
          <View
            style={[
              previewStyles.voicePreviewIcon,
              { backgroundColor: colors.surfaceSecondary },
            ]}
          >
            <Mic color={CHAT_ACCENT} size={27} />
          </View>
          <Text
            style={[previewStyles.voicePreviewTitle, { color: colors.text }]}
          >
            Preview voice message
          </Text>
          <Text
            style={[
              previewStyles.voicePreviewDescription,
              { color: colors.textSecondary },
            ]}
          >
            {formatMediaDuration(pending.durationMs / 1000)}
            {pending.viewOnce ? " · View Once" : ""}
          </Text>
          <AudioAttachment
            attachment={{
              kind: "audio",
              path: "",
              url: pending.uri,
            }}
            isMine={false}
            colors={colors}
            styles={styles}
          />
          <View
            style={[
              previewStyles.voicePreviewPrivacy,
              {
                backgroundColor: colors.surfaceSecondary,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={previewStyles.voicePreviewPrivacyCopy}>
              {pending.viewOnce ? (
                <View
                  style={[
                    previewStyles.voicePreviewBadge,
                    { backgroundColor: CHAT_ACCENT },
                  ]}
                >
                  <Text
                    style={{
                      color: "#331B1D",
                      fontSize: 11,
                      fontWeight: "800",
                    }}
                  >
                    1
                  </Text>
                </View>
              ) : (
                <Eye color={CHAT_ACCENT} size={19} />
              )}
              <View>
                <Text
                  style={[
                    previewStyles.voicePreviewPrivacyTitle,
                    { color: colors.text },
                  ]}
                >
                  View Once
                </Text>
                <Text
                  style={[
                    previewStyles.voicePreviewPrivacyCopyText,
                    { color: colors.textSecondary },
                  ]}
                >
                  {pending.viewOnce
                    ? "Listen once, then it becomes unavailable"
                    : "Send as a normal voice message"}
                </Text>
              </View>
            </View>
            <Switch
              accessibilityLabel="Send voice message as View Once"
              value={pending.viewOnce}
              disabled={isSending}
              onValueChange={onToggleViewOnce}
              trackColor={{ false: colors.border, true: CHAT_ACCENT }}
              thumbColor={colors.surface}
            />
          </View>
        </View>
        <View style={previewStyles.voicePreviewActions}>
          <Pressable
            accessibilityRole="button"
            disabled={isSending}
            onPress={onCancel}
            style={[
              previewStyles.sendPreviewButton,
              { borderColor: colors.border },
            ]}
          >
            <Text style={{ color: colors.text }}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={isSending}
            onPress={onRetry}
            style={[
              previewStyles.sendPreviewButton,
              { borderColor: colors.border },
            ]}
          >
            <Text style={{ color: colors.text }}>Record again</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={isSending}
            onPress={onSend}
            style={[
              previewStyles.sendPreviewButton,
              { backgroundColor: CHAT_ACCENT, borderColor: CHAT_ACCENT },
            ]}
          >
            {isSending ? (
              <VeyraLoader
                size={12}
                imageWidth={16}
                imageHeight={16}
                imageMarginBottom={0}
                loaderShown={false}
              />
            ) : (
              <Text style={{ color: "#331B1D" }}>Send</Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SendVideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return (
    <VideoView
      player={player}
      nativeControls
      contentFit="contain"
      style={previewStyles.video}
    />
  );
}

function GroupedAttachmentView({
  messageId,
  attachments,
  isMine,
  openingAttachmentKey,
  colors,
  styles,
  onPreview,
  onOpenViewOnce,
}: {
  messageId: string;
  attachments: ChatAttachment[];
  isMine: boolean;
  openingAttachmentKey: string | null;
  colors: SystemColors;
  styles: ChatStyles;
  onPreview: (attachment: PreviewAttachment, index: number) => void;
  onOpenViewOnce: (attachment: ChatAttachment) => void;
}) {
  return (
    <View style={styles.groupedAttachmentGrid}>
      {attachments.map((attachment, index) => {
        if (attachment.kind === "audio") return null;
        const isVideo = attachment.kind === "video";
        const isExpired =
          attachment.expiresAt != null &&
          Date.parse(attachment.expiresAt) <= Date.now();
        const isUnavailable = Boolean(attachment.openedAt) || isExpired;
        const key = `${attachment.path || "view-once"}-${index}`;
        const preview: PreviewAttachment = {
          ...attachment,
          kind: isVideo ? "video" : "image",
        };
        return (
          <View key={key} style={styles.groupedMediaTile}>
            {attachment.viewOnce ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  attachment.openedAt
                    ? `View Once ${isVideo ? "video" : "photo"}, opened`
                    : `Open View Once ${isVideo ? "video" : "photo"}`
                }
                disabled={
                  isMine ||
                  Boolean(attachment.openedAt) ||
                  (attachment.expiresAt !== undefined &&
                    attachment.expiresAt !== null &&
                    Date.parse(attachment.expiresAt) <= Date.now()) ||
                  openingAttachmentKey ===
                    `${messageId}:${attachment.attachmentIndex ?? index}`
                }
                onPress={() => onOpenViewOnce(attachment)}
                style={[
                  styles.groupedAttachmentItem,
                  styles.groupedViewOnceTile,
                  isUnavailable && styles.groupedViewOnceUnavailable,
                  { backgroundColor: colors.surfaceSecondary },
                ]}
              >
                {isUnavailable ? null : (
                  <View
                    style={[
                      styles.viewOnceBadge,
                      styles.groupedViewOnceBadge,
                      { backgroundColor: CHAT_ACCENT },
                    ]}
                  >
                    <Text
                      style={[styles.viewOnceBadgeText, { color: "#331B1D" }]}
                    >
                      1
                    </Text>
                  </View>
                )}
                {openingAttachmentKey?.endsWith(
                  `${messageId}:${attachment.attachmentIndex ?? index}`,
                ) ? (
                  <VeyraLoader
                    size={14}
                    imageWidth={18}
                    imageHeight={18}
                    imageMarginBottom={0}
                    loaderShown={false}
                  />
                ) : attachment.openedAt ? (
                  <CheckCheck color={CHAT_ACCENT} size={23} strokeWidth={1.8} />
                ) : isExpired ? (
                  <X color={colors.textMuted} size={22} strokeWidth={1.8} />
                ) : (
                  <Eye color={CHAT_ACCENT} size={22} />
                )}
                <Text
                  style={[
                    styles.groupedViewOnceLabel,
                    isUnavailable && styles.groupedViewOnceUnavailableLabel,
                    { color: colors.text },
                  ]}
                >
                  {attachment.openedAt
                    ? "Viewed · unavailable"
                    : isExpired
                      ? "Expired · unavailable"
                      : isMine
                        ? "View Once"
                        : "Tap to open"}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isVideo ? "Play shared video" : "View shared image"
                }
                onPress={() => onPreview(preview, index)}
                style={styles.groupedAttachmentItem}
              >
                {isVideo ? (
                  <>
                    <VideoMessageThumbnail
                      styles={styles}
                      attachment={{ ...attachment, kind: "video" }}
                    />
                    <View style={styles.groupedVideoPlay}>
                      <Play color="#FFFFFF" fill="#FFFFFF" size={18} />
                    </View>
                  </>
                ) : (
                  <ImageMessageThumbnail
                    uri={attachment.url}
                    style={styles.groupedAttachmentImage}
                    styles={styles}
                  />
                )}
              </Pressable>
            )}
            {attachment.caption ? (
              <Text
                numberOfLines={2}
                style={[
                  styles.groupedMediaCaption,
                  { color: colors.textSecondary },
                ]}
              >
                {attachment.caption}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function ImageMessageThumbnail({
  uri,
  style,
  styles,
}: {
  uri: string;
  style: StyleProp<ViewStyle>;
  styles: ChatStyles;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setProgressPercent(null);
  }, [uri]);

  return (
    <View style={[style, styles.mediaLoadingContainer]}>
      <Image
        accessibilityLabel="Shared image"
        source={{ uri }}
        resizeMode="cover"
        onLoadStart={() => setIsLoading(true)}
        onProgress={(event) => {
          const { loaded, total } = event.nativeEvent;
          if (total > 0) {
            setProgressPercent(
              Math.min(100, Math.round((loaded / total) * 100)),
            );
          }
        }}
        onLoadEnd={() => {
          setIsLoading(false);
          setProgressPercent(100);
        }}
        style={StyleSheet.absoluteFill}
      />
      {isLoading ? (
        <View
          accessibilityLabel={
            progressPercent === null
              ? "Loading image"
              : `Loading image, ${progressPercent}%`
          }
          accessibilityRole="progressbar"
          style={styles.mediaLoadingIndicator}
        >
          <VeyraLoader
            size={14}
            imageWidth={18}
            imageHeight={18}
            imageMarginBottom={0}
            loaderShown={false}
          />
          {progressPercent === null ? null : (
            <Text style={styles.mediaLoadingPercent}>{progressPercent}%</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

function VideoMessageThumbnail({
  attachment,
  styles,
}: {
  attachment: VideoPreviewAttachment;
  styles: ChatStyles;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const player = useVideoPlayer(attachment.url, (videoPlayer) => {
    videoPlayer.muted = true;
    videoPlayer.pause();
  });

  useEffect(() => {
    const updateProgress = (bufferedPosition: number) => {
      if (player.duration > 0 && bufferedPosition >= 0) {
        setProgressPercent(
          Math.min(100, Math.round((bufferedPosition / player.duration) * 100)),
        );
      }
    };
    updateProgress(player.bufferedPosition);
    setIsLoading(player.status !== "readyToPlay" && player.status !== "error");
    const subscription = player.addListener("statusChange", ({ status }) => {
      setIsLoading(status !== "readyToPlay" && status !== "error");
      if (status === "readyToPlay") setProgressPercent(100);
    });
    const progressSubscription = player.addListener(
      "timeUpdate",
      ({ bufferedPosition }) => updateProgress(bufferedPosition),
    );
    return () => {
      subscription.remove();
      progressSubscription.remove();
    };
  }, [player]);

  return (
    <>
      <VideoView
        player={player}
        nativeControls={false}
        contentFit="cover"
        style={previewStyles.messageVideo}
      />
      {isLoading ? (
        <View
          accessibilityLabel={
            progressPercent === null
              ? "Loading video"
              : `Loading video, ${progressPercent}% buffered`
          }
          accessibilityRole="progressbar"
          style={styles.mediaLoadingBadge}
        >
          <VeyraLoader
            size={14}
            imageWidth={18}
            imageHeight={18}
            imageMarginBottom={0}
            loaderShown={false}
          />
          {progressPercent === null ? null : (
            <Text style={styles.mediaLoadingPercent}>{progressPercent}%</Text>
          )}
        </View>
      ) : null}
    </>
  );
}

function AttachmentPreview({
  attachment,
  gallery,
  currentIndex,
  onNavigate,
  onClose,
}: {
  attachment: PreviewAttachment;
  gallery: PreviewAttachment[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}) {
  if (attachment.viewOnce) {
    return (
      <ProtectedAttachmentPreview attachment={attachment} onClose={onClose} />
    );
  }
  if (attachment.kind === "audio") return null;
  const canNavigate = gallery.length > 1;
  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={previewStyles.screen}>
        <GallerySwipeArea
          enabled={canNavigate}
          currentIndex={currentIndex}
          itemCount={gallery.length}
          onSwipe={(direction) =>
            onNavigate(
              Math.max(
                0,
                Math.min(gallery.length - 1, currentIndex + direction),
              ),
            )
          }
          renderItem={(index) => {
            const item = gallery[index];
            return item ? (
              <GalleryPreviewItem
                attachment={item}
                active={index === currentIndex}
              />
            ) : null;
          }}
          style={previewStyles.galleryArea}
        />
        {canNavigate ? (
          <GalleryControls
            currentIndex={currentIndex}
            total={gallery.length}
            onNavigate={onNavigate}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close media"
          onPress={onClose}
          style={previewStyles.closeButton}
        >
          <X color="#FFFFFF" size={24} />
        </Pressable>
      </View>
    </Modal>
  );
}

function GallerySwipeArea({
  enabled,
  currentIndex,
  itemCount,
  onSwipe,
  style,
  renderItem,
}: {
  enabled: boolean;
  currentIndex: number;
  itemCount: number;
  onSwipe: (direction: -1 | 1) => void;
  style: StyleProp<ViewStyle>;
  renderItem: (index: number) => ReactNode;
}) {
  const width = Dimensions.get("window").width;
  const translateX = useRef(new Animated.Value(-width)).current;
  const previousIndex = useRef(currentIndex);
  const pendingDirection = useRef<-1 | 1 | null>(null);

  useLayoutEffect(() => {
    if (previousIndex.current === currentIndex) return;
    const direction = currentIndex > previousIndex.current ? 1 : -1;
    const wasSwiped = pendingDirection.current !== null;
    pendingDirection.current = null;
    previousIndex.current = currentIndex;
    if (wasSwiped) {
      translateX.setValue(-width);
    } else {
      translateX.setValue(-width + direction * width);
      Animated.spring(translateX, {
        toValue: -width,
        speed: 20,
        bounciness: 4,
        useNativeDriver: true,
      }).start();
    }
  }, [currentIndex, translateX, width]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          enabled &&
          Math.abs(gesture.dx) > 24 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25,
        onPanResponderMove: (_event, gesture) => {
          translateX.setValue(-width + gesture.dx);
        },
        onPanResponderRelease: (_event, gesture) => {
          const direction =
            gesture.dx <= -45 ? 1 : gesture.dx >= 45 ? -1 : null;
          const nextIndex =
            direction === null ? currentIndex : currentIndex + direction;
          if (direction !== null && nextIndex >= 0 && nextIndex < itemCount) {
            pendingDirection.current = direction;
            Animated.timing(translateX, {
              toValue: -width - direction * width,
              duration: 170,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }).start(({ finished }) => {
              if (finished) onSwipe(direction);
            });
          } else {
            Animated.spring(translateX, {
              toValue: -width,
              speed: 20,
              bounciness: 4,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [currentIndex, enabled, itemCount, onSwipe, translateX, width],
  );
  return (
    <View {...responder.panHandlers} style={[style, { overflow: "hidden" }]}>
      <Animated.View
        style={[
          previewStyles.galleryTrack,
          {
            width: width * 3,
            transform: [{ translateX }],
          },
        ]}
      >
        {[-1, 0, 1].map((offset) => {
          const index = currentIndex + offset;
          return (
            <View key={offset} style={[previewStyles.galleryPage, { width }]}>
              {index >= 0 && index < itemCount ? renderItem(index) : null}
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

function GalleryPreviewItem({
  attachment,
  active,
}: {
  attachment: PreviewAttachment;
  active: boolean;
}) {
  if (attachment.kind === "image") {
    return (
      <Image
        accessibilityLabel="Shared image preview"
        source={{ uri: attachment.url }}
        resizeMode="contain"
        style={previewStyles.image}
      />
    );
  }
  if (attachment.kind === "video") {
    return (
      <GalleryVideoItem
        attachment={{ ...attachment, kind: "video" }}
        active={active}
      />
    );
  }
  return null;
}

function GalleryVideoItem({
  attachment,
  active,
}: {
  attachment: VideoPreviewAttachment;
  active: boolean;
}) {
  const player = useVideoPlayer(attachment.url);
  return (
    <VideoView
      player={player}
      nativeControls={active}
      contentFit="contain"
      style={previewStyles.video}
    />
  );
}

function GalleryControls({
  currentIndex,
  total,
  onNavigate,
}: {
  currentIndex: number;
  total: number;
  onNavigate: (index: number) => void;
}) {
  return (
    <>
      {currentIndex > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous attachment"
          onPress={() => onNavigate(currentIndex - 1)}
          style={[previewStyles.galleryArrow, previewStyles.galleryArrowLeft]}
        >
          <ChevronLeft color="#FFFFFF" size={26} />
        </Pressable>
      ) : null}
      {currentIndex < total - 1 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next attachment"
          onPress={() => onNavigate(currentIndex + 1)}
          style={[previewStyles.galleryArrow, previewStyles.galleryArrowRight]}
        >
          <ChevronRight color="#FFFFFF" size={26} />
        </Pressable>
      ) : null}
      <View
        accessibilityLabel={`Attachment ${currentIndex + 1} of ${total}`}
        style={previewStyles.galleryCounter}
      >
        <Text style={previewStyles.galleryCounterText}>
          {currentIndex + 1} / {total}
        </Text>
      </View>
    </>
  );
}

function ProtectedAttachmentPreview({
  attachment,
  onClose,
}: {
  attachment: PreviewAttachment;
  onClose: () => void;
}) {
  const [screenshotDetected, setScreenshotDetected] = useState(false);
  const [captureProtectionMessage, setCaptureProtectionMessage] = useState("");

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state !== "active") onClose();
      },
    );
    let screenshotSubscription: ReturnType<
      typeof addScreenshotListener
    > | null = null;
    if (NATIVE_SCREEN_PROTECTION && Platform.OS === "ios") {
      try {
        screenshotSubscription = addScreenshotListener(() => {
          setScreenshotDetected(true);
        });
      } catch {
        setCaptureProtectionMessage(
          "Screenshot detection is unavailable on this device.",
        );
      }
    } else if (!NATIVE_SCREEN_PROTECTION) {
      setCaptureProtectionMessage(
        Platform.OS === "web"
          ? "Browser previews cannot prevent screenshots or downloads."
          : "Use a VEYRA development build for device-level screenshot protection.",
      );
    }
    return () => {
      appStateSubscription.remove();
      screenshotSubscription?.remove();
    };
  }, [onClose]);

  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={previewStyles.screen}>
        {attachment.kind === "image" ? (
          <Image
            accessibilityLabel="View Once photo"
            source={{ uri: attachment.localUri ?? attachment.url }}
            resizeMode="contain"
            style={previewStyles.image}
          />
        ) : attachment.kind === "video" ? (
          <ProtectedVideoPreview
            uri={attachment.localUri ?? attachment.url}
            onFinished={onClose}
          />
        ) : (
          <ProtectedAudioPreview
            uri={attachment.localUri ?? attachment.url}
            onFinished={onClose}
          />
        )}
        {screenshotDetected || captureProtectionMessage ? (
          <Text style={previewStyles.captureNotice}>
            {screenshotDetected
              ? "A screenshot was detected. External cameras cannot be prevented."
              : captureProtectionMessage}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close View Once media"
          onPress={onClose}
          style={previewStyles.closeButton}
        >
          <X color="#FFFFFF" size={24} />
        </Pressable>
      </View>
    </Modal>
  );
}

function ProtectedVideoPreview({
  uri,
  onFinished,
}: {
  uri: string;
  onFinished: () => void;
}) {
  const player = useVideoPlayer(uri, (videoPlayer) => {
    videoPlayer.loop = false;
    videoPlayer.play();
  });
  useEffect(() => {
    const subscription = player.addListener("playToEnd", onFinished);
    return () => subscription.remove();
  }, [onFinished, player]);
  return (
    <VideoView
      player={player}
      nativeControls={false}
      contentFit="contain"
      style={previewStyles.video}
    />
  );
}

function ProtectedAudioPreview({
  uri,
  onFinished,
}: {
  uri: string;
  onFinished: () => void;
}) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);
  const duration = Number.isFinite(status.duration) ? status.duration : 0;
  const currentTime = Number.isFinite(status.currentTime)
    ? status.currentTime
    : 0;
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
  useEffect(() => {
    player.setPlaybackRate(playbackRate);
  }, [playbackRate, player]);
  useEffect(() => {
    player.play();
    return () => player.pause();
  }, [player]);
  useEffect(() => {
    if (status.didJustFinish) onFinished();
  }, [onFinished, status.didJustFinish]);
  return (
    <View style={previewStyles.protectedAudio}>
      <Mic color="#FFFFFF" size={36} />
      <Text style={previewStyles.protectedAudioTitle}>
        View Once voice note
      </Text>
      <View style={previewStyles.protectedAudioPlayer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            status.isLoaded
              ? status.playing
                ? "Pause View Once voice note"
                : "Resume View Once voice note"
              : "Loading View Once voice note"
          }
          disabled={!status.isLoaded || status.isBuffering}
          onPress={() => (status.playing ? player.pause() : player.play())}
          style={previewStyles.protectedAudioControl}
        >
          {!status.isLoaded || status.isBuffering ? (
            <VeyraLoader
              size={14}
              imageWidth={18}
              imageHeight={18}
              imageMarginBottom={0}
              loaderShown={false}
            />
          ) : status.playing ? (
            <Pause color="#FFFFFF" size={22} />
          ) : (
            <Play color="#FFFFFF" fill="#FFFFFF" size={22} />
          )}
        </Pressable>
        <View style={previewStyles.protectedAudioTrack}>
          <View
            accessibilityLabel={`Voice note playback progress, ${Math.round(progress * 100)}%`}
            accessibilityRole="progressbar"
            style={previewStyles.protectedAudioWaveform}
          >
            {AUDIO_WAVEFORM.map((height, index) => (
              <View
                key={index}
                style={[
                  previewStyles.protectedAudioWaveBar,
                  { height },
                  index / AUDIO_WAVEFORM.length < progress &&
                    previewStyles.protectedAudioWaveBarPlayed,
                ]}
              />
            ))}
          </View>
          <View style={previewStyles.protectedAudioMeta}>
            <Text style={previewStyles.protectedAudioDuration}>
              {!status.isLoaded
                ? "Loading voice note…"
                : `${formatMediaDuration(currentTime)} / ${formatMediaDuration(duration)}`}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Playback speed ${playbackRate} times. Change speed`}
              onPress={() =>
                setPlaybackRate((current) =>
                  current === 1 ? 1.5 : current === 1.5 ? 2 : 1,
                )
              }
              style={previewStyles.protectedAudioSpeedButton}
            >
              <Text style={previewStyles.protectedAudioSpeedText}>
                {playbackRate}x
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

function AudioAttachment({
  attachment,
  isMine,
  colors,
  styles,
  onOpenMessageActions,
}: {
  attachment: NonNullable<ChatMessage["attachment"]>;
  isMine: boolean;
  colors: SystemColors;
  styles: ChatStyles;
  onOpenMessageActions?: () => void;
}) {
  const player = useAudioPlayer(attachment.url);
  const status = useAudioPlayerStatus(player);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);
  const [playbackError, setPlaybackError] = useState("");
  const duration = Number.isFinite(status.duration) ? status.duration : 0;
  const currentTime = Number.isFinite(status.currentTime)
    ? status.currentTime
    : 0;
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
  const isBuffering = !status.isLoaded || status.isBuffering;
  const hasFinished =
    status.didJustFinish || (duration > 0 && currentTime >= duration - 0.15);
  useEffect(() => {
    player.setPlaybackRate(playbackRate);
  }, [playbackRate, player]);

  const togglePlayback = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    setPlaybackError("");
    if (hasFinished) {
      void player
        .seekTo(0)
        .then(() => player.play())
        .catch((error: unknown) => {
          setPlaybackError(
            error instanceof Error
              ? `Could not replay this voice message: ${error.message}`
              : "Could not replay this voice message.",
          );
        });
      return;
    }
    player.play();
  };
  return (
    <View style={styles.audioAttachment}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          isBuffering
            ? "Loading voice message"
            : `${status.playing ? "Pause" : hasFinished ? "Replay" : "Play"} voice message, ${formatMediaDuration(duration)} total`
        }
        disabled={isBuffering}
        onPress={togglePlayback}
        style={styles.audioPlayButton}
      >
        {isBuffering ? (
          <VeyraLoader
            size={14}
            imageWidth={18}
            imageHeight={18}
            imageMarginBottom={0}
            loaderShown={false}
          />
        ) : status.playing ? (
          <Pause color={isMine ? "#331B1D" : CHAT_ACCENT} size={19} />
        ) : (
          <Play color={isMine ? "#331B1D" : CHAT_ACCENT} size={19} />
        )}
      </Pressable>
      <View style={styles.audioPlaybackInfo}>
        <View style={styles.audioWaveform}>
          {AUDIO_WAVEFORM.map((height, index) => (
            <View
              key={index}
              style={[
                styles.audioWaveBar,
                { height },
                index / AUDIO_WAVEFORM.length < progress &&
                  (isMine
                    ? styles.audioWaveBarActiveMine
                    : styles.audioWaveBarActive),
              ]}
            />
          ))}
        </View>
        <Text
          style={[styles.audioAttachmentText, isMine && styles.messageBodyMine]}
        >
          {isBuffering
            ? "Loading voice note…"
            : `${formatMediaDuration(currentTime)} / ${formatMediaDuration(duration)}`}
        </Text>
        {playbackError ? (
          <Text accessibilityRole="alert" style={styles.audioPlaybackError}>
            {playbackError}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Playback speed ${playbackRate} times. Change speed`}
        onPress={() =>
          setPlaybackRate((current) =>
            current === 1 ? 1.5 : current === 1.5 ? 2 : 1,
          )
        }
        style={styles.audioSpeedButton}
      >
        <Text
          style={[
            styles.audioSpeedText,
            { color: isMine ? "#331B1D" : colors.textSecondary },
          ]}
        >
          {playbackRate}x
        </Text>
      </Pressable>
      {onOpenMessageActions ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Voice message options"
          onPress={onOpenMessageActions}
          style={styles.audioActionsButton}
        >
          <ChevronDown
            color={isMine ? "#331B1D" : colors.textSecondary}
            size={17}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function RecordingStatusRow({
  metering,
  duration,
  styles,
}: {
  metering: number | null | undefined;
  duration: number;
  styles: ChatStyles;
}) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  const level = Math.max(0, Math.min(1, ((metering ?? -60) + 60) / 60));
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Recording voice message, ${formatMediaDuration(duration)}`}
      style={styles.recordingStatusRow}
    >
      <Animated.View style={[styles.recordingIndicator, { opacity: pulse }]} />
      <Text style={styles.recordingStatusText}>Recording</Text>
      <View style={styles.recordingWaveform}>
        {AUDIO_WAVEFORM.slice(0, 14).map((height, index) => (
          <View
            key={index}
            style={[
              styles.recordingWaveBar,
              { height: 4 + level * (height / 2) },
            ]}
          />
        ))}
      </View>
      <Text style={styles.recordingDuration}>
        {formatMediaDuration(duration)}
      </Text>
    </View>
  );
}

const AUDIO_WAVEFORM = [
  8, 13, 18, 11, 22, 16, 10, 19, 25, 14, 9, 17, 23, 12, 19, 10, 15, 21, 12, 8,
];

const previewStyles = StyleSheet.create({
  voicePreviewScreen: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: Platform.OS === "ios" ? 70 : 48,
    paddingBottom: 28,
  },
  voicePreviewContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  voicePreviewIcon: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 34,
    marginBottom: 8,
  },
  voicePreviewTitle: {
    fontSize: 22,
    fontWeight: "700",
  },
  voicePreviewDescription: {
    fontSize: 14,
  },
  voicePreviewPrivacy: {
    width: "100%",
    maxWidth: 340,
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 16,
  },
  voicePreviewPrivacyCopy: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  voicePreviewBadge: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  voicePreviewPrivacyTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  voicePreviewPrivacyCopyText: {
    maxWidth: 220,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  voicePreviewActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
  },
  screen: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "#000000",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  galleryArea: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  galleryTrack: {
    height: "100%",
    flexDirection: "row",
  },
  galleryPage: {
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  galleryArrow: {
    position: "absolute",
    top: "50%",
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -22,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  galleryArrowLeft: {
    left: 14,
  },
  galleryArrowRight: {
    right: 14,
  },
  galleryCounter: {
    position: "absolute",
    top: 54,
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  galleryCounterText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  video: {
    width: "100%",
    height: "100%",
  },
  messageVideo: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 12,
  },
  closeButton: {
    position: "absolute",
    top: 48,
    right: 18,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sendPreviewScreen: {
    flex: 1,
    justifyContent: "space-between",
    paddingTop: 54,
    paddingBottom: 28,
  },
  sendPreviewMedia: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 18,
  },
  sendPreviewFooter: {
    paddingHorizontal: 22,
    paddingTop: 18,
    gap: 10,
  },
  sendPreviewTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  sendPreviewDisclosure: {
    fontSize: 12,
    lineHeight: 18,
  },
  sendPreviewActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 5,
  },
  sendPreviewButton: {
    minHeight: 48,
    flex: 1,
    borderWidth: 1,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  captureNotice: {
    position: "absolute",
    bottom: 36,
    alignSelf: "center",
    marginHorizontal: 32,
    color: "#FFFFFF",
    textAlign: "center",
    fontSize: 12,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  protectedAudio: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    width: "100%",
    paddingHorizontal: 28,
  },
  protectedAudioPlayer: {
    width: "100%",
    maxWidth: 420,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  protectedAudioTrack: {
    flex: 1,
    gap: 8,
  },
  protectedAudioWaveform: {
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 3,
  },
  protectedAudioWaveBar: {
    width: 3,
    minHeight: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  protectedAudioWaveBarPlayed: {
    backgroundColor: CHAT_ACCENT,
  },
  protectedAudioMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  protectedAudioTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  protectedAudioDuration: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  protectedAudioSpeedButton: {
    minWidth: 42,
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.13)",
  },
  protectedAudioSpeedText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  protectedAudioControl: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
});

function formatMediaDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Size unavailable";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isExpiredSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /session.{0,40}(invalid|expired)|(invalid|expired).{0,40}session|jwt.{0,20}(invalid|expired)|(invalid|expired).{0,20}jwt/i.test(
    message,
  );
}

function LockChatsPinModal({
  styles,
  colors,
  visible,
  title,
  description,
  busy,
  error,
  reset = false,
  onCancel,
  onSubmit,
  onSubmitReset,
}: {
  styles: ChatStyles;
  colors: SystemColors;
  visible: boolean;
  title: string;
  description: string;
  busy: boolean;
  error: string;
  reset?: boolean;
  onCancel: () => void;
  onSubmit?: (pin: string) => void;
  onSubmitReset?: (password: string, pin: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [pinVisible, setPinVisible] = useState(false);
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    if (!visible) {
      setPin("");
      setConfirmation("");
      setPassword("");
      setPasswordVisible(false);
      setPinVisible(false);
      setConfirmationVisible(false);
      setValidationError("");
    }
  }, [visible]);

  const submit = () => {
    setValidationError("");
    if (!/^\d{6}$/.test(pin)) {
      setValidationError("Enter a six-digit PIN.");
      return;
    }
    if (pin !== confirmation) {
      setValidationError("The PINs don’t match.");
      return;
    }
    if (reset) {
      if (!password) {
        setValidationError("Enter your account password.");
        return;
      }
      onSubmitReset?.(password, pin);
      return;
    }
    onSubmit?.(pin);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.safetyModal}>
          <Text style={styles.safetyTitle}>{title}</Text>
          <Text style={styles.safetyCopy}>{description}</Text>
          {reset ? (
            <View style={styles.pinInputWrap}>
              <TextInput
                accessibilityLabel="Account password"
                value={password}
                onChangeText={setPassword}
                placeholder="Account password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!passwordVisible}
                autoCapitalize="none"
                autoComplete="current-password"
                editable={!busy}
                style={styles.pinInput}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  passwordVisible ? "Hide account password" : "Show account password"
                }
                disabled={busy}
                hitSlop={8}
                onPress={() => setPasswordVisible((visible) => !visible)}
                style={styles.pinInputVisibility}
              >
                {passwordVisible ? (
                  <EyeOff color={colors.textSecondary} size={18} />
                ) : (
                  <Eye color={colors.textSecondary} size={18} />
                )}
              </Pressable>
            </View>
          ) : null}
          <View style={styles.pinInputWrap}>
            <TextInput
              accessibilityLabel="Six-digit PIN"
              value={pin}
              onChangeText={(value) => {
                setPin(value.replace(/\D/g, "").slice(0, 6));
                setValidationError("");
              }}
              placeholder="Six-digit PIN"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              secureTextEntry={!pinVisible}
              maxLength={6}
              editable={!busy}
              style={styles.pinInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={pinVisible ? "Hide PIN" : "Show PIN"}
              disabled={busy}
              hitSlop={8}
              onPress={() => setPinVisible((visible) => !visible)}
              style={styles.pinInputVisibility}
            >
              {pinVisible ? (
                <EyeOff color={colors.textSecondary} size={18} />
              ) : (
                <Eye color={colors.textSecondary} size={18} />
              )}
            </Pressable>
          </View>
          <View style={styles.pinInputWrap}>
            <TextInput
              accessibilityLabel="Confirm six-digit PIN"
              value={confirmation}
              onChangeText={(value) => {
                setConfirmation(value.replace(/\D/g, "").slice(0, 6));
                setValidationError("");
              }}
              placeholder="Confirm PIN"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              secureTextEntry={!confirmationVisible}
              maxLength={6}
              editable={!busy}
              style={styles.pinInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                confirmationVisible ? "Hide PIN confirmation" : "Show PIN confirmation"
              }
              disabled={busy}
              hitSlop={8}
              onPress={() =>
                setConfirmationVisible((visible) => !visible)
              }
              style={styles.pinInputVisibility}
            >
              {confirmationVisible ? (
                <EyeOff color={colors.textSecondary} size={18} />
              ) : (
                <Eye color={colors.textSecondary} size={18} />
              )}
            </Pressable>
          </View>
          {validationError || error ? (
            <Text accessibilityRole="alert" style={styles.pinModalError}>
              {validationError || error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={submit}
            style={[styles.safetyConfirm, busy && styles.sendButtonDisabled]}
          >
            {busy ? (
              <VeyraLoader
                size={12}
                imageWidth={16}
                imageHeight={16}
                imageMarginBottom={0}
                loaderShown={false}
              />
            ) : (
              <Text style={styles.safetyConfirmText}>
                {reset ? "Verify and reset PIN" : "Save PIN"}
              </Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onCancel}
            style={styles.modalCancel}
          >
            <Text style={styles.modalCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SafetyModal({
  action,
  styles,
  colors,
  setAction,
  isLocked,
  onToggleLock,
  reportReason,
  setReportReason,
  isSaving,
  reportedMessage,
  onConfirm,
}: {
  action: SafetyAction;
  styles: ChatStyles;
  colors: SystemColors;
  setAction: (action: SafetyAction) => void;
  isLocked: boolean;
  onToggleLock: () => void;
  reportReason: ReportReason;
  setReportReason: (reason: ReportReason) => void;
  isSaving: boolean;
  reportedMessage: boolean;
  onConfirm: () => void;
}) {
  const title =
    action === "menu"
      ? "Your safety comes first"
      : action === "report-message"
        ? "Report this message"
        : action === "report"
          ? "Report this member"
          : action === "block"
            ? "Block this member?"
            : "Unmatch?";
  const copy =
    action === "menu"
      ? "Choose how you’d like to manage this connection."
      : action === "report-message"
        ? "Your report is private and will be reviewed by VEYRA."
        : action === "report"
          ? "Your report is private and will be reviewed by VEYRA."
          : action === "block"
            ? "They won’t be able to message you or see you in discovery."
            : "This ends the match and closes your conversation.";
  return (
    <Modal
      visible={action !== null}
      transparent
      animationType="fade"
      onRequestClose={() => setAction(null)}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.safetyModal}>
          {action === "menu" ? (
            <View style={styles.safetyHeader}>
              <View style={styles.safetyHeaderIcon}>
                <ShieldCheck color={CHAT_ACCENT} size={24} />
              </View>
              <Text style={styles.safetyTitle}>{title}</Text>
              <Text style={styles.safetyCopy}>{copy}</Text>
            </View>
          ) : (
            <>
              <Text style={styles.safetyTitle}>{title}</Text>
              <Text style={styles.safetyCopy}>{copy}</Text>
            </>
          )}
          {action === "menu" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Unmatch. End this match and remove the conversation."
              onPress={() => setAction("unmatch")}
              style={({ pressed }) => [
                styles.safetyMenuItem,
                pressed && styles.safetyMenuItemPressed,
              ]}
            >
              <View style={styles.safetyMenuIcon}>
                <HeartCrack color={colors.textSecondary} size={18} />
              </View>
              <View style={styles.safetyMenuContent}>
                <Text style={styles.safetyMenuText}>Unmatch</Text>
                <Text style={styles.safetyMenuDescription}>
                  End this match and remove the conversation.
                </Text>
              </View>
              <ChevronRight color={colors.textSecondary} size={18} />
            </Pressable>
          ) : null}
          {action === "menu" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isLocked ? "Unlock this conversation" : "Lock this conversation"
              }
              onPress={onToggleLock}
              style={({ pressed }) => [
                styles.safetyMenuItem,
                pressed && styles.safetyMenuItemPressed,
              ]}
            >
              <View style={styles.safetyMenuIcon}>
                {isLocked ? (
                  <LockKeyholeOpen color={colors.textSecondary} size={18} />
                ) : (
                  <LockKeyhole color={colors.textSecondary} size={18} />
                )}
              </View>
              <View style={styles.safetyMenuContent}>
                <Text style={styles.safetyMenuText}>
                  {isLocked ? "Unlock conversation" : "Lock conversation"}
                </Text>
                <Text style={styles.safetyMenuDescription}>
                  {isLocked
                    ? "Return this conversation to your regular inbox."
                    : "Hide this conversation from your regular inbox."}
                </Text>
              </View>
              <ChevronRight color={colors.textSecondary} size={18} />
            </Pressable>
          ) : null}
          {action === "menu" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Block this member. Prevent contact and hide each other."
              onPress={() => setAction("block")}
              style={({ pressed }) => [
                styles.safetyMenuItem,
                pressed && styles.safetyMenuItemPressed,
              ]}
            >
              <View style={styles.safetyMenuIcon}>
                <Ban color={colors.error} size={18} />
              </View>
              <View style={styles.safetyMenuContent}>
                <Text
                  style={[styles.safetyMenuText, styles.safetyDestructiveText]}
                >
                  Block this member
                </Text>
                <Text style={styles.safetyMenuDescription}>
                  Prevent contact and hide each other.
                </Text>
              </View>
              <ChevronRight color={colors.textSecondary} size={18} />
            </Pressable>
          ) : null}
          {action === "menu" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Report this member. Let our team know about a concern."
              onPress={() => setAction("report")}
              style={({ pressed }) => [
                styles.safetyMenuItem,
                pressed && styles.safetyMenuItemPressed,
              ]}
            >
              <View style={styles.safetyMenuIcon}>
                <Flag color={colors.textSecondary} size={18} />
              </View>
              <View style={styles.safetyMenuContent}>
                <Text style={styles.safetyMenuText}>Report this member</Text>
                <Text style={styles.safetyMenuDescription}>
                  Let our team know about a concern.
                </Text>
              </View>
              <ChevronRight color={colors.textSecondary} size={18} />
            </Pressable>
          ) : null}
          {action === "report" || action === "report-message"
            ? REPORT_REASONS.map((reason) => (
                <Pressable
                  key={`${reason.value}-${reason.label}`}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: reportReason === reason.value,
                  }}
                  onPress={() => setReportReason(reason.value)}
                  style={styles.reportReason}
                >
                  <Text
                    style={[
                      styles.safetyMenuText,
                      reportReason === reason.value && styles.reportSelected,
                    ]}
                  >
                    {reportReason === reason.value ? "●  " : "○  "}
                    {reason.label}
                  </Text>
                </Pressable>
              ))
            : null}
          {action === "report" ||
          action === "report-message" ||
          action === "block" ? (
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={onConfirm}
              style={styles.safetyConfirm}
            >
              <Text style={styles.safetyConfirmText}>
                {isSaving
                  ? "Saving…"
                  : action === "report" || reportedMessage
                    ? "Submit report"
                    : "Block member"}
              </Text>
            </Pressable>
          ) : null}
          {action === "unmatch" ? (
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={onConfirm}
              style={styles.safetyConfirm}
            >
              <Text style={styles.safetyConfirmText}>
                {isSaving ? "Saving…" : "Unmatch"}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => setAction(null)}
            style={styles.modalCancel}
          >
            <Text style={styles.modalCancelText}>
              {action === "menu" ? "Close" : "Cancel"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function MessageActionMenu({
  message,
  isMine,
  styles,
  colors,
  onClose,
  onCopy,
  onReply,
  onReact,
  onDelete,
  onDeleteForEveryone,
  onReport,
}: {
  message: ChatMessage | null;
  isMine: boolean;
  styles: ChatStyles;
  colors: SystemColors;
  onClose: () => void;
  onCopy: () => void;
  onReply: () => void;
  onReact: (reaction: ChatReactionValue) => void;
  onDelete: () => void;
  onDeleteForEveryone: () => void;
  onReport: () => void;
}) {
  const [page, setPage] = useState<
    "actions" | "reactions" | "delete" | "deleteForEveryone"
  >("actions");
  useEffect(() => setPage("actions"), [message]);

  return (
    <Modal
      visible={message !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.messageActionBackdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close message actions"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.messageActionSheet,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View
            style={[
              styles.messageActionHandle,
              { backgroundColor: colors.border },
            ]}
          />
          <Text style={[styles.messageActionHeading, { color: colors.text }]}>
            {page === "actions"
              ? "Message options"
              : page === "reactions"
                ? "Choose a reaction"
                : page === "delete"
                  ? "Delete for you?"
                  : "Delete this message for everyone?"}
          </Text>
          {page === "actions" ? (
            <>
              <MessageActionButton
                icon={<Reply color={CHAT_ACCENT} size={19} />}
                label="Reply"
                styles={styles}
                colors={colors}
                onPress={onReply}
              />
              <MessageActionButton
                icon={<Copy color={CHAT_ACCENT} size={18} />}
                label="Copy message"
                styles={styles}
                colors={colors}
                onPress={onCopy}
              />
              <MessageActionButton
                icon={<Smile color={CHAT_ACCENT} size={18} />}
                label="React"
                styles={styles}
                colors={colors}
                onPress={() => setPage("reactions")}
              />
              <MessageActionButton
                icon={<Trash2 color={colors.error} size={18} />}
                label="Delete for me"
                destructive
                styles={styles}
                colors={colors}
                onPress={() => setPage("delete")}
              />
              {isMine ? (
                <MessageActionButton
                  icon={<Trash2 color={colors.error} size={18} />}
                  label="Delete for everyone"
                  destructive
                  styles={styles}
                  colors={colors}
                  onPress={() => setPage("deleteForEveryone")}
                />
              ) : (
                <MessageActionButton
                  icon={<Flag color={colors.error} size={18} />}
                  label="Report message"
                  destructive
                  styles={styles}
                  colors={colors}
                  onPress={onReport}
                />
              )}
            </>
          ) : page === "reactions" ? (
            <>
              <View style={styles.messageReactionChoices}>
                {MESSAGE_REACTIONS.map((reaction) => (
                  <Pressable
                    key={reaction.value}
                    accessibilityRole="button"
                    accessibilityLabel={`React with ${reaction.label}`}
                    onPress={() => {
                      onReact(reaction.value);
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.messageReactionChoice,
                      {
                        backgroundColor: pressed
                          ? colors.surfaceSecondary
                          : colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text style={styles.messageReactionChoiceEmoji}>
                      {reaction.emoji}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <MessageActionButton
                icon={<ChevronRight color={colors.textMuted} size={18} />}
                label="Back"
                styles={styles}
                colors={colors}
                onPress={() => setPage("actions")}
              />
            </>
          ) : page === "delete" ? (
            <>
              <Text
                style={[
                  styles.messageDeleteExplanation,
                  { color: colors.textSecondary },
                ]}
              >
                This removes the message from your conversation only. The other
                person can still see it.
              </Text>
              <MessageActionButton
                icon={<Trash2 color={colors.error} size={18} />}
                label="Delete for me"
                destructive
                styles={styles}
                colors={colors}
                onPress={() => {
                  onDelete();
                  onClose();
                }}
              />
              <MessageActionButton
                icon={<ChevronRight color={colors.textMuted} size={18} />}
                label="Back"
                styles={styles}
                colors={colors}
                onPress={() => setPage("actions")}
              />
            </>
          ) : (
            <>
              <Text
                style={[
                  styles.messageDeleteExplanation,
                  { color: colors.textSecondary },
                ]}
              >
                This removes the message for everyone in the conversation.
                Reported content is retained securely for moderation.
              </Text>
              <MessageActionButton
                icon={<Trash2 color={colors.error} size={18} />}
                label="Delete this message for everyone?"
                destructive
                styles={styles}
                colors={colors}
                onPress={() => {
                  onDeleteForEveryone();
                  onClose();
                }}
              />
              <MessageActionButton
                icon={<ChevronRight color={colors.textMuted} size={18} />}
                label="Back"
                styles={styles}
                colors={colors}
                onPress={() => setPage("actions")}
              />
            </>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.messageActionCancel, { borderColor: colors.border }]}
          >
            <Text
              style={[
                styles.messageActionCancelText,
                { color: colors.textSecondary },
              ]}
            >
              Cancel
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function MessageActionButton({
  icon,
  label,
  destructive = false,
  styles,
  colors,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  styles: ChatStyles;
  colors: SystemColors;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.messageActionRow,
        { backgroundColor: pressed ? colors.surfaceSecondary : colors.surface },
      ]}
    >
      <View
        style={[
          styles.messageActionIcon,
          { backgroundColor: colors.surfaceSecondary },
        ]}
      >
        {icon}
      </View>
      <Text
        style={[
          styles.messageActionLabel,
          { color: destructive ? colors.error : colors.text },
        ]}
      >
        {label}
      </Text>
      <ChevronRight color={colors.textMuted} size={17} />
    </Pressable>
  );
}

function AttachmentActionMenu({
  visible,
  styles,
  colors,
  disabled,
  viewOnceEnabled,
  onToggleViewOnce,
  onClose,
  onChooseLibrary,
  onChooseCamera,
}: {
  visible: boolean;
  styles: ChatStyles;
  colors: SystemColors;
  disabled: boolean;
  viewOnceEnabled: boolean;
  onToggleViewOnce: (enabled: boolean) => void;
  onClose: () => void;
  onChooseLibrary: () => void;
  onChooseCamera: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.messageActionBackdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close attachment options"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.messageActionSheet,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View
            style={[
              styles.messageActionHandle,
              { backgroundColor: colors.border },
            ]}
          />
          <Text style={[styles.messageActionHeading, { color: colors.text }]}>
            Share a moment
          </Text>
          <MessageActionButton
            icon={<ImagePickerIcon color={CHAT_ACCENT} />}
            label="Photos & videos"
            styles={styles}
            colors={colors}
            onPress={onChooseLibrary}
          />
          <MessageActionButton
            icon={<Camera color={CHAT_ACCENT} size={19} />}
            label="Open camera"
            styles={styles}
            colors={colors}
            onPress={onChooseCamera}
          />
          <View style={[styles.viewOnceOption, { borderColor: colors.border }]}>
            <View style={styles.viewOnceOptionCopy}>
              <Eye color={CHAT_ACCENT} size={18} />
              <View style={styles.viewOnceOptionText}>
                <Text
                  style={[styles.viewOnceOptionTitle, { color: colors.text }]}
                >
                  Default to View Once
                </Text>
                <Text
                  style={[
                    styles.viewOnceOptionDescription,
                    { color: colors.textSecondary },
                  ]}
                >
                  Applied to newly selected media; change items individually
                  before sending.
                </Text>
              </View>
            </View>
            <Switch
              accessibilityLabel="Send as View Once"
              value={viewOnceEnabled}
              disabled={disabled}
              onValueChange={onToggleViewOnce}
              trackColor={{ false: colors.border, true: CHAT_ACCENT }}
              thumbColor={colors.surface}
            />
          </View>
          <Text
            style={[styles.viewOnceDisclosure, { color: colors.textSecondary }]}
          >
            Screenshots and recordings are blocked where supported; another
            camera may still capture the screen.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={onClose}
            style={[styles.messageActionCancel, { borderColor: colors.border }]}
          >
            <Text
              style={[
                styles.messageActionCancelText,
                { color: colors.textSecondary },
              ]}
            >
              Cancel
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ImagePickerIcon({ color }: { color: string }) {
  return <Paperclip color={color} size={19} />;
}

function ProfileModal({
  person,
  colors,
  isOnline,
  styles,
  onClose,
}: {
  person: ChatPerson | null;
  colors: SystemColors;
  isOnline: boolean;
  styles: ChatStyles;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={person !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.profileModalBackdrop}>
        <View style={styles.profileModal}>
          {person ? (
            <>
              <ProfilePhotoGallery
                photos={
                  person.photos.length
                    ? person.photos
                    : person.image
                      ? [person.image]
                      : []
                }
                height={180}
                accentColor={CHAT_ACCENT}
                surfaceColor={colors.surfaceSecondary}
                borderColor={colors.border}
                textColor={colors.textSecondary}
                previewOnly
                previewShape="circle"
                placeholder={
                  <Text style={styles.profileHeroInitial}>
                    {person.name.trim().slice(0, 1).toUpperCase()}
                  </Text>
                }
                renderOverlay={() => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close profile"
                    onPress={onClose}
                    style={styles.profileCloseButton}
                  >
                    <X color="#FFFFFF" size={22} />
                  </Pressable>
                )}
              />
              <View style={styles.profileHeroCopy}>
                <View style={styles.profileNameLine}>
                  <Text numberOfLines={1} style={styles.profileHeroName}>
                    {person.name}
                    {person.age === null ? "" : `, ${person.age}`}
                  </Text>
                  {person.identityVerified ? (
                    <IdentityVerifiedBadge colors={colors} compact />
                  ) : null}
                </View>
                {person.city ? (
                  <Text numberOfLines={1} style={styles.profileHeroMeta}>
                    {person.city}
                  </Text>
                ) : null}
              </View>
              <ScrollView
                style={styles.profileDetailsScroll}
                contentContainerStyle={styles.profileDetails}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.profileStatusRow}>
                  <View style={styles.profileConnectionBadge}>
                    <Heart color={CHAT_ACCENT} fill={CHAT_ACCENT} size={14} />
                    <Text style={styles.profileConnectionText}>Your match</Text>
                  </View>
                  <View style={styles.profileOnlineBadge}>
                    <View
                      style={[
                        styles.onlineStatusDot,
                        isOnline && styles.onlineStatusDotActive,
                      ]}
                    />
                    <Text
                      style={[
                        styles.profileOnlineText,
                        isOnline && styles.onlineStatusTextActive,
                      ]}
                    >
                      {isOnline ? "Online" : "Offline"}
                    </Text>
                  </View>
                </View>
                {person.occupation ? (
                  <View style={styles.profileSection}>
                    <Text style={styles.profileSectionTitle}>Occupation</Text>
                    <Text style={styles.profileSectionCopy}>
                      {person.occupation}
                    </Text>
                  </View>
                ) : null}
                {person.bio ? (
                  <View style={styles.profileSection}>
                    <Text style={styles.profileSectionTitle}>About</Text>
                    <Text style={styles.profileSectionCopy}>{person.bio}</Text>
                  </View>
                ) : null}
                {person.interests.length ? (
                  <View style={styles.profileSection}>
                    <Text style={styles.profileSectionTitle}>Interests</Text>
                    <View style={styles.profileChipList}>
                      {person.interests.map((interest) => (
                        <Text key={interest} style={styles.profileChip}>
                          {interest}
                        </Text>
                      ))}
                    </View>
                  </View>
                ) : null}
                {person.intentions.length ? (
                  <View style={styles.profileSection}>
                    <Text style={styles.profileSectionTitle}>Looking for</Text>
                    <View style={styles.profileChipList}>
                      {person.intentions.map((intention) => (
                        <Text key={intention} style={styles.profileChip}>
                          {intention}
                        </Text>
                      ))}
                    </View>
                  </View>
                ) : null}
              </ScrollView>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function formatConversationTime(value: string): string {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatMessageTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getMessageDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatMessageDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const today = new Date();
  if (getMessageDateKey(value) === getMessageDateKey(today.toISOString())) {
    return "Today";
  }
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (getMessageDateKey(value) === getMessageDateKey(yesterday.toISOString())) {
    return "Yesterday";
  }
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}

const createStyles = (colors: SystemColors) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      // minHeight: 0,
      // paddingTop: 8,
      // paddingHorizontal: 10,
    },
    listHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 15,
    },
    listHeaderCopy: {
      flex: 1,
    },
    headerFilterButton: {
      width: 42,
      height: 42,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surfaceSecondary,
    },
    headerFilterButtonActive: {
      borderColor: CHAT_ACCENT,
      backgroundColor: CHAT_ACCENT,
    },
    eyebrow: {
      color: CHAT_ACCENT,
      fontSize: 9,
      fontWeight: "700",
      letterSpacing: 1.8,
    },
    title: {
      color: colors.primary,
      fontSize: 26,
      fontWeight: "700",
      marginTop: 3,
    },
    subtitle: {
      color: colors.textSecondary,

      fontSize: 12,
      marginTop: 4,
    },
    searchSection: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    messageViewToggle: {
      width: 43,
      height: 43,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.surfaceSecondary,
    },
    searchWrap: {
      flex: 1,
      minHeight: 43,
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.inputBackground,
    },
    searchIcon: {
      color: colors.textSecondary,
      fontSize: 22,
      marginRight: 8,
    },
    searchSubmit: {
      width: 28,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 6,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: 12,
      paddingVertical: 9,
    },
    pinEntryHelp: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 6,
    },
    pinError: {
      color: colors.error,
      fontSize: 11,
      lineHeight: 16,
    },
    pinResetLink: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: "600",
      paddingVertical: 4,
      paddingHorizontal: 2,
    },
    clearSearch: {
      color: colors.textSecondary,
      fontSize: 20,
      paddingHorizontal: 4,
    },
    filters: {
      flexDirection: "row",
      gap: 7,
      marginTop: 12,
      marginBottom: 9,
    },
    filterButton: {
      minWidth: 38,
      height: 34,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
      paddingHorizontal: 8,
      borderRadius: 12,
      backgroundColor: colors.surfaceSecondary,
    },
    filterButtonActive: {
      backgroundColor: CHAT_ACCENT,
    },
    filterCount: {
      color: colors.textSecondary,
      fontSize: 9,
      fontWeight: "700",
    },
    filterCountActive: {
      color: "#331B1D",
    },
    conversationList: {
      flexGrow: 1,
      paddingBottom: 12,
    },
    onlinePeopleRow: {
      minHeight: 43,
      maxHeight: 43,
      flexGrow: 1,
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.inputBackground,
    },
    onlinePeopleScroll: {
      flex: 1,
    },
    onlinePerson: {
      maxWidth: 130,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    onlinePersonAvatar: {
      position: "relative",
      width: 30,
      height: 30,
      flexShrink: 0,
    },
    onlinePersonDot: {
      position: "absolute",
      right: 0,
      bottom: 0,
      width: 9,
      height: 9,
      borderWidth: 2,
      borderColor: colors.background,
      borderRadius: 5,
      backgroundColor: colors.online,
    },
    onlinePersonName: {
      maxWidth: 90,
      color: colors.text,
      fontSize: 10,
      fontWeight: "700",
      flexShrink: 1,
    },
    onlineEmpty: {
      height: 43,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.inputBackground,
    },
    onlineEmptyInRow: {
      flex: 1,
    },
    onlineEmptyText: {
      color: colors.textSecondary,
      fontSize: 12,
    },
    newMatchesWrap: {
      marginBottom: 16,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "700",
      marginBottom: 10,
    },
    newMatchesRow: {
      gap: 12,
    },
    newMatchCard: {
      width: 82,
      alignItems: "center",
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    newMatchName: {
      maxWidth: 74,
      color: colors.text,
      fontSize: 10,
      fontWeight: "700",
      marginTop: 6,
    },
    newMatchLabel: {
      color: CHAT_ACCENT,
      fontSize: 9,
      marginTop: 3,
    },
    conversationRow: {
      minHeight: 78,
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 10,
    },
    conversationRowWrap: {
      minHeight: 78,
      flexDirection: "row",
      alignItems: "center",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    archiveButton: {
      width: 42,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
    },
    conversationAvatar: {
      position: "relative",
    },
    avatarOnlineDot: {
      position: "absolute",
      right: 0,
      bottom: 1,
      width: 13,
      height: 13,
      borderRadius: 7,
      borderWidth: 2,
      borderColor: colors.background,
      backgroundColor: colors.online,
    },
    onlineLabel: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginLeft: 2,
    },
    onlineLabelDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.online,
    },
    onlineLabelText: {
      color: colors.online,
      fontSize: 10,
      fontWeight: "700",
    },
    avatar: {
      backgroundColor: colors.surfaceSecondary,
    },
    avatarPlaceholder: {
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceSecondary,
    },
    avatarInitial: {
      color: CHAT_ACCENT,
      fontSize: 20,
      fontWeight: "600",
    },
    conversationCopy: {
      flex: 1,
      marginLeft: 12,
      marginRight: 8,
    },
    conversationNameLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    conversationName: {
      flexShrink: 1,
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
    },
    conversationPreview: {
      color: colors.textSecondary,
      fontSize: 11,
      marginTop: 5,
    },
    conversationPreviewUnread: {
      color: colors.text,
      fontWeight: "600",
    },
    conversationMeta: {
      alignItems: "flex-end",
      justifyContent: "center",
      gap: 7,
    },
    conversationTime: {
      color: colors.textSecondary,
      fontSize: 9,
    },
    presenceError: {
      color: colors.error,
      fontSize: 11,
      paddingHorizontal: 16,
      paddingVertical: 6,
    },
    unreadBadge: {
      minWidth: 18,
      height: 18,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 5,
      borderRadius: 9,
      backgroundColor: colors.success,
    },
    unreadBadgeText: {
      color: colors.textInverse,
      fontSize: 9,
      fontWeight: "700",
    },
    safetyFooter: {
      color: colors.textMuted,
      fontSize: 9,
      textAlign: "center",
      paddingVertical: 8,
    },
    stateWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 22,
    },
    error: {
      color: colors.error,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "center",
      marginVertical: 8,
    },
    notice: {
      color: colors.success,
      fontSize: 11,
      marginBottom: 8,
    },
    retryButton: {
      alignSelf: "center",
      paddingHorizontal: 18,
      paddingVertical: 10,
      marginTop: 12,
      borderRadius: 20,
      backgroundColor: CHAT_ACCENT,
    },
    retryText: {
      color: "#331B1D",
      fontSize: 11,
      fontWeight: "700",
    },
    empty: {
      alignItems: "center",
      paddingHorizontal: 26,
      paddingVertical: 38,
    },
    emptyMark: {
      color: CHAT_ACCENT,
      fontSize: 29,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: "700",
      textAlign: "center",
      marginTop: 10,
    },
    emptyBody: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 17,
      textAlign: "center",
      marginTop: 6,
    },
    chatHeader: {
      minHeight: 64,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 8,
      paddingBottom: 10,
      paddingTop: 7,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
      backgroundColor: colors.background,
    },
    headerIconButton: {
      width: 40,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 22,
      backgroundColor: colors.surfaceSecondary,
    },
    headerIcon: {
      color: CHAT_ACCENT,
      fontSize: 32,
      lineHeight: 34,
    },
    chatHeaderPerson: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 44,
    },
    chatHeaderAvatarWrap: {
      width: 48,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: CHAT_ACCENT,
      borderRadius: 24,
    },
    chatHeaderPresence: {
      position: "absolute",
      right: 1,
      bottom: 2,
      width: 11,
      height: 11,
      borderRadius: 6,
      borderWidth: 2,
      borderColor: colors.background,
      backgroundColor: colors.textMuted,
    },
    chatHeaderPresenceOnline: {
      backgroundColor: colors.online,
    },
    chatHeaderCopy: {
      flex: 1,
    },
    nameWithBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    chatHeaderName: {
      flexShrink: 1,
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
    },
    chatHeaderSubtitle: {
      color: colors.textSecondary,
      fontSize: 10,
      marginLeft: 6,
    },
    onlineStatus: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: 3,
    },
    onlineStatusDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.textMuted,
    },
    onlineStatusDotActive: {
      backgroundColor: colors.online,
    },
    onlineStatusTextActive: {
      color: colors.online,
    },
    messageScroll: {
      flex: 1,
      minHeight: 0,
    },
    messageList: {
      flexGrow: 1,
      paddingHorizontal: 5,
      paddingTop: 12,
      paddingBottom: 14,
    },
    connectionIntro: {
      alignItems: "center",
      paddingHorizontal: 24,
      paddingVertical: 18,
      marginBottom: 12,
      borderRadius: 19,
      backgroundColor: colors.surfaceSecondary,
    },
    connectionIntroTitle: {
      color: CHAT_ACCENT,
      fontSize: 16,
      fontWeight: "700",
      marginTop: 9,
    },
    connectionIntroCopy: {
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 17,
      textAlign: "center",
      marginTop: 6,
    },
    starterPrompts: {
      width: "100%",
      gap: 7,
      marginTop: 16,
    },
    starterPromptsTitle: {
      color: colors.textSecondary,
      fontSize: 10,
      fontWeight: "700",
      marginBottom: 2,
    },
    starterPrompt: {
      alignSelf: "stretch",
      paddingHorizontal: 11,
      paddingVertical: 9,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 13,
      backgroundColor: colors.surface,
    },
    starterPromptText: {
      color: colors.text,
      fontSize: 11,
      lineHeight: 16,
    },
    connectionChemistryButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      marginTop: 13,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 17,
      backgroundColor: colors.surface,
    },
    connectionChemistryText: {
      color: CHAT_ACCENT,
      fontSize: 11,
      fontWeight: "700",
    },
    profileLink: {
      paddingHorizontal: 13,
      paddingVertical: 7,
      marginTop: 10,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    profileLinkText: {
      color: CHAT_ACCENT,
      fontSize: 10,
      fontWeight: "700",
    },
    loading: {
      marginVertical: 12,
    },
    messageRow: {
      width: "100%",
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 5,
    },
    messageRowMine: {
      justifyContent: "flex-end",
    },
    messageRowTheirs: {
      justifyContent: "flex-start",
    },
    messageBubble: {
      maxWidth: "82%",
      paddingHorizontal: 14,
      paddingTop: 9,
      paddingBottom: 7,
      borderRadius: 19,
    },
    messageBubbleMine: {
      borderBottomRightRadius: 6,
      backgroundColor: CHAT_ACCENT,
    },
    messageBubbleTheirs: {
      borderBottomLeftRadius: 6,
      backgroundColor: colors.surfaceSecondary,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    messageBubbleDeleted: {
      backgroundColor: colors.surfaceSecondary,
      opacity: 0.72,
    },
    messageBubbleGroupedTopMine: {
      borderTopRightRadius: 7,
    },
    messageBubbleGroupedTopTheirs: {
      borderTopLeftRadius: 7,
    },
    messageBubbleGroupedBottomMine: {
      borderBottomRightRadius: 15,
    },
    messageBubbleGroupedBottomTheirs: {
      borderBottomLeftRadius: 15,
    },
    dateSeparator: {
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      marginVertical: 12,
      paddingHorizontal: 4,
    },
    dateSeparatorLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    dateSeparatorText: {
      color: colors.textMuted,
      fontSize: 9,
      fontWeight: "700",
      letterSpacing: 0.7,
      textTransform: "uppercase",
    },
    unreadDivider: {
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      marginTop: 8,
      marginBottom: 4,
    },
    unreadDividerLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: CHAT_ACCENT,
    },
    unreadDividerText: {
      color: CHAT_ACCENT,
      fontSize: 9,
      fontWeight: "700",
      letterSpacing: 0.6,
    },
    replyQuote: {
      paddingLeft: 9,
      paddingVertical: 5,
      marginBottom: 6,
      borderLeftWidth: 2,
      borderLeftColor: CHAT_ACCENT,
      borderRadius: 2,
      backgroundColor: "rgba(233, 139, 120, 0.10)",
    },
    replyQuoteText: {
      color: CHAT_ACCENT,
      fontSize: 10,
      lineHeight: 14,
      fontWeight: "600",
    },
    messageBody: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    messageBodyMine: {
      color: "#331B1D",
    },
    deletedMessageNotice: {
      color: colors.textSecondary,
      fontSize: 12,
      fontStyle: "italic",
    },
    groupedAttachmentGrid: {
      width: 224,
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 5,
      marginBottom: 3,
    },
    groupedAttachmentItem: {
      width: 108,
      height: 92,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      backgroundColor: colors.surface,
    },
    groupedMediaTile: {
      width: 108,
    },
    groupedViewOnceTile: {
      gap: 7,
    },
    groupedViewOnceUnavailable: {
      opacity: 0.76,
    },
    groupedViewOnceUnavailableLabel: {
      fontWeight: "500",
    },
    groupedViewOnceBadge: {
      position: "absolute",
      top: 5,
      left: 5,
      width: 17,
      height: 17,
      borderRadius: 9,
    },
    groupedViewOnceLabel: {
      fontSize: 10,
      fontWeight: "600",
      textAlign: "center",
    },
    groupedMediaCaption: {
      fontSize: 10,
      lineHeight: 14,
      marginTop: 4,
    },
    groupedAttachmentImage: {
      width: "100%",
      height: "100%",
    },
    mediaLoadingContainer: {
      position: "relative",
      overflow: "hidden",
    },
    mediaLoadingIndicator: {
      ...StyleSheet.absoluteFill,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      backgroundColor: "rgba(0,0,0,0.2)",
    },
    mediaLoadingBadge: {
      position: "absolute",
      right: 8,
      bottom: 8,
      minWidth: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      paddingHorizontal: 7,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: "rgba(0,0,0,0.58)",
    },
    mediaLoadingPercent: {
      color: "#FFFFFF",
      fontSize: 10,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    groupedVideoPlay: {
      position: "absolute",
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      paddingLeft: 2,
      borderRadius: 17,
      backgroundColor: "rgba(0,0,0,0.58)",
    },
    messageReactionRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 5,
      marginTop: 7,
    },
    messageReaction: {
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    messageReactionSelected: {
      backgroundColor: CHAT_ACCENT,
    },
    messageReactionText: {
      color: colors.text,
      fontSize: 10,
      fontWeight: "600",
    },
    messageReactionTextSelected: {
      color: "#331B1D",
    },
    attachmentImage: {
      width: 220,
      height: 190,
      borderRadius: 12,
      marginBottom: 5,
    },
    viewOnceBubble: {
      minWidth: 225,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderRadius: 16,
      marginBottom: 5,
      borderWidth: StyleSheet.hairlineWidth,
    },
    viewOnceBubbleOpened: {
      opacity: 0.88,
    },
    viewOnceBubbleExpired: {
      opacity: 0.72,
    },
    viewOnceBadge: {
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
    },
    viewOnceBadgeViewed: {
      backgroundColor: colors.surface,
    },
    viewOnceBadgeText: {
      fontSize: 14,
      fontWeight: "800",
    },
    viewOnceMessageCopy: {
      flex: 1,
      gap: 3,
    },
    viewOnceMessageTitle: {
      fontSize: 12,
      fontWeight: "700",
    },
    viewOnceMessageStatus: {
      fontSize: 10,
    },
    viewOnceOpenButton: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 18,
    },
    videoAttachment: {
      width: 210,
      height: 150,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
      marginBottom: 5,
      backgroundColor: colors.surface,
    },
    videoPlayButton: {
      width: 52,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      paddingLeft: 3,
      borderRadius: 26,
      backgroundColor: "rgba(0,0,0,0.58)",
      borderWidth: 1,
      borderColor: "rgba(255,255,255,0.72)",
    },
    audioAttachment: {
      minWidth: 230,
      maxWidth: 300,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 5,
      paddingBottom: 8,
    },
    audioPlayButton: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 17,
      backgroundColor: "rgba(255,255,255,0.12)",
    },
    audioPlaybackInfo: {
      flex: 1,
      gap: 2,
      minWidth: 80,
    },
    audioWaveform: {
      height: 30,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 2,
    },
    audioWaveBar: {
      width: 3,
      minHeight: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
    },
    audioWaveBarActive: {
      backgroundColor: CHAT_ACCENT,
    },
    audioWaveBarActiveMine: {
      backgroundColor: "#5D3C39",
    },
    audioAttachmentText: {
      color: colors.textSecondary,
      fontSize: 10,
      fontVariant: ["tabular-nums"],
    },
    audioPlaybackError: {
      color: colors.error,
      fontSize: 9,
    },
    audioSpeedButton: {
      minWidth: 38,
      minHeight: 30,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    audioSpeedText: {
      fontSize: 10,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    audioActionsButton: {
      width: 22,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    messageTime: {
      color: colors.textMuted,
      fontSize: 9,
      textAlign: "right",
      fontVariant: ["tabular-nums"],
    },
    messageTimeMine: {
      color: "#5D3C39",
    },
    messageMeta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 4,
      marginTop: 5,
    },
    messageReadLabel: {
      color: colors.success,
      fontSize: 8,
      fontWeight: "600",
    },
    replyComposerPreview: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 10,
      marginBottom: 7,
      borderRadius: 13,
      backgroundColor: colors.surfaceSecondary,
    },
    replyComposerAccent: {
      width: 3,
      alignSelf: "stretch",
      marginVertical: 9,
      borderRadius: 2,
      backgroundColor: CHAT_ACCENT,
    },
    replyComposerCopy: { flex: 1, paddingVertical: 7 },
    replyComposerLabel: {
      color: CHAT_ACCENT,
      fontSize: 10,
      fontWeight: "700",
    },
    replyComposerText: {
      color: colors.textSecondary,
      fontSize: 10,
      marginTop: 3,
    },
    replyComposerClose: {
      width: 30,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    mediaDraftTray: {
      marginTop: 7,
      paddingTop: 8,
      paddingBottom: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    mediaDraftHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 4,
      marginBottom: 7,
    },
    mediaDraftHeading: {
      fontSize: 12,
      fontWeight: "700",
    },
    mediaDraftStatus: {
      fontSize: 10,
    },
    mediaDraftProgressTrack: {
      height: 3,
      overflow: "hidden",
      marginHorizontal: 4,
      marginBottom: 7,
      borderRadius: 2,
    },
    mediaDraftProgressFill: {
      height: "100%",
      borderRadius: 2,
    },
    mediaDraftList: {
      gap: 9,
      paddingHorizontal: 2,
      paddingBottom: 3,
    },
    mediaDraftCard: {
      width: 190,
      overflow: "hidden",
      borderWidth: 1,
      borderRadius: 14,
    },
    mediaDraftThumbnail: {
      height: 100,
      overflow: "hidden",
      backgroundColor: colors.surfaceSecondary,
    },
    mediaDraftImage: {
      width: "100%",
      height: "100%",
    },
    mediaDraftControls: {
      position: "absolute",
      top: 5,
      right: 5,
      flexDirection: "row",
      gap: 4,
    },
    mediaDraftControl: {
      width: 27,
      height: 27,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 14,
      backgroundColor: "rgba(25, 20, 28, 0.72)",
    },
    mediaDraftOnceBadge: {
      position: "absolute",
      left: 6,
      top: 6,
      width: 20,
      height: 20,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
    },
    mediaDraftDetails: {
      gap: 6,
      paddingHorizontal: 9,
      paddingVertical: 8,
    },
    mediaDraftMeta: {
      fontSize: 10,
      fontWeight: "600",
    },
    mediaDraftPrivacyToggle: {
      minHeight: 23,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    mediaDraftPrivacyText: {
      fontSize: 10,
      fontWeight: "600",
    },
    mediaDraftCaption: {
      minHeight: 32,
      paddingHorizontal: 7,
      paddingVertical: 4,
      borderWidth: 1,
      borderRadius: 8,
      fontSize: 11,
    },
    composerRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 7,
      paddingHorizontal: 2,
      paddingTop: 8,
      paddingBottom: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      backgroundColor: colors.background,
    },
    recordingStatusRow: {
      minHeight: 30,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginBottom: 7,
    },
    recordingIndicator: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.error,
    },
    recordingStatusText: {
      color: colors.error,
      fontSize: 12,
      fontWeight: "600",
    },
    recordingWaveform: {
      height: 22,
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
    },
    recordingWaveBar: {
      width: 2,
      minHeight: 4,
      borderRadius: 2,
      backgroundColor: CHAT_ACCENT,
    },
    recordingDuration: {
      color: colors.textSecondary,
      fontSize: 11,
      fontVariant: ["tabular-nums"],
    },
    composerIconButton: {
      width: 42,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 22,
      backgroundColor: colors.surfaceSecondary,
    },
    composerWrap: {
      flex: 1,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 5,
      paddingHorizontal: 7,
      paddingVertical: 5,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 24,
      backgroundColor: colors.inputBackground,
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    emojiButton: {
      width: 34,
      height: 38,
      alignItems: "center",
      justifyContent: "center",
    },
    composerInput: {
      flex: 1,
      maxHeight: 110,
      color: colors.text,
      fontSize: 13,
      paddingHorizontal: 5,
      paddingVertical: 8,
    },
    sendButton: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 17,
      backgroundColor: CHAT_ACCENT,
    },
    recordingButton: {
      backgroundColor: colors.error,
    },
    sendButtonDisabled: {
      opacity: 0.45,
    },
    modalBackdrop: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 22,
      backgroundColor: "rgba(0,0,0,0.68)",
    },
    profileModalBackdrop: {
      flex: 1,
      justifyContent: "flex-end",
      paddingTop: 32,
      backgroundColor: "rgba(0,0,0,0.68)",
    },
    messageActionBackdrop: {
      flex: 1,
      justifyContent: "flex-end",
      paddingHorizontal: 12,
      paddingBottom: 12,
      backgroundColor: "rgba(20, 13, 23, 0.42)",
    },
    messageActionSheet: {
      width: "100%",
      maxWidth: 480,
      alignSelf: "center",
      paddingHorizontal: 15,
      paddingTop: 10,
      paddingBottom: 14,
      borderWidth: 1,
      borderRadius: 24,
      elevation: 12,
      shadowColor: "#170D1D",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.18,
      shadowRadius: 22,
    },
    messageActionHandle: {
      width: 38,
      height: 4,
      alignSelf: "center",
      borderRadius: 2,
      marginBottom: 12,
    },
    messageActionHeading: {
      fontSize: 15,
      fontWeight: "700",
      paddingHorizontal: 5,
      paddingBottom: 8,
    },
    viewOnceOption: {
      minHeight: 58,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      paddingHorizontal: 8,
      marginTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    viewOnceOptionCopy: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    viewOnceOptionText: {
      flex: 1,
      gap: 3,
    },
    viewOnceOptionTitle: {
      fontSize: 12,
      fontWeight: "700",
    },
    viewOnceOptionDescription: {
      fontSize: 10,
    },
    viewOnceDisclosure: {
      paddingHorizontal: 5,
      paddingTop: 4,
      fontSize: 10,
      lineHeight: 15,
    },
    messageReactionChoices: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 8,
      paddingVertical: 6,
    },
    messageReactionChoice: {
      width: 48,
      height: 48,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderRadius: 16,
    },
    messageReactionChoiceEmoji: {
      fontSize: 23,
    },
    messageDeleteExplanation: {
      paddingHorizontal: 5,
      paddingBottom: 10,
      fontSize: 12,
      lineHeight: 18,
    },
    messageActionRow: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
      paddingHorizontal: 8,
      borderRadius: 14,
    },
    messageActionIcon: {
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 12,
    },
    messageActionLabel: { flex: 1, fontSize: 13, fontWeight: "600" },
    messageActionCancel: {
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 7,
      borderWidth: 1,
      borderRadius: 14,
    },
    messageActionCancelText: { fontSize: 12, fontWeight: "600" },
    safetyModal: {
      width: "100%",
      maxWidth: 420,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 26,
      backgroundColor: colors.surface,
      elevation: 12,
      shadowColor: "#170D1D",
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.18,
      shadowRadius: 24,
    },
    safetyHeader: {
      alignItems: "center",
      paddingHorizontal: 8,
      paddingBottom: 16,
    },
    safetyHeaderIcon: {
      width: 54,
      height: 54,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
      borderRadius: 27,
      backgroundColor: colors.surfaceSecondary,
    },
    videoCallModal: {
      flex: 1,
      justifyContent: "center",
      padding: 18,
    },
    videoCallPrompt: {
      alignItems: "center",
      width: "100%",
      maxWidth: 420,
      alignSelf: "center",
      padding: 24,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 24,
      backgroundColor: colors.surface,
    },
    videoCallIcon: {
      width: 58,
      height: 58,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 29,
      backgroundColor: colors.surfaceSecondary,
    },
    videoCallTitle: {
      marginTop: 16,
      color: colors.text,
      fontSize: 18,
      fontWeight: "700",
      textAlign: "center",
    },
    videoCallCopy: {
      marginTop: 8,
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "center",
    },
    videoCallSpinner: {
      marginTop: 14,
    },
    videoCallError: {
      marginTop: 12,
      color: colors.error,
      fontSize: 11,
      textAlign: "center",
    },
    videoCallActions: {
      flexDirection: "row",
      alignSelf: "stretch",
      gap: 10,
      marginTop: 20,
    },
    videoCallPrimaryAction: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 14,
    },
    videoCallPrimaryText: {
      fontSize: 12,
      fontWeight: "700",
    },
    videoCallSecondaryAction: {
      alignItems: "center",
      justifyContent: "center",
      minHeight: 44,
      paddingHorizontal: 18,
      borderWidth: 1,
      borderRadius: 14,
    },
    videoCallSecondaryText: {
      fontSize: 12,
      fontWeight: "600",
    },
    safetyTitle: {
      color: colors.text,
      fontSize: 20,
      fontWeight: "700",
      letterSpacing: -0.3,
      textAlign: "center",
    },
    safetyCopy: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 7,
      textAlign: "center",
    },
    pinInputWrap: {
      position: "relative",
      minHeight: 46,
      marginTop: 12,
    },
    pinInput: {
      width: "100%",
      minHeight: 46,
      paddingHorizontal: 14,
      paddingRight: 44,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      backgroundColor: colors.inputBackground,
      color: colors.text,
      fontSize: 14,
      textAlign: "center",
    },
    pinInputVisibility: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      width: 42,
      alignItems: "center",
      justifyContent: "center",
    },
    pinModalError: {
      marginTop: 10,
      color: colors.error,
      fontSize: 12,
      lineHeight: 17,
      textAlign: "center",
    },
    safetyMenuItem: {
      minHeight: 72,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginTop: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      backgroundColor: colors.background,
    },
    safetyMenuItemPressed: {
      opacity: 0.72,
    },
    safetyMenuIcon: {
      width: 38,
      height: 38,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 13,
      backgroundColor: colors.surfaceSecondary,
    },
    safetyMenuContent: {
      flex: 1,
    },
    safetyMenuText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
    },
    safetyDestructiveText: {
      color: colors.error,
    },
    safetyMenuDescription: {
      marginTop: 3,
      color: colors.textSecondary,
      fontSize: 11,
      lineHeight: 15,
    },
    reportReason: {
      paddingVertical: 9,
    },
    reportSelected: {
      color: CHAT_ACCENT,
      fontWeight: "700",
    },
    safetyConfirm: {
      alignItems: "center",
      paddingVertical: 12,
      marginTop: 10,
      borderRadius: 20,
      backgroundColor: CHAT_ACCENT,
    },
    safetyConfirmText: {
      color: "#331B1D",
      fontSize: 12,
      fontWeight: "700",
    },
    modalCancel: {
      alignItems: "center",
      paddingVertical: 11,
    },
    modalCancelText: {
      color: colors.textSecondary,
      fontSize: 11,
    },
    profileModal: {
      width: "100%",
      maxWidth: 520,
      maxHeight: "90%",
      alignSelf: "center",
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      backgroundColor: colors.surface,
      overflow: "hidden",
    },
    profileHeroInitial: {
      color: CHAT_ACCENT,
      fontSize: 68,
      fontWeight: "700",
    },
    profileCloseButton: {
      position: "absolute",
      top: 16,
      right: 16,
      width: 38,
      height: 38,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 19,
      backgroundColor: "rgba(0,0,0,0.42)",
    },
    profileHeroCopy: {
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 8,
    },
    profileNameLine: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    profileHeroName: {
      flexShrink: 1,
      color: colors.text,
      fontSize: 25,
      fontWeight: "700",
    },
    profileHeroMeta: {
      color: colors.textSecondary,
      fontSize: 13,
      marginTop: 5,
    },
    profileDetailsScroll: {
      flexShrink: 1,
    },
    profileDetails: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 26,
    },
    profileStatusRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 17,
    },
    profileConnectionBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 16,
      backgroundColor: colors.surfaceSecondary,
    },
    profileConnectionText: {
      color: CHAT_ACCENT,
      fontSize: 11,
      fontWeight: "700",
    },
    profileOnlineBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 16,
      backgroundColor: colors.surfaceSecondary,
    },
    profileOnlineText: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: "600",
    },
    profileSection: {
      marginTop: 12,
    },
    profileSectionTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
      marginBottom: 7,
    },
    profileSectionCopy: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 20,
    },
    profileChipList: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 7,
    },
    profileChip: {
      overflow: "hidden",
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: 15,
      backgroundColor: colors.surfaceSecondary,
      color: colors.textSecondary,
      fontSize: 11,
    },
  });

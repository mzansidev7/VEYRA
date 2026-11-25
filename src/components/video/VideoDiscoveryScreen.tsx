import { isRunningInExpoGo } from "expo";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Camera,
  Heart,
  ShieldCheck,
  Sparkles,
  Video,
  X,
} from "lucide-react-native";
import {
  blockUser,
} from "../../data/privacySettings";
import {
  cancelVideoDiscoverySearch,
  endVideoDiscoveryCall,
  getVideoCallToken,
  getVideoDiscoveryAvailability,
  getVideoDiscoveryStatus,
  joinVideoDiscovery,
  reportVideoDiscoveryUser,
  respondToVideoDiscovery,
  submitVideoDiscoveryDecision,
  subscribeToVideoDiscoverySession,
  type VideoCallToken,
  type VideoDiscoveryParticipant,
  type VideoDiscoveryState,
  type VideoDiscoveryStatus,
} from "../../data/videoDiscovery";
import { useOnlineStatuses } from "../../data/onlinePresence";
import { initializeLiveKit } from "../../lib/liveKit";
import { systemColors, type SystemColors } from "../../systemColors";
import type { VideoCallRoomProps } from "./VideoCallRoom";

type VideoDiscoveryScreenProps = {
  userId: string;
  colors: SystemColors;
  onCallActive: (active: boolean) => void;
  onViewMatches: () => void;
};
type SafetyAction = "menu" | "report" | "block" | null;
type ReportReason =
  | "inappropriate"
  | "harassment"
  | "spam"
  | "fake_profile"
  | "other";

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "harassment", label: "Harassment or abusive behaviour" },
  { value: "spam", label: "Spam or scam" },
  { value: "fake_profile", label: "Fake profile" },
  { value: "other", label: "Something else" },
];
const NATIVE_CALL_SUPPORTED = Platform.OS !== "web" && !isRunningInExpoGo();

export function VideoDiscoveryScreen({
  userId,
  colors,
  onCallActive,
  onViewMatches,
}: VideoDiscoveryScreenProps) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<VideoDiscoveryStatus>(emptyStatus());
  const [callToken, setCallToken] = useState<VideoCallToken | null>(null);
  const [CallRoom, setCallRoom] =
    useState<ComponentType<VideoCallRoomProps> | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [safetyAction, setSafetyAction] = useState<SafetyAction>(null);
  const [reportReason, setReportReason] =
    useState<ReportReason>("inappropriate");
  const [matched, setMatched] = useState(false);
  const { onlineUserIds, error: onlineStatusError } = useOnlineStatuses(
    userId,
    status.otherParticipant ? [status.otherParticipant.userId] : [],
  );
  const callStartInFlight = useRef(false);
  const tokenAttemptedForSession = useRef<string | null>(null);
  const statusRequestInFlight = useRef(false);
  const startCallRef = useRef<(sessionId: string) => Promise<void>>(
    async () => {},
  );

  const loadStatus = useCallback(async (sessionId?: string) => {
    if (statusRequestInFlight.current) return;
    statusRequestInFlight.current = true;
    try {
      const next = await getVideoDiscoveryStatus(sessionId);
      setStatus(next);
      setError("");
      if (
        NATIVE_CALL_SUPPORTED &&
        next.sessionId &&
        (next.state === "accepted" || next.state === "connected") &&
        tokenAttemptedForSession.current !== next.sessionId
      ) {
        await startCallRef.current(next.sessionId);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load Video Discovery status.",
      );
    } finally {
      statusRequestInFlight.current = false;
    }
  }, []);

  const startCall = useCallback(async (sessionId: string) => {
    if (callStartInFlight.current || callToken?.sessionId === sessionId) return;
    callStartInFlight.current = true;
    tokenAttemptedForSession.current = sessionId;
    setBusy(true);
    setError("");
    try {
      await initializeLiveKit();
      const token = await getVideoCallToken(sessionId);
      setCallToken(token);
      onCallActive(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not join this video call.",
      );
    } finally {
      callStartInFlight.current = false;
      setBusy(false);
    }
  }, [callToken?.sessionId, onCallActive]);
  startCallRef.current = startCall;

  const refreshCurrentStatus = useCallback(
    (sessionId?: string) => {
      void loadStatus(sessionId ?? status.sessionId ?? undefined);
    },
    [loadStatus, status.sessionId],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([getVideoDiscoveryAvailability(), getVideoDiscoveryStatus()])
      .then(([enabled, nextStatus]) => {
        if (!active) return;
        setAvailable(enabled);
        setStatus(nextStatus);
        setError("");
        if (
          NATIVE_CALL_SUPPORTED &&
          nextStatus.sessionId &&
          (nextStatus.state === "accepted" ||
            nextStatus.state === "connected")
        ) {
          void startCallRef.current(nextStatus.sessionId);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load Video Discovery.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    const activeSessionId = status.sessionId;
    if (!activeSessionId || !isActiveSessionState(status.state)) return;
    return subscribeToVideoDiscoverySession(
      activeSessionId,
      () => refreshCurrentStatus(activeSessionId),
      (cause) => setError(cause.message),
    );
  }, [refreshCurrentStatus, status.sessionId, status.state]);

  useEffect(() => {
    if (
      !available &&
      status.state !== "searching" &&
      !isActiveSessionState(status.state)
    ) {
      return;
    }
    const interval = setInterval(
      () => refreshCurrentStatus(status.sessionId ?? undefined),
      3_000,
    );
    return () => clearInterval(interval);
  }, [available, refreshCurrentStatus, status.sessionId, status.state]);

  useEffect(() => {
    let active = true;
    if (
      !callToken ||
      Platform.OS === "web" ||
      isRunningInExpoGo()
    ) {
      setCallRoom(null);
      return;
    }
    import("./VideoCallRoom")
      .then((module) => {
        if (active) setCallRoom(() => module.VideoCallRoom);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load the native video call.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [callToken]);

  useEffect(() => {
    if (status.state !== "ended" || !callToken) return;
    setCallToken(null);
    setCallRoom(null);
    onCallActive(false);
  }, [callToken, onCallActive, status.state]);

  useEffect(() => {
    return () => onCallActive(false);
  }, [onCallActive]);

  const startSearch = async () => {
    if (!available || !NATIVE_CALL_SUPPORTED) return;
    setBusy(true);
    setMatched(false);
    setError("");
    setNotice("");
    try {
      const next = await joinVideoDiscovery();
      setStatus(next);
      if (next.state === "accepted" && next.sessionId) {
        await startCall(next.sessionId);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start searching.",
      );
    } finally {
      setBusy(false);
    }
  };

  const cancelSearch = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await cancelVideoDiscoverySearch();
      setStatus(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not cancel the search.",
      );
    } finally {
      setBusy(false);
    }
  };

  const respond = async (accept: boolean) => {
    if (!status.sessionId) return;
    setBusy(true);
    setError("");
    try {
      const next = await respondToVideoDiscovery(status.sessionId, accept);
      setStatus(next);
      if (
        accept &&
        next.sessionId &&
        (next.state === "accepted" || next.state === "connected")
      ) {
        await startCall(next.sessionId);
      }
      if (!accept) setNotice("Invitation declined.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not respond to the invitation.",
      );
    } finally {
      setBusy(false);
    }
  };

  const endCall = async () => {
    const sessionId = status.sessionId;
    if (!sessionId) return;
    setCallToken(null);
    setCallRoom(null);
    onCallActive(false);
    setBusy(true);
    setError("");
    try {
      await endVideoDiscoveryCall(sessionId);
      await loadStatus(sessionId);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not end the video call.",
      );
    } finally {
      setBusy(false);
    }
  };

  const endInvitation = async () => {
    const sessionId = status.sessionId;
    if (!sessionId) return;
    setBusy(true);
    setError("");
    try {
      await endVideoDiscoveryCall(sessionId);
      setCallToken(null);
      setCallRoom(null);
      onCallActive(false);
      await loadStatus(sessionId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not end this video invitation.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitDecision = async (action: "like" | "pass") => {
    if (!status.sessionId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await submitVideoDiscoveryDecision(status.sessionId, action);
      setMatched(result.matched);
      setStatus(emptyStatus());
      setNotice(
        result.matched
          ? "It’s a mutual like! You can find your new match in Likes."
          : action === "like"
            ? "Like saved. If they like you too, you’ll become a match."
            : "Thanks for letting us know.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save your decision.",
      );
    } finally {
      setBusy(false);
    }
  };

  const performSafetyAction = async () => {
    const participant = status.otherParticipant;
    const sessionId = status.sessionId;
    if (!participant || !sessionId || !safetyAction) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (safetyAction === "report") {
        await reportVideoDiscoveryUser(sessionId, reportReason);
        setNotice("Report received. This member is blocked and our team will review it.");
      } else {
        await blockUser(userId, participant.userId);
        if (
          isActiveSessionState(status.state) ||
          (status.state === "ended" && status.wasConnected)
        ) {
          await endVideoDiscoveryCall(sessionId);
        }
        setNotice("This member is blocked. The video connection has ended.");
      }
      setCallToken(null);
      setCallRoom(null);
      onCallActive(false);
      setStatus(emptyStatus());
      setMatched(false);
      setSafetyAction(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not complete this safety action.",
      );
    } finally {
      setBusy(false);
    }
  };

  const callReady =
    callToken !== null &&
    CallRoom !== null &&
    status.sessionId === callToken.sessionId;
  const endedAfterCall = status.state === "ended" && status.wasConnected;
  const participant = status.otherParticipant;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {callToken && !CallRoom ? (
          <View style={styles.stateCard}>
            {error ? <Feedback text={error} styles={styles} error /> : null}
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.cardTitle}>Preparing your video call</Text>
            <Text style={styles.bodyText}>
              Keep VEYRA open while the secure call connects.
            </Text>
            <PrimaryButton
              label="End call"
              disabled={busy}
              onPress={() => void endCall()}
              styles={styles}
              secondary
            />
          </View>
        ) : callReady && CallRoom && callToken ? (
          <View style={styles.callSection}>
            {error ? <Feedback text={error} styles={styles} error /> : null}
            <CallRoom
              token={callToken}
              colors={colors}
              otherName={participant?.name ?? "VEYRA member"}
              onEnd={() => void endCall()}
              onConnected={() => {
                setStatus((current) => ({ ...current, state: "connected" }));
              }}
              onError={(cause) => setError(cause.message)}
            />
            <SafetyButton
              label="Safety options"
              onPress={() => setSafetyAction("menu")}
              styles={styles}
            />
          </View>
        ) : (
          <>
            <View style={styles.header}>
              <View style={styles.headerIcon}>
                <Video size={20} color={colors.primary} />
              </View>
              <Text style={styles.eyebrow}>VEYRA VIDEO</Text>
              <Text style={styles.heading}>Meet face-to-face</Text>
              <Text style={styles.subtitle}>
                A thoughtful video introduction with someone who fits your
                preferences and is within 200 km. People who enable video
                availability can receive an invitation even when they are not
                actively searching. You both choose whether to connect.
              </Text>
            </View>

            {!NATIVE_CALL_SUPPORTED ? (
              <View style={styles.buildNotice}>
                <Camera size={21} color={colors.primary} />
                <View style={styles.buildNoticeCopy}>
                  <Text style={styles.cardTitle}>A development build is needed</Text>
                  <Text style={styles.bodyText}>
                    Video calls need VEYRA’s Android or iOS development build.
                    Expo Go and web preview can’t access LiveKit video.
                  </Text>
                </View>
              </View>
            ) : null}

            {!loading && !available ? (
              <View style={styles.availabilityCard}>
                <View style={styles.availabilityCopy}>
                  <Text style={styles.cardTitle}>
                    Video availability is off
                  </Text>
                  <Text style={styles.bodyText}>
                    Turn it on in Profile → Privacy & Visibility when you’re
                    ready to receive video introductions.
                  </Text>
                </View>
              </View>
            ) : null}

            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.bodyText}>Getting Video Discovery ready…</Text>
              </View>
            ) : (
              <SessionCard
                status={status}
                participant={participant}
                isParticipantOnline={
                  participant !== null &&
                  onlineUserIds.has(participant.userId)
                }
                available={available}
                busy={busy}
                matched={matched}
                styles={styles}
                colors={colors}
                onStartSearch={() => void startSearch()}
                onCancelSearch={() => void cancelSearch()}
                onAccept={() => void respond(true)}
                onDecline={() => void respond(false)}
                onRetryCall={() => {
                  if (status.sessionId) {
                    tokenAttemptedForSession.current = null;
                    void startCall(status.sessionId);
                  }
                }}
                onEndInvitation={() => void endInvitation()}
                onDecision={(action) => void submitDecision(action)}
                onViewMatches={onViewMatches}
                canDecide={endedAfterCall && status.source === "discovery"}
              />
            )}

            {error ? <Feedback text={error} styles={styles} error /> : null}
            {onlineStatusError ? (
              <Feedback
                text={`Online status is unavailable: ${onlineStatusError}`}
                styles={styles}
                error
              />
            ) : null}
            {notice ? <Feedback text={notice} styles={styles} /> : null}

            {participant && status.sessionId ? (
              <SafetyButton
                label="Report or block"
                onPress={() => setSafetyAction("menu")}
                styles={styles}
              />
            ) : null}
          </>
        )}
      </ScrollView>

      <SafetyModal
        action={safetyAction}
        reason={reportReason}
        setAction={setSafetyAction}
        setReason={setReportReason}
        busy={busy}
        styles={styles}
        onConfirm={() => void performSafetyAction()}
      />
    </View>
  );
}

function SessionCard({
  status,
  participant,
  isParticipantOnline,
  available,
  busy,
  matched,
  styles,
  colors,
  onStartSearch,
  onCancelSearch,
  onAccept,
  onDecline,
  onRetryCall,
  onEndInvitation,
  onDecision,
  onViewMatches,
  canDecide,
}: {
  status: VideoDiscoveryStatus;
  participant: VideoDiscoveryParticipant | null;
  isParticipantOnline: boolean;
  available: boolean;
  busy: boolean;
  matched: boolean;
  styles: ReturnType<typeof createStyles>;
  colors: SystemColors;
  onStartSearch: () => void;
  onCancelSearch: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onRetryCall: () => void;
  onEndInvitation: () => void;
  onDecision: (action: "like" | "pass") => void;
  onViewMatches: () => void;
  canDecide: boolean;
}) {
  if (status.state === "searching") {
    return (
      <View style={styles.stateCard}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.cardTitle}>Looking for someone compatible</Text>
        <Text style={styles.bodyText}>
          We’ll let you know when someone is ready to meet.
        </Text>
        <PrimaryButton
          label="Cancel search"
          disabled={busy}
          onPress={onCancelSearch}
          styles={styles}
          secondary
        />
      </View>
    );
  }

  if (status.state === "pending_acceptance") {
    return (
      <View style={styles.stateCard}>
        <ParticipantSummary
          participant={participant}
          isOnline={isParticipantOnline}
          styles={styles}
          colors={colors}
        />
        <Text style={styles.cardTitle}>A video introduction is waiting</Text>
        <Text style={styles.bodyText}>
          Accept only if you’re comfortable meeting now. You can end the call at
          any time.
        </Text>
        <View style={styles.actionRow}>
          <PrimaryButton
            label="Not now"
            disabled={busy}
            onPress={onDecline}
            styles={styles}
            secondary
          />
          <PrimaryButton
            label="Accept"
            disabled={busy}
            onPress={onAccept}
            styles={styles}
          />
        </View>
      </View>
    );
  }

  if (status.state === "accepted" || status.state === "connected") {
    return (
      <View style={styles.stateCard}>
        <ParticipantSummary
          participant={participant}
          isOnline={isParticipantOnline}
          styles={styles}
          colors={colors}
        />
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.cardTitle}>
          {status.state === "connected"
            ? "Rejoining your conversation"
            : "Connecting your video call"}
        </Text>
        <Text style={styles.bodyText}>
          Make sure camera and microphone access are allowed for VEYRA.
        </Text>
        <View style={styles.actionRow}>
          <PrimaryButton
            label="End invitation"
            disabled={busy}
            onPress={onEndInvitation}
            styles={styles}
            secondary
          />
          <PrimaryButton
            label="Try joining"
            disabled={busy}
            onPress={onRetryCall}
            styles={styles}
          />
        </View>
      </View>
    );
  }

  if (status.state === "ended" && canDecide) {
    return (
      <View style={styles.stateCard}>
        <Sparkles color={colors.primary} size={28} />
        <Text style={styles.cardTitle}>How did that conversation feel?</Text>
        <Text style={styles.bodyText}>
          Like or pass privately. If you both like each other, VEYRA will create
          a match and unlock chat.
        </Text>
        <View style={styles.actionRow}>
          <PrimaryButton
            label="Pass"
            disabled={busy}
            onPress={() => onDecision("pass")}
            styles={styles}
            secondary
          />
          <PrimaryButton
            label="Like"
            disabled={busy}
            onPress={() => onDecision("like")}
            styles={styles}
            icon={<Heart size={17} color={colors.textInverse} />}
          />
        </View>
      </View>
    );
  }

  if (matched) {
    return (
      <View style={styles.stateCard}>
        <Heart color={colors.like} size={30} fill={colors.like} />
        <Text style={styles.cardTitle}>It’s a mutual like!</Text>
        <Text style={styles.bodyText}>
          Your new connection is ready in Likes, and you can start chatting.
        </Text>
        <PrimaryButton
          label="View matches"
          disabled={busy}
          onPress={onViewMatches}
          styles={styles}
        />
      </View>
    );
  }

  if (
    status.state === "declined" ||
    status.state === "cancelled" ||
    status.state === "expired" ||
    status.state === "ended"
  ) {
    return (
      <View style={styles.stateCard}>
        <Text style={styles.cardTitle}>This introduction has ended</Text>
        <Text style={styles.bodyText}>
          You can try again whenever you’re ready.
        </Text>
        <PrimaryButton
          label="Find someone"
          disabled={busy || !available}
          onPress={onStartSearch}
          styles={styles}
        />
      </View>
    );
  }

  return (
    <View style={styles.stateCard}>
      <View style={styles.valueIcon}>
        <Sparkles size={21} color={colors.primary} />
      </View>
      <Text style={styles.cardTitle}>A more personal first hello</Text>
      <Text style={styles.bodyText}>
        Search when you’re available. We’ll use your existing discovery
        preferences and compatibility information to find someone suitable.
      </Text>
      <PrimaryButton
        label={available ? "Start matching" : "Manage in Privacy & Visibility"}
        disabled={busy || !available}
        onPress={onStartSearch}
        styles={styles}
      />
    </View>
  );
}

function ParticipantSummary({
  participant,
  isOnline,
  styles,
  colors,
}: {
  participant: VideoDiscoveryParticipant | null;
  isOnline: boolean;
  styles: ReturnType<typeof createStyles>;
  colors: SystemColors;
}) {
  return (
    <View style={styles.participant}>
      {participant?.imageUrl ? (
        <Image source={{ uri: participant.imageUrl }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>
            {participant?.name.trim().charAt(0).toUpperCase() || "V"}
          </Text>
        </View>
      )}
      <View style={styles.participantDetails}>
        <Text style={styles.participantName}>
          {participant?.name ?? "A compatible member"}
        </Text>
        {isOnline ? (
          <View
            accessibilityLabel={`${participant?.name ?? "Member"} is online`}
            style={styles.participantOnline}
          >
            <View style={styles.participantOnlineDot} />
            <Text style={styles.participantOnlineText}>Online</Text>
          </View>
        ) : null}
        {participant?.city ? (
          <Text style={styles.bodyText}>{participant.city}</Text>
        ) : null}
      </View>
      {participant?.identityVerified ? (
        <ShieldCheck color={colors.success} size={19} />
      ) : null}
    </View>
  );
}

function PrimaryButton({
  label,
  disabled,
  onPress,
  styles,
  secondary = false,
  icon,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
  secondary?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        secondary && styles.secondaryButton,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {icon}
      <Text
        style={[
          styles.primaryButtonText,
          secondary && styles.secondaryButtonText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SafetyButton({
  label,
  onPress,
  styles,
}: {
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.safetyButton, pressed && styles.pressed]}
    >
      <ShieldCheck size={16} color={styles.safetyButtonText.color as string} />
      <Text style={styles.safetyButtonText}>{label}</Text>
    </Pressable>
  );
}

function Feedback({
  text,
  styles,
  error = false,
}: {
  text: string;
  styles: ReturnType<typeof createStyles>;
  error?: boolean;
}) {
  return (
    <View style={[styles.feedback, error && styles.errorFeedback]}>
      <Text style={[styles.feedbackText, error && styles.errorText]}>
        {text}
      </Text>
    </View>
  );
}

function SafetyModal({
  action,
  reason,
  setAction,
  setReason,
  busy,
  styles,
  onConfirm,
}: {
  action: SafetyAction;
  reason: ReportReason;
  setAction: (action: SafetyAction) => void;
  setReason: (reason: ReportReason) => void;
  busy: boolean;
  styles: ReturnType<typeof createStyles>;
  onConfirm: () => void;
}) {
  const isReport = action === "report";
  return (
    <Modal
      animationType="fade"
      transparent
      visible={action !== null}
      onRequestClose={() => {
        if (!busy) setAction(null);
      }}
    >
      <View style={styles.modalBackdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close safety options"
          disabled={busy}
          onPress={() => setAction(null)}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.modalCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            disabled={busy}
            onPress={() => setAction(null)}
            style={styles.modalClose}
          >
            <X size={20} color={styles.cardTitle.color as string} />
          </Pressable>
          <Text style={styles.cardTitle}>
            {action === "menu"
              ? "Safety options"
              : isReport
                ? "Report this member"
                : "Block this member?"}
          </Text>
          <Text style={styles.bodyText}>
            {action === "menu"
              ? "Choose an option. Your safety actions are private."
              : isReport
                ? "Your report is private. Reporting also blocks this member and ends the video connection."
                : "They won’t be able to connect with you again. The current video connection will end."}
          </Text>
          {action === "menu" ? (
            <View style={styles.actionRow}>
              <PrimaryButton
                label="Report"
                disabled={busy}
                onPress={() => setAction("report")}
                styles={styles}
                secondary
              />
              <PrimaryButton
                label="Block"
                disabled={busy}
                onPress={() => setAction("block")}
                styles={styles}
              />
            </View>
          ) : isReport ? (
            REPORT_REASONS.map((item) => (
                <Pressable
                  key={item.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: reason === item.value }}
                  disabled={busy}
                  onPress={() => setReason(item.value)}
                  style={styles.reasonRow}
                >
                  <View
                    style={[
                      styles.radio,
                      reason === item.value && styles.radioSelected,
                    ]}
                  />
                  <Text style={styles.reasonText}>{item.label}</Text>
                </Pressable>
              ))
          ) : null}
          {action !== "menu" ? <View style={styles.actionRow}>
            <PrimaryButton
              label="Cancel"
              disabled={busy}
              onPress={() => setAction(null)}
              styles={styles}
              secondary
            />
            <PrimaryButton
              label={busy ? "Please wait…" : isReport ? "Send report" : "Block"}
              disabled={busy}
              onPress={onConfirm}
              styles={styles}
            />
          </View> : null}
        </View>
      </View>
    </Modal>
  );
}

function emptyStatus(): VideoDiscoveryStatus {
  return {
    state: "idle",
    source: null,
    sessionId: null,
    queueId: null,
    expiresAt: null,
    myAccepted: null,
    otherAccepted: null,
    wasConnected: false,
    otherParticipant: null,
  };
}

function isActiveSessionState(state: VideoDiscoveryState): boolean {
  return (
    state === "pending_acceptance" ||
    state === "accepted" ||
    state === "connected"
  );
}

function createStyles(colors: SystemColors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 28,
      gap: 16,
    },
    header: {
      alignItems: "center",
      paddingHorizontal: 10,
      paddingTop: 8,
      paddingBottom: 4,
    },
    headerIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.secondary,
      marginBottom: 11,
    },
    eyebrow: {
      color: colors.textSecondary,
      fontSize: 11,
      letterSpacing: 1.5,
      fontWeight: "700",
      marginBottom: 5,
    },
    heading: {
      color: colors.text,
      fontSize: 27,
      fontWeight: "700",
      textAlign: "center",
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 21,
      textAlign: "center",
      marginTop: 8,
    },
    buildNotice: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      padding: 15,
      backgroundColor: colors.surface,
    },
    buildNoticeCopy: {
      flex: 1,
      gap: 5,
    },
    availabilityCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      padding: 17,
      backgroundColor: colors.surface,
    },
    availabilityCopy: {
      flex: 1,
      gap: 5,
    },
    cardTitle: {
      color: colors.text,
      fontSize: 17,
      lineHeight: 23,
      fontWeight: "700",
    },
    bodyText: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
    },
    stateCard: {
      alignItems: "center",
      gap: 14,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 22,
      backgroundColor: colors.surface,
    },
    valueIcon: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceSecondary,
    },
    primaryButton: {
      flex: 1,
      minHeight: 48,
      paddingHorizontal: 17,
      borderRadius: 24,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      backgroundColor: colors.primary,
    },
    primaryButtonText: {
      color: colors.textInverse,
      fontSize: 14,
      fontWeight: "700",
      textAlign: "center",
    },
    secondaryButton: {
      backgroundColor: colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryButtonText: {
      color: colors.text,
    },
    disabledButton: {
      opacity: 0.55,
    },
    actionRow: {
      flexDirection: "row",
      gap: 10,
      width: "100%",
      marginTop: 2,
    },
    loading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      padding: 26,
    },
    participant: {
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    avatar: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.surfaceSecondary,
    },
    avatarFallback: {
      alignItems: "center",
      justifyContent: "center",
    },
    avatarInitial: {
      color: colors.primary,
      fontSize: 22,
      fontWeight: "700",
    },
    participantDetails: {
      flex: 1,
      gap: 3,
    },
    participantName: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
    },
    participantOnline: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    participantOnlineDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.success,
    },
    participantOnlineText: {
      color: colors.success,
      fontSize: 11,
      fontWeight: "700",
    },
    feedback: {
      padding: 13,
      borderRadius: 14,
      backgroundColor: colors.surfaceSecondary,
    },
    feedbackText: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 19,
    },
    errorFeedback: {
      backgroundColor: colors.error + "18",
    },
    errorText: {
      color: colors.error,
    },
    safetyButton: {
      alignSelf: "center",
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    safetyButtonText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: "600",
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: "center",
      padding: 22,
      backgroundColor: "rgba(18, 12, 20, 0.6)",
    },
    modalCard: {
      gap: 13,
      padding: 21,
      borderRadius: 24,
      backgroundColor: colors.surface,
    },
    modalClose: {
      alignSelf: "flex-end",
      padding: 4,
    },
    reasonRow: {
      minHeight: 36,
      flexDirection: "row",
      alignItems: "center",
      gap: 11,
    },
    reasonText: {
      color: colors.text,
      fontSize: 14,
    },
    radio: {
      width: 18,
      height: 18,
      borderRadius: 9,
      borderWidth: 1.5,
      borderColor: colors.textMuted,
    },
    radioSelected: {
      borderWidth: 5,
      borderColor: colors.primary,
    },
    callSection: {
      flex: 1,
      gap: 12,
      minHeight: 460,
    },
    pressed: {
      opacity: 0.76,
    },
  });
}

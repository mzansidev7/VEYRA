import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentRef } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Check,
  CheckCheck,
  Heart,
  Mic,
  MoreVertical,
  Paperclip,
  Pause,
  Play,
  Send,
  Smile,
  X,
} from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
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
import { IdentityVerifiedBadge } from "../IdentityVerifiedBadge";
import { blockUser } from "../../data/privacySettings";
import EmojiPicker from "../../lib/EmojiPicker";
import {
  getChatFeed,
  getConversationMessages,
  markConversationRead,
  reportConversationMember,
  sendConversationMessage,
  sendConversationAttachment,
  subscribeToConversation,
  unmatchConversation,
  type ChatAttachmentKind,
  type ChatConversation,
  type ChatAttachment,
  type ChatMessage,
  type ChatPerson,
  type NewChatMatch,
} from "../../data/chat";
import { useOnlineStatuses } from "../../data/onlinePresence";
import { systemColors, type SystemColors } from "../../systemColors";

type ChatFilter = "all" | "unread" | "new";
type ActiveConversation = {
  id: string;
  matchId: string;
  person: ChatPerson;
};
type SafetyAction = "menu" | "block" | "unmatch" | "report" | null;
type ReportReason =
  | "inappropriate"
  | "harassment"
  | "spam"
  | "fake_profile"
  | "other";
type ChatStyles = ReturnType<typeof createStyles>;
type PreviewAttachment = Omit<ChatAttachment, "kind"> &
  ({ kind: "image" } | { kind: "video" });
type VideoPreviewAttachment = Omit<ChatAttachment, "kind"> & {
  kind: "video";
};

const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "harassment", label: "Harassment or abusive behaviour" },
  { value: "spam", label: "Spam or scam" },
  { value: "fake_profile", label: "Fake profile" },
  { value: "other", label: "Something else" },
];
const VOICE_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: "document" as const,
};

export function ChatScreen({
  userId,
  colors,
  onSessionExpired,
}: {
  userId: string;
  colors: SystemColors;
  onSessionExpired: () => Promise<void>;
}) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 250);
  const recordingStarted = useRef(false);
  const recordingRequested = useRef(false);
  const recordingConversation = useRef<ActiveConversation | null>(null);
  const [feed, setFeed] = useState<{
    conversations: ChatConversation[];
    newMatches: NewChatMatch[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [search, setSearch] = useState("");
  const [activeConversation, setActiveConversation] =
    useState<ActiveConversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isEmojiPickerVisible, setIsEmojiPickerVisible] = useState(false);
  const [safetyAction, setSafetyAction] = useState<SafetyAction>(null);
  const [reportReason, setReportReason] =
    useState<ReportReason>("inappropriate");
  const [isSavingSafety, setIsSavingSafety] = useState(false);
  const [profilePerson, setProfilePerson] = useState<ChatPerson | null>(null);
  const [previewAttachment, setPreviewAttachment] =
    useState<PreviewAttachment | null>(null);
  const [notice, setNotice] = useState("");
  const [messageError, setMessageError] = useState("");
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const composerInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const sessionExpiryHandled = useRef(false);
  const onlineTargetIds = useMemo(
    () =>
      [
        ...(feed?.conversations.map((conversation) => conversation.person.id) ??
          []),
        activeConversation?.person.id,
      ].filter((id): id is string => Boolean(id)),
    [activeConversation?.person.id, feed?.conversations],
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
          .filter((conversation) =>
            onlineUserIds.has(conversation.person.id),
          )
          .map((conversation) => conversation.id) ?? [],
      ),
    [feed?.conversations, onlineUserIds],
  );

  const loadFeed = useCallback(async (background = false) => {
    if (!background) setIsLoading(true);
    setError("");
    try {
      setFeed(await getChatFeed());
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
  }, [onSessionExpired]);

  const loadMessages = useCallback(
    async (conversationId: string, markRead: boolean) => {
      setMessageError("");
      try {
        if (markRead) await markConversationRead(conversationId);
        const nextMessages = await getConversationMessages(conversationId);
        setMessages(nextMessages);
        if (markRead) await loadFeed(true);
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
    [loadFeed, onSessionExpired],
  );

  useEffect(() => {
    void loadFeed();
  }, [loadFeed, userId]);

  useEffect(() => {
    if (!activeConversation) return;
    setIsLoadingMessages(true);
    void loadMessages(activeConversation.id, true);
    return subscribeToConversation(activeConversation.id, () => {
      void loadMessages(activeConversation.id, true);
    });
  }, [activeConversation, loadMessages]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const filteredConversations = useMemo(() => {
    if (!feed) return [];
    const query = search.trim().toLocaleLowerCase();
    return feed.conversations.filter((conversation) => {
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
        !query || match.person.name.toLocaleLowerCase().includes(query),
    );
  }, [feed, filter, search]);

  const openConversation = useCallback(
    (conversation: ActiveConversation) => {
      setNotice("");
      setMessageError("");
      setMessages([]);
      setDraft("");
      setIsLoadingMessages(true);
      setActiveConversation(conversation);
    },
    [],
  );

  const openExistingConversation = useCallback(
    (conversation: ChatConversation) => {
      openConversation({
        id: conversation.id,
        matchId: conversation.matchId,
        person: conversation.person,
      });
    },
    [openConversation],
  );

  const sendMessage = useCallback(async () => {
    const conversation = activeConversation;
    const body = draft.trim();
    if (!conversation || !body || isSending) return;
    setDraft("");
    setMessageError("");
    setIsSending(true);
    const temporaryId = `local-${Date.now()}`;
    const optimisticMessage: ChatMessage = {
      id: temporaryId,
      senderId: userId,
      body,
      attachment: null,
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
      void loadFeed(true);
    } catch (sendError) {
      setMessages((current) =>
        current.filter((message) => message.id !== temporaryId),
      );
      setDraft(body);
      setMessageError(
        sendError instanceof Error
          ? sendError.message
          : "Could not send this message.",
      );
    } finally {
      setIsSending(false);
    }
  }, [activeConversation, draft, isSending, loadFeed, userId]);

  const pickMedia = useCallback(async () => {
    const conversation = activeConversation;
    if (!conversation || isSending) return;
    setIsSending(true);
    setMessageError("");
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setMessageError("Allow photo library access to share images and videos.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsMultipleSelection: true,
        selectionLimit: 5,
        quality: 0.8,
      });
      if (result.canceled) return;

      for (const asset of result.assets) {
        const kind: ChatAttachmentKind =
          asset.type === "video" || asset.mimeType?.startsWith("video/")
            ? "video"
            : "image";
        const saved = await sendConversationAttachment(
          conversation.id,
          userId,
          asset.uri,
          kind,
          asset.mimeType,
        );
        setMessages((current) => [...current, saved]);
      }
      void loadFeed(true);
    } catch (pickerError) {
      setMessageError(
        pickerError instanceof Error
          ? pickerError.message
          : "Could not share this attachment.",
      );
    } finally {
      setIsSending(false);
    }
  }, [activeConversation, isSending, loadFeed, userId]);

  const startVoiceRecording = useCallback(async () => {
    if (!activeConversation || isSending || recordingStarted.current) return;
    recordingRequested.current = true;
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
  }, [activeConversation, isSending, recorder]);

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
    if (
      !recordingStarted.current ||
      recorderState.isRecording
    ) {
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
    if (!conversation) return;
    setIsSending(true);
    setMessageError("");
    void sendConversationAttachment(
      conversation.id,
      userId,
      recordingUri,
      "audio",
    )
      .then((saved) => {
        setMessages((current) => [...current, saved]);
        void loadFeed(true);
      })
      .catch((recordingError: unknown) => {
        setMessageError(
          recordingError instanceof Error
            ? recordingError.message
            : "Could not send this voice message.",
        );
      })
      .finally(() => setIsSending(false));
  }, [
    loadFeed,
    recorder,
    recorderState.isRecording,
    recorderState.url,
    userId,
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
      } else {
        await reportConversationMember(conversation.id, reportReason);
        setNotice("Report received. Our team will review it.");
      }
      setSafetyAction(null);
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
            disabled={isSending || isRecording}
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
            <Avatar person={activeConversation.person} size={42} styles={styles} />
            <View style={styles.chatHeaderCopy}>
              <View style={styles.nameWithBadge}>
                <Text numberOfLines={1} style={styles.chatHeaderName}>
                  {activeConversation.person.name}
                </Text>
                <View
                  accessibilityLabel="Your VEYRA match"
                  accessibilityRole="image"
                >
                  <Heart
                    color={colors.primary}
                    size={14}
                    fill={colors.primary}
                  />
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
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
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
                It’s a connection.
              </Text>
              <Text style={styles.connectionIntroCopy}>
                You and {activeConversation.person.name} liked each other. Start
                with something kind and curious.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setProfilePerson(activeConversation.person)}
                style={styles.profileLink}
              >
                <Text style={styles.profileLinkText}>View profile</Text>
              </Pressable>
            </View>
          ) : null}
          {isLoadingMessages ? (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          ) : null}
          {messages.map((message) => {
            const isMine = message.senderId === userId;
            return (
              <View
                key={message.id}
                style={[
                  styles.messageRow,
                  isMine ? styles.messageRowMine : styles.messageRowTheirs,
                ]}
              >
                <View
                  style={[
                    styles.messageBubble,
                    isMine ? styles.messageBubbleMine : styles.messageBubbleTheirs,
                  ]}
                >
                  {message.attachment ? (
                    <AttachmentView
                      attachment={message.attachment}
                      isMine={isMine}
                      colors={colors}
                      styles={styles}
                      onPreview={setPreviewAttachment}
                    />
                  ) : null}
                  {message.body && !message.attachment ? (
                    <Text
                      style={[
                        styles.messageBody,
                        isMine && styles.messageBodyMine,
                      ]}
                    >
                      {message.body}
                    </Text>
                  ) : null}
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
                        <CheckCheck
                          accessibilityLabel="Read"
                          color={colors.success}
                          size={14}
                          strokeWidth={2.5}
                        />
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
                </View>
              </View>
            );
          })}
          {messageError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {messageError}
            </Text>
          ) : null}
        </ScrollView>

        <EmojiPicker
          visible={isEmojiPickerVisible}
          colors={colors}
          onSelect={(emoji) => setDraft((current) => `${current}${emoji}`)}
          onClose={() => setIsEmojiPickerVisible(false)}
        />
        <View style={styles.composerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add an image or video"
            disabled={isSending}
            onPress={() => void pickMedia()}
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
              onChangeText={setDraft}
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
            {draft.trim() ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                disabled={isSending}
                onPress={() => void sendMessage()}
                style={[
                  styles.sendButton,
                  isSending && styles.sendButtonDisabled,
                ]}
              >
                {isSending ? (
                  <ActivityIndicator color={colors.textInverse} size="small" />
                ) : (
                  <Send color={colors.textInverse} size={17} />
                )}
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isRecording
                    ? "Release to send voice message"
                    : "Record voice message"
                }
                accessibilityState={{ disabled: isSending }}
                disabled={isSending}
                onPressIn={() => void startVoiceRecording()}
                onPressOut={() => void stopVoiceRecording()}
                style={[
                  styles.sendButton,
                  isRecording && styles.recordingButton,
                  isSending && styles.sendButtonDisabled,
                ]}
              >
                {isSending ? (
                  <ActivityIndicator color={colors.textInverse} size="small" />
                ) : (
                  <Mic
                    color={colors.textInverse}
                    size={18}
                    fill={isRecording ? colors.textInverse : "transparent"}
                  />
                )}
              </Pressable>
            )}
          </View>
        </View>

        <SafetyModal
          styles={styles}
          action={safetyAction}
          setAction={setSafetyAction}
          reportReason={reportReason}
          setReportReason={setReportReason}
          isSaving={isSavingSafety}
          onConfirm={() => void performSafetyAction()}
        />
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
            onClose={() => setPreviewAttachment(null)}
          />
        ) : null}
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.listHeader}>
        <Text style={styles.eyebrow}>MEANINGFUL CONVERSATIONS</Text>
        <Text style={styles.title}>Messages</Text>
        <Text style={styles.subtitle}>Your conversations, all in one place.</Text>
      </View>
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          accessibilityLabel="Search conversations"
          value={search}
          onChangeText={setSearch}
          placeholder="Search conversations…"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
        />
        {search ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => setSearch("")}
          >
            <Text style={styles.clearSearch}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.filters}>
        {(
          [
            ["all", "All"],
            ["unread", "Unread"],
            ["new", "New matches"],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === value }}
            onPress={() => setFilter(value)}
            style={[
              styles.filterButton,
              filter === value && styles.filterButtonActive,
            ]}
          >
            <Text
              style={[
                styles.filterText,
                filter === value && styles.filterTextActive,
              ]}
            >
              {label}
              {value === "unread" && feed
                ? ` ${feed.conversations.reduce(
                    (total, conversation) => total + conversation.unreadCount,
                    0,
                  )}`
                : value === "new" && feed?.newMatches.length
                  ? ` ${feed.newMatches.length}`
                  : ""}
            </Text>
          </Pressable>
        ))}
      </View>
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
          <ActivityIndicator color={colors.primary} />
        </View>
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
          ) : filter === "new" && feed?.newMatches.length === 0 ? (
            <EmptyMessage
              styles={styles}
              title="No new matches yet"
              body="When you and someone like each other, you can start a conversation here."
            />
          ) : null}
          {filter !== "new" && filteredConversations.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Conversations</Text>
              {filteredConversations.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  isOnline={onlineConversationIds.has(conversation.id)}
                  colors={colors}
                  styles={styles}
                  onPress={() => openExistingConversation(conversation)}
                />
              ))}
            </>
          ) : filter === "unread" && filteredConversations.length === 0 ? (
            <EmptyMessage
              styles={styles}
              title="You’re all caught up"
              body="Unread messages from your matches will show up here."
            />
          ) : filter === "all" &&
            feed?.conversations.length === 0 &&
            feed.newMatches.length === 0 ? (
            <EmptyMessage
              styles={styles}
              title="Your next connection starts here"
              body="When you and someone like each other, your private conversation will appear here."
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
}: {
  conversation: ChatConversation;
  isOnline: boolean;
  colors: SystemColors;
  styles: ChatStyles;
  onPress: () => void;
}) {
  const preview = conversation.lastMessage?.body ?? "Say hello to your match.";
  return (
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
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}
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
}: {
  attachment: NonNullable<ChatMessage["attachment"]>;
  isMine: boolean;
  colors: SystemColors;
  styles: ChatStyles;
  onPreview: (attachment: PreviewAttachment) => void;
}) {
  if (attachment.kind === "image") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View shared image"
        onPress={() => onPreview({ ...attachment, kind: "image" })}
      >
        <Image
          accessibilityLabel="Shared image"
          source={{ uri: attachment.url }}
          resizeMode="cover"
          style={styles.attachmentImage}
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
        <VideoMessageThumbnail attachment={{ ...attachment, kind: "video" }} />
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
    />
  );
}

function VideoMessageThumbnail({
  attachment,
}: {
  attachment: VideoPreviewAttachment;
}) {
  const player = useVideoPlayer(attachment.url, (videoPlayer) => {
    videoPlayer.muted = true;
    videoPlayer.pause();
  });
  return (
    <VideoView
      player={player}
      nativeControls={false}
      contentFit="cover"
      style={previewStyles.messageVideo}
    />
  );
}

function AttachmentPreview({
  attachment,
  onClose,
}: {
  attachment: PreviewAttachment;
  onClose: () => void;
}) {
  return attachment.kind === "image" ? (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={previewStyles.screen}>
        <Image
          accessibilityLabel="Shared image preview"
          source={{ uri: attachment.url }}
          resizeMode="contain"
          style={previewStyles.image}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close image"
          onPress={onClose}
          style={previewStyles.closeButton}
        >
          <X color="#FFFFFF" size={24} />
        </Pressable>
      </View>
    </Modal>
  ) : (
    <VideoAttachmentPreview
      attachment={attachment}
      onClose={onClose}
    />
  );
}

function VideoAttachmentPreview({
  attachment,
  onClose,
}: {
  attachment: VideoPreviewAttachment;
  onClose: () => void;
}) {
  const player = useVideoPlayer(attachment.url);
  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={previewStyles.screen}>
        <VideoView
          player={player}
          nativeControls
          contentFit="contain"
          style={previewStyles.video}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close video"
          onPress={onClose}
          style={previewStyles.closeButton}
        >
          <X color="#FFFFFF" size={24} />
        </Pressable>
      </View>
    </Modal>
  );
}

function AudioAttachment({
  attachment,
  isMine,
  colors,
  styles,
}: {
  attachment: NonNullable<ChatMessage["attachment"]>;
  isMine: boolean;
  colors: SystemColors;
  styles: ChatStyles;
}) {
  const player = useAudioPlayer(attachment.url);
  const status = useAudioPlayerStatus(player);
  const duration = Number.isFinite(status.duration) ? status.duration : 0;
  const currentTime = Number.isFinite(status.currentTime) ? status.currentTime : 0;
  const progress = duration > 0 ? Math.min(currentTime / duration, 1) : 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${status.playing ? "Pause" : "Play"} voice message, ${formatMediaDuration(duration)} total`}
      onPress={() => (status.playing ? player.pause() : player.play())}
      style={styles.audioAttachment}
    >
      {status.playing ? (
        <Pause color={isMine ? colors.textInverse : colors.primary} size={19} />
      ) : (
        <Play color={isMine ? colors.textInverse : colors.primary} size={19} />
      )}
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
          style={[
            styles.audioAttachmentText,
            isMine && styles.messageBodyMine,
          ]}
        >
          {formatMediaDuration(currentTime)} / {formatMediaDuration(duration)}
        </Text>
      </View>
    </Pressable>
  );
}

const AUDIO_WAVEFORM = [
  8, 13, 18, 11, 22, 16, 10, 19, 25, 14, 9, 17, 23, 12, 19, 10, 15, 21, 12,
  8,
];

const previewStyles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "#000000",
  },
  image: {
    width: "100%",
    height: "100%",
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
});

function formatMediaDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainingSeconds}`;
}

function isExpiredSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /session.{0,40}(invalid|expired)|(invalid|expired).{0,40}session|jwt.{0,20}(invalid|expired)|(invalid|expired).{0,20}jwt/i.test(
    message,
  );
}

function SafetyModal({
  action,
  styles,
  setAction,
  reportReason,
  setReportReason,
  isSaving,
  onConfirm,
}: {
  action: SafetyAction;
  styles: ChatStyles;
  setAction: (action: SafetyAction) => void;
  reportReason: ReportReason;
  setReportReason: (reason: ReportReason) => void;
  isSaving: boolean;
  onConfirm: () => void;
}) {
  const title =
    action === "menu"
      ? "Your safety comes first"
      : action === "report"
      ? "Report this member"
      : action === "block"
        ? "Block this member?"
        : "Unmatch?";
  const copy =
    action === "menu"
      ? "Choose how you’d like to manage this connection."
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
          <Text style={styles.safetyTitle}>{title}</Text>
          <Text style={styles.safetyCopy}>{copy}</Text>
          {action === "menu" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setAction("unmatch")}
              style={styles.safetyMenuItem}
            >
              <Text style={styles.safetyMenuText}>Unmatch</Text>
            </Pressable>
          ) : null}
          {action === "menu" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setAction("block")}
              style={styles.safetyMenuItem}
            >
              <Text style={styles.safetyMenuText}>Block this member</Text>
            </Pressable>
          ) : null}
          {action === "menu" ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setAction("report")}
              style={styles.safetyMenuItem}
            >
              <Text style={styles.safetyMenuText}>Report this member</Text>
            </Pressable>
          ) : null}
          {action === "report"
            ? REPORT_REASONS.map((reason) => (
                <Pressable
                  key={reason.value}
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
          {action === "report" || action === "block" ? (
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={onConfirm}
              style={styles.safetyConfirm}
            >
              <Text style={styles.safetyConfirmText}>
                {isSaving
                  ? "Saving…"
                  : action === "report"
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
              <View style={styles.profileHero}>
                {person.image ? (
                  <Image
                    accessibilityLabel={`${person.name}'s profile photo`}
                    source={{ uri: person.image }}
                    resizeMode="cover"
                    style={styles.profileHeroImage}
                  />
                ) : (
                  <View style={styles.profileHeroPlaceholder}>
                    <Text style={styles.profileHeroInitial}>
                      {person.name.trim().slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <LinearGradient
                  pointerEvents="none"
                  colors={["transparent", "rgba(0,0,0,0.78)"]}
                  style={styles.profileHeroGradient}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close profile"
                  onPress={onClose}
                  style={styles.profileCloseButton}
                >
                  <X color="#FFFFFF" size={22} />
                </Pressable>
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
              </View>
              <ScrollView
                style={styles.profileDetailsScroll}
                contentContainerStyle={styles.profileDetails}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.profileStatusRow}>
                  <View style={styles.profileConnectionBadge}>
                    <Heart
                      color={colors.primary}
                      fill={colors.primary}
                      size={14}
                    />
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

const createStyles = (colors: SystemColors) =>
  StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    paddingTop: 15,
  },
  listHeader: {
    marginBottom: 15,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.8,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "700",
    marginTop: 3,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
  searchWrap: {
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
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    paddingVertical: 9,
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
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.surfaceSecondary,
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
  },
  filterText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "700",
  },
  filterTextActive: {
    color: colors.textInverse,
  },
  conversationList: {
    flexGrow: 1,
    paddingBottom: 12,
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
    color: colors.primary,
    fontSize: 9,
    marginTop: 3,
  },
  conversationRow: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
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
    color: colors.primary,
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
    backgroundColor: colors.primary,
  },
  retryText: {
    color: colors.textInverse,
    fontSize: 11,
    fontWeight: "700",
  },
  empty: {
    alignItems: "center",
    paddingHorizontal: 26,
    paddingVertical: 38,
  },
  emptyMark: {
    color: colors.primary,
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
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingBottom: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  headerIconButton: {
    width: 34,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  headerIcon: {
    color: colors.primary,
    fontSize: 32,
    lineHeight: 34,
  },
  chatHeaderPerson: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
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
    paddingHorizontal: 3,
    paddingTop: 16,
    paddingBottom: 16,
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
    color: colors.primary,
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
  profileLink: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    marginTop: 10,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  profileLinkText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "700",
  },
  loading: {
    marginVertical: 12,
  },
  messageRow: {
    width: "100%",
    flexDirection: "row",
    marginVertical: 4,
  },
  messageRowMine: {
    justifyContent: "flex-end",
  },
  messageRowTheirs: {
    justifyContent: "flex-start",
  },
  messageBubble: {
    maxWidth: "82%",
    paddingHorizontal: 13,
    paddingTop: 9,
    paddingBottom: 7,
    borderRadius: 17,
  },
  messageBubbleMine: {
    borderBottomRightRadius: 5,
    backgroundColor: colors.primary,
  },
  messageBubbleTheirs: {
    borderBottomLeftRadius: 5,
    backgroundColor: colors.surfaceSecondary,
  },
  messageBody: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  messageBodyMine: {
    color: colors.textInverse,
  },
  attachmentImage: {
    width: 220,
    height: 190,
    borderRadius: 12,
    marginBottom: 5,
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
    minWidth: 205,
    maxWidth: 245,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingVertical: 4,
    paddingBottom: 7,
  },
  audioPlaybackInfo: {
    flex: 1,
    gap: 2,
  },
  audioWaveform: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 2,
  },
  audioWaveBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  audioWaveBarActive: {
    backgroundColor: colors.primary,
  },
  audioWaveBarActiveMine: {
    backgroundColor: colors.textInverse,
  },
  audioAttachmentText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },
  messageTime: {
    color: colors.textMuted,
    fontSize: 8,
    textAlign: "right",
    marginTop: 4,
  },
  messageTimeMine: {
    color: colors.textInverse,
  },
  messageMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 3,
    marginTop: 4,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 7,
    paddingTop: 7,
  },
  composerIconButton: {
    width: 38,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
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
    borderRadius: 25,
    backgroundColor: colors.inputBackground,
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
    backgroundColor: colors.primary,
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
  safetyModal: {
    width: "100%",
    maxWidth: 420,
    padding: 21,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  safetyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  safetyCopy: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 7,
    marginBottom: 10,
  },
  safetyMenuItem: {
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  safetyMenuText: {
    color: colors.primary,
    fontSize: 12,
  },
  reportReason: {
    paddingVertical: 9,
  },
  reportSelected: {
    color: colors.primary,
    fontWeight: "700",
  },
  safetyConfirm: {
    alignItems: "center",
    paddingVertical: 12,
    marginTop: 10,
    borderRadius: 20,
    backgroundColor: colors.primary,
  },
  safetyConfirmText: {
    color: colors.textInverse,
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
  profileHero: {
    height: 285,
    position: "relative",
    backgroundColor: colors.surfaceSecondary,
  },
  profileHeroImage: {
    ...StyleSheet.absoluteFill,
    width: "100%",
    height: "100%",
  },
  profileHeroPlaceholder: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  profileHeroInitial: {
    color: colors.primary,
    fontSize: 68,
    fontWeight: "700",
  },
  profileHeroGradient: {
    ...StyleSheet.absoluteFill,
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
    position: "absolute",
    right: 20,
    bottom: 18,
    left: 20,
  },
  profileNameLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  profileHeroName: {
    flexShrink: 1,
    color: "#FFFFFF",
    fontSize: 25,
    fontWeight: "700",
  },
  profileHeroMeta: {
    color: "rgba(255,255,255,0.88)",
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
    color: colors.primary,
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

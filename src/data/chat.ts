import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { readLocalFile } from "../lib/localFile";
import { supabaseClient } from "../lib/supabaseClient";

const CHAT_ATTACHMENTS_BUCKET = "chat-attachments";
const CHAT_VIEW_ONCE_BUCKET = "chat-view-once";
const CHAT_ATTACHMENT_MARKER = "__veyra_attachment__:";
const VIEW_ONCE_MARKER = "__veyra_view_once__:";
const SIGNED_URL_LIFETIME_SECONDS = 60 * 60;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024;

export type ChatAttachmentKind = "image" | "video" | "audio";
export type ChatAttachment = {
  kind: ChatAttachmentKind;
  path: string;
  url: string;
  caption?: string;
  attachmentIndex?: number;
  viewOnce?: boolean;
  openedAt?: string | null;
  expiresAt?: string | null;
};
export type ChatDraftAttachment = {
  uri: string;
  kind: "image" | "video";
  mimeType?: string | null;
  caption: string;
  viewOnce: boolean;
};
export type ChatReactionValue =
  | "heart"
  | "laugh"
  | "wow"
  | "celebrate"
  | "support";
export type ChatMessageReaction = {
  value: ChatReactionValue;
  count: number;
  reactedByMe: boolean;
};

export type ChatPerson = {
  id: string;
  name: string;
  age: number | null;
  city: string | null;
  image: string | null;
  photos: string[];
  identityVerified: boolean;
  bio: string;
  occupation: string;
  interests: string[];
  intentions: string[];
};

export type ChatMessage = {
  id: string;
  senderId: string;
  body: string;
  hasCaption?: boolean;
  replyQuote: string | null;
  reactions: ChatMessageReaction[];
  attachment: ChatAttachment | null;
  attachments: ChatAttachment[];
  deletedForEveryone: boolean;
  viewOnce: boolean;
  viewOnceOpenedAt: string | null;
  viewOnceExpiresAt: string | null;
  createdAt: string;
  readAt: string | null;
};

export type ChatConversation = {
  id: string;
  matchId: string;
  person: ChatPerson;
  lastMessage: ChatMessage | null;
  unreadCount: number;
  archivedAt: string | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewChatMatch = {
  conversationId: string;
  matchId: string;
  person: ChatPerson;
  createdAt: string;
};

export type ChatFeed = {
  conversations: ChatConversation[];
  newMatches: NewChatMatch[];
  cleanupWarning: string | null;
};

export async function getChatFeed(): Promise<ChatFeed> {
  const { data, error } = await getClient().functions.invoke<unknown>(
    "daily-discovery",
    { body: { operation: "chat-feed", timezone: getLocalTimezone() } },
  );
  if (error) {
    throw new Error(
      `Could not load messages: ${await getFunctionErrorMessage(error)}`,
    );
  }
  if (
    !isRecord(data) ||
    !Array.isArray(data.conversations) ||
    !Array.isArray(data.new_matches) ||
    (data.cleanup_warning !== undefined &&
      data.cleanup_warning !== null &&
      typeof data.cleanup_warning !== "string")
  ) {
    throw new Error("The conversations response was invalid.");
  }
  const conversations = await Promise.all(
    data.conversations.map(async (value) => {
      const conversation = normalizeConversation(value);
      return {
        ...conversation,
        lastMessage: conversation.lastMessage
          ? await signMessageAttachment(conversation.lastMessage)
          : null,
      };
    }),
  );
  return {
    conversations,
    newMatches: data.new_matches.map(normalizeNewMatch),
    cleanupWarning:
      typeof data.cleanup_warning === "string" ? data.cleanup_warning : null,
  };
}

export async function getChatLockPinConfigured(): Promise<boolean> {
  const { data, error } = await getClient().functions.invoke<unknown>(
    "daily-discovery",
    { body: { operation: "chat-lock-pin-status" } },
  );
  if (error) {
    throw new Error(
      `Could not check Lock Chats setup: ${await getFunctionErrorMessage(error)}`,
    );
  }
  if (!isRecord(data) || typeof data.configured !== "boolean") {
    throw new Error("The Lock Chats setup response was invalid.");
  }
  return data.configured;
}

export async function revokeLockedChatAccess(): Promise<void> {
  const { data, error } = await getClient().functions.invoke<unknown>(
    "daily-discovery",
    { body: { operation: "locked-chat-access-revoke" } },
  );
  if (error) {
    throw new Error(
      `Could not close Locked Chats: ${await getFunctionErrorMessage(error)}`,
    );
  }
  if (!isRecord(data) || data.revoked !== true) {
    throw new Error("Locked Chats access could not be revoked.");
  }
}

export async function setChatLockPin(pin: string): Promise<void> {
  await saveChatLockPin(getClient(), pin);
}

export async function resetChatLockPin(
  pin: string,
  password: string,
): Promise<void> {
  const client = getClient();
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (userError) {
    throw new Error(`Could not verify your account: ${userError.message}`);
  }
  if (!user?.email) {
    throw new Error(
      "A verified email and password are required to reset your Lock Chats PIN.",
    );
  }

  const { data, error } = await client.functions.invoke<unknown>(
    "daily-discovery",
    {
      body: {
        operation: "chat-lock-pin-reset",
        pin,
        password,
      },
    },
  );
  if (error) {
    throw new Error(
      `Could not reset your Lock Chats PIN: ${await getFunctionErrorMessage(error)}`,
    );
  }
  if (!isRecord(data) || data.saved !== true) {
    throw new Error("The Lock Chats PIN could not be reset.");
  }
}

async function saveChatLockPin(
  client: ReturnType<typeof getClient>,
  pin: string,
): Promise<void> {
  const { data, error } = await client.functions.invoke<unknown>(
    "daily-discovery",
    { body: { operation: "chat-lock-pin-set", pin } },
  );
  if (error) {
    throw new Error(
      `Could not save your Lock Chats PIN: ${await getFunctionErrorMessage(error)}`,
    );
  }
  if (!isRecord(data) || data.saved !== true) {
    throw new Error("The Lock Chats PIN could not be saved.");
  }
}

export async function getLockedChatFeed(pin: string): Promise<ChatConversation[]> {
  const { data, error } = await getClient().functions.invoke<unknown>(
    "daily-discovery",
    {
      body: {
        operation: "locked-chat-feed",
        pin,
        timezone: getLocalTimezone(),
      },
    },
  );
  if (error) {
    throw new Error(
      `Could not open Locked Chats: ${await getFunctionErrorMessage(error)}`,
    );
  }
  if (!isRecord(data) || !Array.isArray(data.conversations)) {
    throw new Error("The Locked Chats response was invalid.");
  }
  const conversations = data.conversations.map(normalizeConversation);
  return Promise.all(
    conversations.map(async (conversation) => ({
      ...conversation,
      lastMessage: conversation.lastMessage
        ? await signMessageAttachment(conversation.lastMessage)
        : null,
    })),
  );
}

export async function getConversationMessages(
  conversationId: string,
): Promise<ChatMessage[]> {
  const { data, error } = await getClient().rpc(
    "get_conversation_messages",
    { p_conversation_id: conversationId },
  );
  if (error) throw new Error(`Could not load conversation: ${error.message}`);
  if (!Array.isArray(data)) {
    throw new Error("The conversation messages were invalid.");
  }
  return Promise.all(data.map(normalizeMessage).map(signMessageAttachment));
}

export async function sendConversationMessage(
  conversationId: string,
  body: string,
): Promise<ChatMessage> {
  const { data, error } = await getClient().rpc(
    "send_conversation_message",
    { p_conversation_id: conversationId, p_body: body },
  );
  if (error) throw new Error(`Could not send message: ${error.message}`);
  return signMessageAttachment(normalizeMessage(data));
}

export async function setConversationMessageReaction(
  messageId: string,
  reaction: ChatReactionValue,
): Promise<void> {
  const { error } = await getClient().rpc(
    "set_conversation_message_reaction",
    { p_message_id: messageId, p_reaction: reaction },
  );
  if (error) throw new Error(`Could not save reaction: ${error.message}`);
}

export async function hideConversationMessage(
  messageId: string,
): Promise<void> {
  const { error } = await getClient().rpc("hide_conversation_message", {
    p_message_id: messageId,
  });
  if (error) throw new Error(`Could not delete message for you: ${error.message}`);
}

export async function deleteConversationMessageForEveryone(
  messageId: string,
): Promise<void> {
  const { data, error } = await getClient().functions.invoke<unknown>(
    "daily-discovery",
    {
      body: {
        operation: "delete-message-for-everyone",
        message_id: messageId,
      },
    },
  );
  if (error) {
    throw new Error(
      `Could not delete this message for everyone: ${await getFunctionErrorMessage(error)}`,
    );
  }
  if (
    !isRecord(data) ||
    data.deleted !== true ||
    data.cleanup_pending !== false
  ) {
    throw new Error("The message deletion response was invalid.");
  }
}

export async function sendConversationAttachment(
  conversationId: string,
  userId: string,
  uri: string,
  kind: ChatAttachmentKind,
  mimeType?: string | null,
  viewOnce = false,
): Promise<ChatMessage> {
  const path = await uploadConversationAttachment(
    conversationId,
    userId,
    uri,
    kind,
    mimeType,
    viewOnce ? CHAT_VIEW_ONCE_BUCKET : CHAT_ATTACHMENTS_BUCKET,
  );
  if (viewOnce) {
    const client = getClient();
    const { data, error } = await client.rpc(
      "send_view_once_conversation_message",
      {
        p_conversation_id: conversationId,
        p_media_kind: kind,
        p_object_path: path,
      },
    );
    if (error) {
      const { error: cleanupError } = await client.storage
        .from(CHAT_VIEW_ONCE_BUCKET)
        .remove([path]);
      if (cleanupError) {
        throw new Error(
          `Could not send this View Once attachment (${error.message}); its temporary upload could not be removed (${cleanupError.message}).`,
        );
      }
      throw new Error(`Could not send this View Once attachment: ${error.message}`);
    }
    return normalizeMessage(data);
  }
  return sendConversationMessage(
    conversationId,
    `${CHAT_ATTACHMENT_MARKER}${JSON.stringify({ kind, path })}`,
  );
}

export async function sendConversationAttachments(
  conversationId: string,
  userId: string,
  attachments: {
    uri: string;
    kind: ChatAttachmentKind;
    mimeType?: string | null;
  }[],
): Promise<ChatMessage> {
  if (attachments.length < 1 || attachments.length > 5) {
    throw new Error("Choose between one and five photos or videos.");
  }
  if (attachments.length === 1) {
    const [attachment] = attachments;
    return sendConversationAttachment(
      conversationId,
      userId,
      attachment.uri,
      attachment.kind,
      attachment.mimeType,
    );
  }

  const uploaded: Omit<ChatAttachment, "url">[] = [];
  for (const attachment of attachments) {
    const path = await uploadConversationAttachment(
      conversationId,
      userId,
      attachment.uri,
      attachment.kind,
      attachment.mimeType,
    );
    uploaded.push({ path, kind: attachment.kind });
  }
  return sendConversationMessage(
    conversationId,
    `${CHAT_ATTACHMENT_MARKER}${JSON.stringify({
      kind: "group",
      items: uploaded,
    })}`,
  );
}

export async function sendConversationDraft(
  conversationId: string,
  userId: string,
  text: string,
  replyQuote: string | null,
  attachments: ChatDraftAttachment[],
  onUploadProgress: (completed: number, total: number) => void,
): Promise<ChatMessage> {
  if (attachments.length > 5) {
    throw new Error("A message can include up to five photos or videos.");
  }
  if (!text.trim() && attachments.length === 0) {
    throw new Error("Write a message or attach a photo or video.");
  }
  if (text.length > 2000) {
    throw new Error("Messages must be 2000 characters or fewer.");
  }

  const uploaded: { bucket: string; path: string }[] = [];
  const mediaItems: {
    kind: "image" | "video";
    path?: string;
    caption?: string;
    viewOnce?: true;
  }[] = [];
  const protectedItems: {
    attachment_index: number;
    media_kind: "image" | "video";
    object_path: string;
  }[] = [];
  let messageCommitted = false;

  try {
    for (const [index, attachment] of attachments.entries()) {
      onUploadProgress(index, attachments.length);
      const bucket = attachment.viewOnce
        ? CHAT_VIEW_ONCE_BUCKET
        : CHAT_ATTACHMENTS_BUCKET;
      const path = await uploadConversationAttachment(
        conversationId,
        userId,
        attachment.uri,
        attachment.kind,
        attachment.mimeType,
        bucket,
      );
      uploaded.push({ bucket, path });
      mediaItems.push({
        kind: attachment.kind,
        ...(attachment.caption.trim()
          ? { caption: attachment.caption.trim() }
          : {}),
        ...(attachment.viewOnce ? { viewOnce: true } : { path }),
      });
      if (attachment.viewOnce) {
        protectedItems.push({
          attachment_index: index,
          media_kind: attachment.kind,
          object_path: path,
        });
      }
      onUploadProgress(index + 1, attachments.length);
    }

    const body = `${CHAT_ATTACHMENT_MARKER}${JSON.stringify({
      kind: "draft",
      text: text.trim(),
      replyQuote,
      items: mediaItems,
    })}`;
    if (body.length > 2000) {
      throw new Error(
        "This message is too long with its attachment captions. Shorten the text or captions and try again.",
      );
    }

    const client = getClient();
    let data: unknown;
    if (protectedItems.length > 0) {
      const result = await client.rpc(
        "send_view_once_conversation_message",
        {
          p_conversation_id: conversationId,
          p_body: body,
          p_media_items: protectedItems,
        },
      );
      if (result.error) {
        throw new Error(`Could not send message: ${result.error.message}`);
      }
      data = result.data;
    } else {
      const result = await client.rpc("send_conversation_message", {
        p_conversation_id: conversationId,
        p_body: body,
      });
      if (result.error) {
        throw new Error(`Could not send message: ${result.error.message}`);
      }
      data = result.data;
    }
    messageCommitted = true;
    return normalizeMessage(data);
  } catch (sendError) {
    if (messageCommitted) throw sendError;
    const cleanupFailures: string[] = [];
    for (const bucket of [CHAT_ATTACHMENTS_BUCKET, CHAT_VIEW_ONCE_BUCKET]) {
      const paths = uploaded
        .filter((item) => item.bucket === bucket)
        .map((item) => item.path);
      if (paths.length === 0) continue;
      const { error } = await getClient().storage.from(bucket).remove(paths);
      if (error) cleanupFailures.push(`${bucket}: ${error.message}`);
    }
    const message = sendError instanceof Error
      ? sendError.message
      : "Could not send this message.";
    if (cleanupFailures.length > 0) {
      throw new Error(
        `${message} Some temporary uploads could not be removed (${cleanupFailures.join("; ")}).`,
        { cause: sendError },
      );
    }
    throw sendError;
  }
}

async function uploadConversationAttachment(
  conversationId: string,
  userId: string,
  uri: string,
  kind: ChatAttachmentKind,
  mimeType?: string | null,
  bucket = CHAT_ATTACHMENTS_BUCKET,
): Promise<string> {
  let bytes: Uint8Array;
  let localMimeType: string;
  try {
    ({ bytes, type: localMimeType } = await readLocalFile(uri));
  } catch (cause) {
    throw new Error("The selected attachment could not be read.", { cause });
  }
  if (!bytes.byteLength) throw new Error("The selected attachment is empty.");

  const contentType = resolveAttachmentContentType(
    mimeType || localMimeType,
    uri,
    kind,
  );
  const maxBytes =
    kind === "image"
      ? MAX_IMAGE_SIZE_BYTES
      : kind === "video"
        ? MAX_VIDEO_SIZE_BYTES
        : MAX_AUDIO_SIZE_BYTES;
  if (bytes.byteLength > maxBytes) {
    const maxMegabytes = maxBytes / 1024 / 1024;
    throw new Error(
      `${kind === "image" ? "Images" : kind === "video" ? "Videos" : "Audio"} must be ${maxMegabytes} MB or smaller.`,
    );
  }

  const extension = getAttachmentExtension(uri, contentType);
  const path = `${conversationId}/${userId}/${randomUUID()}.${extension}`;
  const { error } = await getClient().storage
    .from(bucket)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(`Could not upload the attachment: ${error.message}`);
  return path;
}

async function signMessageAttachment(
  message: ChatMessage,
): Promise<ChatMessage> {
  if (message.attachments.length === 0) return message;
  const signedAttachments = await Promise.all(
    message.attachments.map(async (attachment) => {
      if (attachment.viewOnce) return attachment;
      const { data, error } = await getClient()
        .storage.from(CHAT_ATTACHMENTS_BUCKET)
        .createSignedUrl(attachment.path, SIGNED_URL_LIFETIME_SECONDS);
      if (error) {
        throw new Error(`Could not load a chat attachment: ${error.message}`);
      }
      return { ...attachment, url: data.signedUrl };
    }),
  );
  return {
    ...message,
    attachment: signedAttachments[0] ?? null,
    attachments: signedAttachments,
  };
}

export async function downloadViewOnceMedia(
  messageId: string,
  kind: ChatAttachmentKind,
  attachmentIndex = 0,
): Promise<string> {
  const client = getClient();
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase is not configured. Protected media is unavailable.");
  }
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();
  if (sessionError) {
    throw new Error(`Could not verify your session: ${sessionError.message}`);
  }
  if (!session) throw new Error("Sign in to open this attachment.");

  const mediaUrl =
    `${supabaseUrl}/functions/v1/daily-discovery?message_id=${encodeURIComponent(messageId)}&attachment_index=${attachmentIndex}`;
  const requestHeaders = {
    apikey: anonKey,
    Authorization: `Bearer ${session.access_token}`,
  };
  let fileUri: string | null = null;
  try {
    if (Platform.OS === "web") {
      const response = await fetch(mediaUrl, { headers: requestHeaders });
      if (!response.ok) {
        let detail = `The protected media request failed (HTTP ${response.status}).`;
        try {
          const responseBody: unknown = await response.json();
          if (
            typeof responseBody === "object" &&
            responseBody !== null &&
            "error" in responseBody &&
            typeof responseBody.error === "string"
          ) {
            detail = responseBody.error;
          }
        } catch {
          // Keep the HTTP status as the actionable fallback for non-JSON responses.
        }
        throw new Error(detail);
      }
      return URL.createObjectURL(await response.blob());
    }

    const extension = kind === "image" ? "jpg" : kind === "video" ? "mp4" : "m4a";
    const cacheRoot = LegacyFileSystem.cacheDirectory;
    if (!cacheRoot) {
      throw new Error("Protected media storage is unavailable on this device.");
    }
    const cacheDirectory = `${cacheRoot}veyra-view-once/`;
    if (!(await LegacyFileSystem.getInfoAsync(cacheDirectory)).exists) {
      await LegacyFileSystem.makeDirectoryAsync(cacheDirectory, {
        intermediates: true,
      });
    }
    for (const cachedFile of await LegacyFileSystem.readDirectoryAsync(cacheDirectory)) {
      await LegacyFileSystem.deleteAsync(`${cacheDirectory}${cachedFile}`, {
        idempotent: true,
      });
    }
    fileUri = `${cacheDirectory}${randomUUID()}.${extension}`;
    const result = await LegacyFileSystem.downloadAsync(
      mediaUrl,
      fileUri,
      { headers: requestHeaders },
    );
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`The protected media request failed (HTTP ${result.status}).`);
    }
    return result.uri;
  } catch (cause) {
    let cleanupError = "";
    if (Platform.OS !== "web" && fileUri) {
      try {
        await LegacyFileSystem.deleteAsync(fileUri, { idempotent: true });
      } catch (fileError) {
        cleanupError = fileError instanceof Error
          ? ` Temporary file cleanup failed: ${fileError.message}`
          : " Temporary file cleanup failed.";
      }
    }
    throw new Error(
      `${cause instanceof Error
        ? `Could not open this View Once attachment: ${cause.message}`
        : "Could not open this View Once attachment."}${cleanupError}`,
      { cause },
    );
  }
}

export function deleteLocalChatFile(uri: string): void {
  const file = new File(uri);
  if (file.exists) file.delete();
}

export async function deleteLocalViewOnceFile(uri: string): Promise<void> {
  if (Platform.OS === "web") {
    if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
    return;
  }
  await LegacyFileSystem.deleteAsync(uri, { idempotent: true });
}

export async function clearViewOnceLocalCache(): Promise<void> {
  if (Platform.OS === "web") return;
  const cacheRoot = LegacyFileSystem.cacheDirectory;
  if (!cacheRoot) {
    throw new Error("Protected media storage is unavailable on this device.");
  }
  const cacheDirectory = `${cacheRoot}veyra-view-once/`;
  const directoryInfo = await LegacyFileSystem.getInfoAsync(cacheDirectory);
  if (!directoryInfo.exists) return;
  for (const cachedFile of await LegacyFileSystem.readDirectoryAsync(cacheDirectory)) {
    await LegacyFileSystem.deleteAsync(`${cacheDirectory}${cachedFile}`, {
      idempotent: true,
    });
  }
}

export async function markConversationRead(
  conversationId: string,
): Promise<void> {
  const { error } = await getClient().rpc("mark_conversation_read", {
    p_conversation_id: conversationId,
  });
  if (error) throw new Error(`Could not update read status: ${error.message}`);
}

export async function unmatchConversation(
  conversationId: string,
): Promise<void> {
  const { error } = await getClient().rpc("unmatch_conversation", {
    p_conversation_id: conversationId,
  });
  if (error) throw new Error(`Could not end this match: ${error.message}`);
}

export async function reportConversationMember(
  conversationId: string,
  reason: "inappropriate" | "harassment" | "spam" | "fake_profile" | "other",
): Promise<void> {
  const { error } = await getClient().rpc("report_conversation_member", {
    p_conversation_id: conversationId,
    p_reason: reason,
  });
  if (error) throw new Error(`Could not submit report: ${error.message}`);
}

export async function setConversationArchived(
  conversationId: string,
  archived: boolean,
): Promise<void> {
  const { error } = await getClient().rpc("set_conversation_archived", {
    p_conversation_id: conversationId,
    p_archived: archived,
  });
  if (error) {
    throw new Error(
      `Could not ${archived ? "archive" : "restore"} this conversation: ${error.message}`,
    );
  }
}

export async function setConversationLocked(
  conversationId: string,
  locked: boolean,
): Promise<void> {
  const { error } = await getClient().rpc("set_conversation_locked", {
    p_conversation_id: conversationId,
    p_locked: locked,
  });
  if (error) {
    throw new Error(
      `Could not ${locked ? "lock" : "unlock"} this conversation: ${error.message}`,
    );
  }
}

export function subscribeToConversation(
  conversationId: string,
  onChange: () => void,
): () => void {
  const client = getClient();
  const channel = client
    .channel(`conversation:${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      onChange,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "conversation_message_reactions",
        filter: `conversation_id=eq.${conversationId}`,
      },
      onChange,
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "conversation_message_events",
        filter: `conversation_id=eq.${conversationId}`,
      },
      onChange,
    )
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}

export function subscribeToConversationList(
  conversationIds: readonly string[],
  onChange: () => void,
): () => void {
  const client = getClient();
  const channels = Array.from(new Set(conversationIds)).map(
    (conversationId) =>
      client
        .channel(`conversation-list:${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          onChange,
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "conversation_message_events",
            filter: `conversation_id=eq.${conversationId}`,
          },
          onChange,
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") onChange();
        }),
  );

  return () => {
    channels.forEach((channel) => void client.removeChannel(channel));
  };
}

function normalizeConversation(value: unknown): ChatConversation {
  if (
    !isRecord(value) ||
    typeof value.conversation_id !== "string" ||
    typeof value.match_id !== "string" ||
    !Number.isInteger(value.unread_count) ||
    (value.unread_count as number) < 0 ||
    (value.archived_at !== undefined &&
      value.archived_at !== null &&
      typeof value.archived_at !== "string") ||
    (value.locked_at !== undefined &&
      value.locked_at !== null &&
      typeof value.locked_at !== "string") ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    throw new Error("A conversation in the response was invalid.");
  }
  return {
    id: value.conversation_id,
    matchId: value.match_id,
    person: normalizePerson(value.other_profile),
    lastMessage:
      value.last_message === null
        ? null
        : normalizeMessage(value.last_message),
    unreadCount: value.unread_count as number,
    archivedAt: typeof value.archived_at === "string"
      ? value.archived_at
      : null,
    lockedAt: typeof value.locked_at === "string" ? value.locked_at : null,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function normalizeNewMatch(value: unknown): NewChatMatch {
  if (
    !isRecord(value) ||
    typeof value.conversation_id !== "string" ||
    typeof value.match_id !== "string" ||
    typeof value.created_at !== "string"
  ) {
    throw new Error("A new match in the response was invalid.");
  }
  return {
    conversationId: value.conversation_id,
    matchId: value.match_id,
    person: normalizePerson(value.other_profile),
    createdAt: value.created_at,
  };
}

function normalizePerson(value: unknown): ChatPerson {
  if (
    !isRecord(value) ||
    typeof value.candidate_id !== "string" ||
    typeof value.nickname !== "string" ||
    (value.age !== null && typeof value.age !== "number") ||
    (value.city !== null && typeof value.city !== "string") ||
    (value.image !== null && typeof value.image !== "string") ||
    (value.photos !== undefined && !isStringArray(value.photos)) ||
    typeof value.identity_verified !== "boolean" ||
    typeof value.bio !== "string" ||
    typeof value.occupation !== "string" ||
    !isStringArray(value.interests) ||
    !isStringArray(value.intentions)
  ) {
    throw new Error("A match profile in the response was invalid.");
  }
  return {
    id: value.candidate_id,
    name: value.nickname,
    age: value.age,
    city: value.city,
    image: value.image,
    photos: isStringArray(value.photos)
      ? value.photos
      : value.image
        ? [value.image]
        : [],
    identityVerified: value.identity_verified,
    bio: value.bio,
    occupation: value.occupation,
    interests: value.interests,
    intentions: value.intentions,
  };
}

function normalizeMessage(value: unknown): ChatMessage {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.sender_id !== "string" ||
    typeof value.body !== "string" ||
    typeof value.created_at !== "string" ||
    (value.read_at !== null && typeof value.read_at !== "string")
  ) {
    throw new Error("A conversation message was invalid.");
  }
  const rawBody = value.body as string;
  const legacyViewOnce =
    value.view_once === true || rawBody.startsWith(VIEW_ONCE_MARKER);
  const viewOnceKind = isChatAttachmentKind(value.view_once_kind)
    ? value.view_once_kind
    : legacyViewOnce
      ? getViewOnceKindFromBody(rawBody)
      : null;
  if (legacyViewOnce && !viewOnceKind) {
    throw new Error("The View Once attachment details were invalid.");
  }
  const draft = parseDraftAttachmentBody(rawBody);
  const metadata = normalizeViewOnceItems(value.view_once_items);
  const attachments = legacyViewOnce && viewOnceKind
    ? [{
        kind: viewOnceKind,
        path: "",
        viewOnce: true,
        attachmentIndex: 0,
        openedAt:
          typeof value.view_once_opened_at === "string"
            ? value.view_once_opened_at
            : null,
        expiresAt:
          typeof value.view_once_expires_at === "string"
            ? value.view_once_expires_at
            : null,
      }]
    : draft?.attachments ?? parseAttachmentBody(rawBody);
  const attachmentsWithStatus = attachments.map((attachment) => {
    if (!attachment.viewOnce) return attachment;
    const itemStatus = metadata.find(
      (item) => item.attachmentIndex === attachment.attachmentIndex,
    );
    return {
      ...attachment,
      openedAt: itemStatus?.openedAt ??
        (attachment.attachmentIndex === 0 &&
        typeof value.view_once_opened_at === "string"
          ? value.view_once_opened_at
          : null),
      expiresAt: itemStatus?.expiresAt ??
        (attachment.attachmentIndex === 0 &&
        typeof value.view_once_expires_at === "string"
          ? value.view_once_expires_at
          : null),
    };
  });
  const parsedReply = parseReplyMessageBody(rawBody);
  return {
    id: value.id,
    senderId: value.sender_id,
    body: legacyViewOnce && viewOnceKind
      ? getViewOnceMessageLabel(viewOnceKind)
      : draft
      ? draft.text || getAttachmentMessageLabel(draft.attachments)
      : attachments.length > 0
      ? getAttachmentMessageLabel(attachments)
      : parsedReply?.text ?? rawBody,
    hasCaption: draft ? draft.text.trim().length > 0 : false,
    replyQuote: draft?.replyQuote ?? parsedReply?.quote ?? null,
    reactions: normalizeMessageReactions(value.reactions),
    attachment: attachmentsWithStatus[0]
      ? { ...attachmentsWithStatus[0], url: "" }
      : null,
    attachments: attachmentsWithStatus.map((attachment) => ({
      ...attachment,
      url: "",
    })),
    deletedForEveryone: value.deleted_for_everyone === true,
    viewOnce: legacyViewOnce,
    viewOnceOpenedAt:
      typeof value.view_once_opened_at === "string"
        ? value.view_once_opened_at
        : null,
    viewOnceExpiresAt:
      typeof value.view_once_expires_at === "string"
        ? value.view_once_expires_at
        : null,
    createdAt: value.created_at,
    readAt: value.read_at,
  };
}

function normalizeViewOnceItems(
  value: unknown,
): {
  attachmentIndex: number;
  openedAt: string | null;
  expiresAt: string | null;
}[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("The protected attachment statuses were invalid.");
  }
  return value.map((item) => {
    if (
      !isRecord(item) ||
      !Number.isInteger(item.attachment_index) ||
      (item.attachment_index as number) < 0 ||
      (item.attachment_index as number) > 4 ||
      !isChatAttachmentKind(item.media_kind) ||
      (item.opened_at !== null && typeof item.opened_at !== "string") ||
      (item.expires_at !== null && typeof item.expires_at !== "string")
    ) {
      throw new Error("A protected attachment status was invalid.");
    }
    return {
      attachmentIndex: item.attachment_index as number,
      openedAt: item.opened_at as string | null,
      expiresAt: item.expires_at as string | null,
    };
  });
}

function getViewOnceMessageLabel(kind: ChatAttachmentKind): string {
  if (kind === "image") return "View once photo";
  if (kind === "video") return "View once video";
  return "View once voice note";
}

function getViewOnceKindFromBody(body: string): ChatAttachmentKind | null {
  const kind = body.slice(VIEW_ONCE_MARKER.length);
  return isChatAttachmentKind(kind) ? kind : null;
}

function isChatAttachmentKind(value: unknown): value is ChatAttachmentKind {
  return value === "image" || value === "video" || value === "audio";
}

function getAttachmentMessageLabel(
  attachments: Omit<ChatAttachment, "url">[],
): string {
  if (attachments.length === 1) {
    switch (attachments[0].kind) {
      case "image":
        return "Photo";
      case "video":
        return "Video";
      case "audio":
        return "Voice message";
    }
  }
  const imageCount = attachments.filter(
    (attachment) => attachment.kind === "image",
  ).length;
  const videoCount = attachments.length - imageCount;
  if (imageCount === attachments.length) return `${imageCount} photos`;
  if (videoCount === attachments.length) return `${videoCount} videos`;
  return `${imageCount} photos and ${videoCount} videos`;
}

function normalizeMessageReactions(value: unknown): ChatMessageReaction[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("Message reactions were invalid.");
  }
  return value.map((reaction) => {
    if (
      !isRecord(reaction) ||
      !isChatReactionValue(reaction.value) ||
      !Number.isInteger(reaction.count) ||
      (reaction.count as number) < 1 ||
      typeof reaction.reacted_by_me !== "boolean"
    ) {
      throw new Error("A message reaction was invalid.");
    }
    return {
      value: reaction.value,
      count: reaction.count as number,
      reactedByMe: reaction.reacted_by_me,
    };
  });
}

function isChatReactionValue(value: unknown): value is ChatReactionValue {
  return value === "heart" ||
    value === "laugh" ||
    value === "wow" ||
    value === "celebrate" ||
    value === "support";
}

const REPLY_MESSAGE_MARKER = "__veyra_reply__:";

function parseReplyMessageBody(
  body: string,
): { quote: string; text: string } | null {
  if (!body.startsWith(REPLY_MESSAGE_MARKER)) return null;
  const remainder = body.slice(REPLY_MESSAGE_MARKER.length);
  const separator = remainder.indexOf("\n");
  if (separator < 0) return null;
  return {
    quote: remainder.slice(0, separator),
    text: remainder.slice(separator + 1).replace(/^\n/, ""),
  };
}

function parseAttachmentBody(
  body: string,
): Omit<ChatAttachment, "url">[] {
  if (!body.startsWith(CHAT_ATTACHMENT_MARKER)) return [];
  let value: unknown;
  try {
    value = JSON.parse(body.slice(CHAT_ATTACHMENT_MARKER.length));
  } catch {
    return [];
  }
  if (
    isRecord(value) &&
    (value.kind === "image" ||
      value.kind === "video" ||
      value.kind === "audio") &&
    typeof value.path === "string" &&
    value.path.length > 0
  ) {
    return [{ kind: value.kind, path: value.path }];
  }
  if (
    isRecord(value) &&
    value.kind === "group" &&
    Array.isArray(value.items) &&
    value.items.length >= 2 &&
    value.items.length <= 5
  ) {
    const items: Omit<ChatAttachment, "url">[] = [];
    for (const item of value.items) {
      if (
        !isRecord(item) ||
        (item.kind !== "image" && item.kind !== "video") ||
        typeof item.path !== "string" ||
        item.path.length === 0
      ) {
        return [];
      }
      items.push({ kind: item.kind, path: item.path });
    }
    return items;
  }
  return [];
}

function parseDraftAttachmentBody(
  body: string,
): {
  text: string;
  replyQuote: string | null;
  attachments: Omit<ChatAttachment, "url">[];
} | null {
  if (!body.startsWith(CHAT_ATTACHMENT_MARKER)) return null;
  let value: unknown;
  try {
    value = JSON.parse(body.slice(CHAT_ATTACHMENT_MARKER.length));
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    value.kind !== "draft" ||
    typeof value.text !== "string" ||
    (value.replyQuote !== null && typeof value.replyQuote !== "string") ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > 5
  ) {
    return null;
  }
  const attachments: Omit<ChatAttachment, "url">[] = [];
  for (const [attachmentIndex, item] of value.items.entries()) {
    if (
      !isRecord(item) ||
      (item.kind !== "image" && item.kind !== "video") ||
      (item.caption !== undefined && typeof item.caption !== "string")
    ) {
      return null;
    }
    const isViewOnce = item.viewOnce === true;
    if (
      (isViewOnce && item.path !== undefined) ||
      (!isViewOnce &&
        (typeof item.path !== "string" || item.path.length === 0))
    ) {
      return null;
    }
    attachments.push({
      kind: item.kind,
      path: isViewOnce ? "" : item.path as string,
      ...(typeof item.caption === "string" ? { caption: item.caption } : {}),
      attachmentIndex,
      ...(isViewOnce ? { viewOnce: true } : {}),
    });
  }
  return {
    text: value.text,
    replyQuote: typeof value.replyQuote === "string" ? value.replyQuote : null,
    attachments,
  };
}

function resolveAttachmentContentType(
  mimeType: string,
  uri: string,
  kind: ChatAttachmentKind,
): string {
  const normalizedType = mimeType.toLowerCase().split(";", 1)[0];
  if (
    (kind === "image" && normalizedType.startsWith("image/")) ||
    (kind === "video" && normalizedType.startsWith("video/")) ||
    (kind === "audio" && normalizedType.startsWith("audio/"))
  ) {
    return normalizedType;
  }

  const extension = uri
    .split(/[?#]/, 1)[0]
    .split(".")
    .pop()
    ?.toLowerCase();
  const contentTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    mp4: kind === "audio" ? "audio/mp4" : "video/mp4",
    mov: "video/quicktime",
    webm: kind === "audio" ? "audio/webm" : "video/webm",
    m4a: "audio/mp4",
    aac: "audio/aac",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    "3gp": kind === "audio" ? "audio/3gpp" : "video/3gpp",
  };
  const resolved = extension ? contentTypes[extension] : undefined;
  if (
    !resolved ||
    (kind === "image" && !resolved.startsWith("image/")) ||
    (kind === "video" && !resolved.startsWith("video/")) ||
    (kind === "audio" && !resolved.startsWith("audio/"))
  ) {
    throw new Error(`This ${kind} file format is not supported.`);
  }
  return resolved;
}

function getAttachmentExtension(uri: string, contentType: string): string {
  const extension = uri
    .split(/[?#]/, 1)[0]
    .split(".")
    .pop()
    ?.toLowerCase();
  if (extension && /^[a-z0-9]{2,5}$/.test(extension)) return extension;
  const contentTypeExtensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/mpeg": "mp3",
    "audio/3gpp": "3gp",
    "audio/webm": "webm",
  };
  const resolved = contentTypeExtensions[contentType];
  if (!resolved) throw new Error("This attachment format is not supported.");
  return resolved;
}

function getClient() {
  if (!supabaseClient) {
    throw new Error("Supabase is not configured. Messages are unavailable.");
  }
  return supabaseClient;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Johannesburg";
  } catch {
    return "Africa/Johannesburg";
  }
}

async function getFunctionErrorMessage(error: {
  message: string;
  context?: unknown;
}): Promise<string> {
  const context = error.context;
  if (
    typeof context === "object" &&
    context !== null &&
    "clone" in context &&
    typeof context.clone === "function"
  ) {
    const response = context.clone() as Response;
    const body = await response.text();
    if (body) {
      try {
        const parsed: unknown = JSON.parse(body);
        if (isRecord(parsed) && typeof parsed.error === "string") {
          return parsed.error;
        }
      } catch {
        return `HTTP ${response.status}: ${body.slice(0, 500)}`;
      }
      return `HTTP ${response.status}: ${body.slice(0, 500)}`;
    }
    return `HTTP ${response.status}: ${error.message}`;
  }
  return error.message;
}

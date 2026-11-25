import { randomUUID } from "expo-crypto";
import { readLocalFile } from "../lib/localFile";
import { supabaseClient } from "../lib/supabaseClient";

const CHAT_ATTACHMENTS_BUCKET = "chat-attachments";
const CHAT_ATTACHMENT_MARKER = "__veyra_attachment__:";
const SIGNED_URL_LIFETIME_SECONDS = 60 * 60;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024;

export type ChatAttachmentKind = "image" | "video" | "audio";
export type ChatAttachment = {
  kind: ChatAttachmentKind;
  path: string;
  url: string;
};

export type ChatPerson = {
  id: string;
  name: string;
  age: number | null;
  city: string | null;
  image: string | null;
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
  attachment: ChatAttachment | null;
  createdAt: string;
  readAt: string | null;
};

export type ChatConversation = {
  id: string;
  matchId: string;
  person: ChatPerson;
  lastMessage: ChatMessage | null;
  unreadCount: number;
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
    !Array.isArray(data.new_matches)
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
  };
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

export async function sendConversationAttachment(
  conversationId: string,
  userId: string,
  uri: string,
  kind: ChatAttachmentKind,
  mimeType?: string | null,
): Promise<ChatMessage> {
  const path = await uploadConversationAttachment(
    conversationId,
    userId,
    uri,
    kind,
    mimeType,
  );
  return sendConversationMessage(
    conversationId,
    `${CHAT_ATTACHMENT_MARKER}${JSON.stringify({ kind, path })}`,
  );
}

async function uploadConversationAttachment(
  conversationId: string,
  userId: string,
  uri: string,
  kind: ChatAttachmentKind,
  mimeType?: string | null,
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
    .from(CHAT_ATTACHMENTS_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw new Error(`Could not upload the attachment: ${error.message}`);
  return path;
}

async function signMessageAttachment(
  message: ChatMessage,
): Promise<ChatMessage> {
  if (!message.attachment) return message;
  const { data, error } = await getClient()
    .storage.from(CHAT_ATTACHMENTS_BUCKET)
    .createSignedUrl(message.attachment.path, SIGNED_URL_LIFETIME_SECONDS);
  if (error) {
    throw new Error(`Could not load a chat attachment: ${error.message}`);
  }
  return {
    ...message,
    attachment: { ...message.attachment, url: data.signedUrl },
  };
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
  const attachment = parseAttachmentBody(value.body);
  return {
    id: value.id,
    senderId: value.sender_id,
    body: attachment
      ? attachment.kind === "image"
        ? "Photo"
        : attachment.kind === "video"
          ? "Video"
          : "Voice message"
      : value.body,
    attachment: attachment ? { ...attachment, url: "" } : null,
    createdAt: value.created_at,
    readAt: value.read_at,
  };
}

function parseAttachmentBody(body: string): Omit<ChatAttachment, "url"> | null {
  if (!body.startsWith(CHAT_ATTACHMENT_MARKER)) return null;
  try {
    const value: unknown = JSON.parse(body.slice(CHAT_ATTACHMENT_MARKER.length));
    if (
      isRecord(value) &&
      (value.kind === "image" ||
        value.kind === "video" ||
        value.kind === "audio") &&
      typeof value.path === "string" &&
      value.path.length > 0
    ) {
      return { kind: value.kind, path: value.path };
    }
  } catch {
    return null;
  }
  return null;
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

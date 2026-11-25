import { supabaseClient } from "../lib/supabaseClient";

export type SupportCategory =
  | "account"
  | "technical"
  | "safety"
  | "verification"
  | "other";
export type ReportReason =
  | "inappropriate"
  | "harassment"
  | "spam"
  | "fake_profile"
  | "other";

export type SupportTicketSummary = {
  id: string;
  category: SupportCategory;
  subject: string;
  status: "open" | "pending" | "resolved" | "closed";
  createdAt: string;
  updatedAt: string;
};

export type SupportTicketDetail = SupportTicketSummary & {
  message: string;
  replies: { id: string; body: string; createdAt: string }[];
};

function getClient() {
  if (!supabaseClient) {
    throw new Error("Supabase is not configured. Support is unavailable.");
  }
  return supabaseClient;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSupportCategory(value: unknown): value is SupportCategory {
  return (
    value === "account" ||
    value === "technical" ||
    value === "safety" ||
    value === "verification" ||
    value === "other"
  );
}

function isTicketStatus(
  value: unknown,
): value is SupportTicketSummary["status"] {
  return (
    value === "open" ||
    value === "pending" ||
    value === "resolved" ||
    value === "closed"
  );
}

export async function submitSupportTicket(input: {
  category: SupportCategory;
  subject: string;
  message: string;
}): Promise<string> {
  const { data, error } = await getClient().rpc("submit_support_ticket", {
    p_category: input.category,
    p_subject: input.subject.trim(),
    p_message: input.message.trim(),
  });
  if (error) {
    throw new Error(`Could not send your support request: ${error.message}`);
  }
  if (typeof data !== "string") {
    throw new Error("Support did not return a valid request reference.");
  }
  return data;
}

export async function getMySupportTickets(): Promise<SupportTicketSummary[]> {
  const { data, error } = await getClient().rpc("get_my_support_tickets");
  if (error) {
    throw new Error(`Could not load your support requests: ${error.message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error("Support returned an invalid request list.");
  }

  return data.map((ticket, index) => {
    if (
      !isRecord(ticket) ||
      typeof ticket.id !== "string" ||
      !isSupportCategory(ticket.category) ||
      typeof ticket.subject !== "string" ||
      !isTicketStatus(ticket.status) ||
      typeof ticket.created_at !== "string" ||
      typeof ticket.updated_at !== "string"
    ) {
      throw new Error(`Support request data is invalid at row ${index + 1}.`);
    }

    return {
      id: ticket.id,
      category: ticket.category,
      subject: ticket.subject,
      status: ticket.status,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
    };
  });
}

export async function getMySupportTicketDetail(
  ticketId: string,
): Promise<SupportTicketDetail> {
  const { data, error } = await getClient().rpc(
    "get_my_support_ticket_detail",
    { p_ticket_id: ticketId },
  );
  if (error) {
    throw new Error(`Could not load your support conversation: ${error.message}`);
  }
  if (
    !isRecord(data) ||
    typeof data.id !== "string" ||
    !isSupportCategory(data.category) ||
    typeof data.subject !== "string" ||
    typeof data.message !== "string" ||
    !isTicketStatus(data.status) ||
    typeof data.created_at !== "string" ||
    typeof data.updated_at !== "string" ||
    !Array.isArray(data.replies)
  ) {
    throw new Error("Support conversation data is invalid.");
  }
  const replies = data.replies.map((reply, index) => {
    if (
      !isRecord(reply) ||
      typeof reply.id !== "string" ||
      typeof reply.body !== "string" ||
      typeof reply.created_at !== "string"
    ) {
      throw new Error(`Support reply data is invalid at row ${index + 1}.`);
    }
    return {
      id: reply.id,
      body: reply.body,
      createdAt: reply.created_at,
    };
  });
  return {
    id: data.id,
    category: data.category,
    subject: data.subject,
    status: data.status,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    message: data.message,
    replies,
  };
}

export async function reportChatMessage(
  messageId: string,
  reason: ReportReason,
): Promise<void> {
  const { error } = await getClient().rpc("report_message", {
    p_message_id: messageId,
    p_reason: reason,
  });
  if (error) throw new Error(`Could not report this message: ${error.message}`);
}

export async function recordMemberActivity(): Promise<void> {
  const { error } = await getClient().rpc("record_member_activity");
  if (error) {
    throw new Error(`Could not record app activity: ${error.message}`);
  }
}

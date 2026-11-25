import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  getMySupportTicketDetail,
  getMySupportTickets,
  submitSupportTicket,
  type SupportTicketDetail,
  type SupportCategory,
  type SupportTicketSummary,
} from "../../data/support";
import type { SystemColors } from "../../systemColors";

const categories: { value: SupportCategory; label: string }[] = [
  { value: "account", label: "Account" },
  { value: "technical", label: "Technical" },
  { value: "safety", label: "Safety" },
  { value: "verification", label: "Verification" },
  { value: "other", label: "Other" },
];

function getTicketStatus(status: SupportTicketSummary["status"]): string {
  switch (status) {
    case "open":
      return "Open";
    case "pending":
      return "Awaiting reply";
    case "resolved":
      return "Resolved";
    case "closed":
      return "Closed";
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeZone: "Africa/Johannesburg",
  }).format(new Date(value));
}

export function SupportTicketPanel({
  userId,
  colors,
}: {
  userId: string | null;
  colors: SystemColors;
}) {
  const styles = createStyles(colors);
  const [category, setCategory] = useState<SupportCategory>("other");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [tickets, setTickets] = useState<SupportTicketSummary[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] =
    useState<SupportTicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const loadVersion = useRef(0);
  const userVersion = useRef(0);
  const detailVersion = useRef(0);

  const loadTickets = useCallback(async () => {
    if (!userId) return;
    const requestVersion = ++loadVersion.current;
    setLoading(true);
    try {
      const loadedTickets = await getMySupportTickets();
      if (requestVersion !== loadVersion.current) return;
      setTickets(loadedTickets);
      setLoadError("");
    } catch (requestError) {
      if (requestVersion !== loadVersion.current) return;
      setLoadError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load support requests.",
      );
    } finally {
      if (requestVersion === loadVersion.current) setLoading(false);
    }
  }, [userId]);

  const showTicketDetail = async (ticketId: string) => {
    if (selectedTicketId === ticketId) {
      detailVersion.current += 1;
      setSelectedTicketId(null);
      setSelectedTicket(null);
      setDetailError("");
      return;
    }

    setSelectedTicketId(ticketId);
    setSelectedTicket(null);
    setDetailError("");
    setDetailLoading(true);
    const requestVersion = ++detailVersion.current;
    try {
      const ticketDetail = await getMySupportTicketDetail(ticketId);
      if (requestVersion === detailVersion.current) {
        setSelectedTicket(ticketDetail);
      }
    } catch (requestError) {
      if (requestVersion === detailVersion.current) {
        setDetailError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load this support conversation.",
        );
      }
    } finally {
      if (requestVersion === detailVersion.current) setDetailLoading(false);
    }
  };

  useEffect(() => {
    userVersion.current += 1;
    return () => {
      userVersion.current += 1;
    };
  }, [userId]);

  useEffect(() => {
    setTickets([]);
    setSelectedTicketId(null);
    setSelectedTicket(null);
    setDetailError("");
    detailVersion.current += 1;
    setLoadError("");
    setError("");
    setNotice("");
    setSubject("");
    setMessage("");
    setCategory("other");
    setSaving(false);
    void loadTickets();
    return () => {
      loadVersion.current += 1;
    };
  }, [loadTickets]);

  const sendRequest = async () => {
    if (!userId || saving) return;
    const trimmedSubject = subject.trim();
    const trimmedMessage = message.trim();
    if (trimmedSubject.length < 5 || trimmedSubject.length > 120) {
      setError("Enter a subject between 5 and 120 characters.");
      return;
    }
    if (trimmedMessage.length < 10 || trimmedMessage.length > 4000) {
      setError("Enter a message between 10 and 4000 characters.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    const requestVersion = userVersion.current;
    try {
      const ticketId = await submitSupportTicket({
        category,
        subject: trimmedSubject,
        message: trimmedMessage,
      });
      if (requestVersion !== userVersion.current) return;
      setSubject("");
      setMessage("");
      setNotice(`Your request was sent. Reference: ${ticketId.slice(0, 8)}.`);
      await loadTickets();
    } catch (submitError) {
      if (requestVersion !== userVersion.current) return;
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not send your support request.",
      );
    } finally {
      if (requestVersion === userVersion.current) setSaving(false);
    }
  };

  if (!userId) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Contact VEYRA Support</Text>
        <Text style={styles.copy}>Sign in to send a support request.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.intro}>
        <Text style={styles.title}>How can we help?</Text>
        <Text style={styles.copy}>
          Send a private request to the VEYRA support team. Do not include
          passwords, verification codes, or payment card details.
        </Text>
      </View>

      <Text style={styles.fieldLabel}>Topic</Text>
      <View accessibilityRole="radiogroup" style={styles.categories}>
        {categories.map((item) => {
          const selected = category === item.value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              key={item.value}
              onPress={() => setCategory(item.value)}
              style={[styles.category, selected && styles.categorySelected]}
            >
              <Text
                style={[
                  styles.categoryText,
                  selected && styles.categoryTextSelected,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.fieldLabel}>Subject</Text>
      <TextInput
        accessibilityLabel="Support request subject"
        maxLength={120}
        onChangeText={setSubject}
        placeholder="Briefly describe the issue"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={subject}
      />
      <Text style={styles.characterCount}>{subject.length}/120</Text>

      <Text style={styles.fieldLabel}>Message</Text>
      <TextInput
        accessibilityLabel="Support request message"
        maxLength={4000}
        multiline
        onChangeText={setMessage}
        placeholder="Tell us what happened and how we can help"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.messageInput]}
        textAlignVertical="top"
        value={message}
      />
      <Text style={styles.characterCount}>{message.length}/4000</Text>

      {loadError ? (
        <View style={styles.errorBlock}>
          <Text accessibilityRole="alert" style={styles.error}>
            {loadError}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={() => void loadTickets()}
            style={styles.retryButton}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text accessibilityRole="status" style={styles.notice}>
          {notice}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={() => void sendRequest()}
        style={[styles.submitButton, saving && styles.disabled]}
      >
        {saving ? (
          <ActivityIndicator color={colors.textInverse} size="small" />
        ) : (
          <Text style={styles.submitText}>Send support request</Text>
        )}
      </Pressable>

      <View style={styles.ticketSection}>
        <Text style={styles.sectionTitle}>Your recent requests</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : tickets.length ? (
          tickets.slice(0, 5).map((ticket) => (
            <View key={ticket.id} style={styles.ticketItem}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  expanded: selectedTicketId === ticket.id,
                }}
                onPress={() => void showTicketDetail(ticket.id)}
                style={styles.ticket}
              >
                <View style={styles.ticketCopy}>
                  <Text numberOfLines={2} style={styles.ticketSubject}>
                    {ticket.subject}
                  </Text>
                  <Text style={styles.ticketMeta}>
                    {formatDate(ticket.updatedAt)} · {ticket.category}
                  </Text>
                </View>
                <Text style={styles.ticketStatus}>
                  {getTicketStatus(ticket.status)}
                </Text>
              </Pressable>
              {selectedTicketId === ticket.id ? (
                <View style={styles.conversation}>
                  {detailLoading ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : detailError ? (
                    <Text accessibilityRole="alert" style={styles.error}>
                      {detailError}
                    </Text>
                  ) : selectedTicket ? (
                    <>
                      <Text style={styles.conversationLabel}>Your message</Text>
                      <Text style={styles.conversationBody}>
                        {selectedTicket.message}
                      </Text>
                      {selectedTicket.replies.map((item) => (
                        <View key={item.id} style={styles.reply}>
                          <Text style={styles.conversationLabel}>
                            VEYRA Support · {formatDate(item.createdAt)}
                          </Text>
                          <Text style={styles.conversationBody}>
                            {item.body}
                          </Text>
                        </View>
                      ))}
                      {!selectedTicket.replies.length ? (
                        <Text style={styles.ticketMeta}>
                          The support team has not replied yet.
                        </Text>
                      ) : null}
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.empty}>
            No support requests yet. You can send one above.
          </Text>
        )}
      </View>
    </View>
  );
}

function createStyles(colors: SystemColors) {
  return StyleSheet.create({
    container: { gap: 8, paddingBottom: 28 },
    intro: { gap: 6, marginBottom: 12 },
    title: { color: colors.text, fontSize: 20, fontWeight: "700" },
    copy: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
    fieldLabel: {
      color: colors.text,
      fontSize: 13,
      fontWeight: "600",
      marginTop: 10,
    },
    categories: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    category: {
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: 1,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    categorySelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    categoryText: { color: colors.textSecondary, fontSize: 12 },
    categoryTextSelected: { color: colors.textInverse, fontWeight: "600" },
    input: {
      backgroundColor: colors.inputBackground,
      borderColor: colors.border,
      borderRadius: 12,
      borderWidth: 1,
      color: colors.text,
      fontSize: 14,
      minHeight: 46,
      paddingHorizontal: 13,
      paddingVertical: 11,
    },
    messageInput: { minHeight: 120 },
    characterCount: {
      color: colors.textMuted,
      fontSize: 11,
      textAlign: "right",
    },
    error: { color: colors.error, fontSize: 12, lineHeight: 18, marginTop: 8 },
    errorBlock: { gap: 6 },
    retryButton: { alignSelf: "flex-start", paddingVertical: 5 },
    retryText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: "600",
      textDecorationLine: "underline",
    },
    notice: {
      color: colors.success,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 8,
    },
    submitButton: {
      alignItems: "center",
      backgroundColor: colors.primary,
      borderRadius: 12,
      justifyContent: "center",
      marginTop: 10,
      minHeight: 46,
      paddingHorizontal: 16,
    },
    submitText: {
      color: colors.textInverse,
      fontSize: 14,
      fontWeight: "700",
    },
    disabled: { opacity: 0.6 },
    ticketSection: {
      borderTopColor: colors.divider,
      borderTopWidth: 1,
      gap: 10,
      marginTop: 22,
      paddingTop: 18,
    },
    sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
    loader: { paddingVertical: 18 },
    ticket: {
      alignItems: "center",
      borderBottomColor: colors.divider,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: 10,
      justifyContent: "space-between",
      paddingVertical: 12,
    },
    ticketItem: {
      borderBottomColor: colors.divider,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    ticketCopy: { flex: 1, gap: 4 },
    ticketSubject: { color: colors.text, fontSize: 13, fontWeight: "600" },
    ticketMeta: { color: colors.textMuted, fontSize: 11 },
    ticketStatus: { color: colors.primary, fontSize: 11, fontWeight: "600" },
    conversation: {
      backgroundColor: colors.surfaceSecondary,
      borderRadius: 12,
      gap: 7,
      marginBottom: 10,
      padding: 12,
    },
    conversationLabel: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: "700",
    },
    conversationBody: {
      color: colors.text,
      fontSize: 12,
      lineHeight: 18,
    },
    reply: {
      borderTopColor: colors.divider,
      borderTopWidth: StyleSheet.hairlineWidth,
      gap: 5,
      marginTop: 6,
      paddingTop: 10,
    },
    empty: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  });
}

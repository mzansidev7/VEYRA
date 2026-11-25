import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { LocalDatingProfile } from "../../data/localProfile";
import {
  getChemistryFeed,
  startChemistrySession,
  submitChemistryResponse,
  type ChemistryActivity,
  type ChemistryConnection,
  type ChemistryFeed,
  type ChemistryQuestionProgress,
  type ChemistrySession,
} from "../../data/chemistry";
import type { SystemColors } from "../../systemColors";

type Props = {
  userId: string;
  localProfile: LocalDatingProfile | null;
  colors: SystemColors;
};

export function ChemistryScreen({
  userId,
  localProfile,
  colors,
}: Props) {
  const [feed, setFeed] = useState<ChemistryFeed | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const isStartingActivity = useRef(false);

  const loadFeed = useCallback(async (background = false) => {
    if (!background) setIsLoading(true);
    setError("");
    try {
      setFeed(await getChemistryFeed());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load Chemistry.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed, userId]);

  const selectedConnection = useMemo(
    () =>
      feed?.connections.find(
        (connection) => connection.matchId === selectedMatchId,
      ) ??
      feed?.connections[0] ??
      null,
    [feed, selectedMatchId],
  );
  const selectedSession = selectedConnection?.sessions.find(
    (session) => session.id === selectedSessionId,
  );
  const activeSessions = useMemo(() => {
    const sessions = selectedConnection?.sessions.filter(
      (session) => session.status === "active",
    ) ?? [];
    const latestByActivity = new Map<string, ChemistrySession>();
    for (const session of sessions) {
      const current = latestByActivity.get(session.activityKey);
      if (!current || session.createdAt > current.createdAt) {
        latestByActivity.set(session.activityKey, session);
      }
    }
    return [...latestByActivity.values()];
  }, [selectedConnection]);
  const activeSession =
    selectedSession?.status === "active"
      ? selectedSession
      : activeSessions[0];
  const hasCompletedSessions =
    selectedConnection?.sessions.some(
      (session) => session.status === "completed",
    ) ?? false;
  const completedSession =
    selectedSession?.status === "completed"
      ? selectedSession
      : activeSession
        ? null
        : selectedConnection?.sessions.find(
            (session) => session.status === "completed",
          );

  useEffect(() => {
    if (!activeSession) return;
    const timer = setInterval(() => void loadFeed(true), 5000);
    return () => clearInterval(timer);
  }, [activeSession?.id, loadFeed]);

  useEffect(() => {
    setDrafts({});
    setActionError("");
  }, [selectedSession?.id, selectedSession?.currentQuestionPosition]);

  const startActivity = useCallback(
    async (activity: ChemistryActivity) => {
      if (!selectedConnection || isStartingActivity.current) return;
      const existingSession = activeSessions.find(
        (session) => session.activityKey === activity.key,
      );
      if (existingSession) {
        setSelectedSessionId(existingSession.id);
        return;
      }
      isStartingActivity.current = true;
      setIsSaving(true);
      setActionError("");
      try {
        const sessionId = await startChemistrySession(
          selectedConnection.matchId,
          activity.key,
        );
        setSelectedSessionId(sessionId);
        await loadFeed(true);
      } catch (startError) {
        setActionError(
          startError instanceof Error
            ? startError.message
            : "Could not start this activity.",
        );
      } finally {
        isStartingActivity.current = false;
        setIsSaving(false);
      }
    },
    [activeSessions, loadFeed, selectedConnection],
  );

  const saveAnswer = useCallback(
    async (question: ChemistryQuestionProgress, answer: string) => {
      if (!activeSession || !answer.trim()) return;
      setIsSaving(true);
      setActionError("");
      try {
        await submitChemistryResponse(
          activeSession.id,
          question.id,
          answer.trim(),
        );
        setDrafts((current) => {
          const next = { ...current };
          delete next[question.id];
          return next;
        });
        await loadFeed(true);
      } catch (saveError) {
        setActionError(
          saveError instanceof Error
            ? saveError.message
            : "Could not save your answer.",
        );
      } finally {
        setIsSaving(false);
      }
    },
    [activeSession, loadFeed],
  );

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.eyebrow, { color: colors.like }]}>
        A SPACE TO EXPLORE TOGETHER
      </Text>
      <Text style={[styles.title, { color: colors.text }]}>Chemistry</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        A little curiosity can create a meaningful connection.
      </Text>

      <View
        style={[
          styles.hero,
          { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.heroSpark, { color: colors.like }]}>✦</Text>
        <Text style={[styles.heroTitle, { color: colors.text }]}>
          Get to know each other, one group at a time.
        </Text>
        <Text style={[styles.heroCopy, { color: colors.textSecondary }]}>
          Share 10 answers in groups of 3, 3, and 4. Your answers stay private
          until you both finish.
        </Text>
      </View>

      {error ? (
        <View style={styles.stateWrap}>
          <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
            {error}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadFeed()}
            style={[styles.retryButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.retryText, { color: colors.text }]}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : isLoading && !feed ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator color={colors.like} />
        </View>
      ) : feed?.connections.length ? (
        <>
          <SectionHeading
            title="Your connections"
            subtitle="Choose someone to explore with."
            colors={colors}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.connectionRow}
          >
            {feed.connections.map((connection) => (
              <ConnectionCard
                key={connection.matchId}
                connection={connection}
                selected={connection.matchId === selectedConnection?.matchId}
                colors={colors}
                onPress={() => {
                  setSelectedMatchId(connection.matchId);
                  setSelectedSessionId("");
                }}
              />
            ))}
          </ScrollView>

          {selectedConnection ? (
            <>
              {activeSession ? (
                <SessionCard
                  connection={selectedConnection}
                  session={activeSession}
                  drafts={drafts}
                  isSaving={isSaving}
                  error={actionError}
                  colors={colors}
                  onDraftChange={(questionId, value) =>
                    setDrafts((current) => ({ ...current, [questionId]: value }))
                  }
                  onSubmit={(question, answer) =>
                    void saveAnswer(question, answer)
                  }
                />
              ) : null}

              {activeSessions.length ? (
                <SectionHeading
                  title="In progress"
                  subtitle="Pick up where you left off."
                  colors={colors}
                />
              ) : null}
              {activeSessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  activity={feed.activities.find(
                    (activity) => activity.key === session.activityKey,
                  )}
                  matchName={selectedConnection.person.name}
                  selected={session.id === selectedSessionId}
                  colors={colors}
                  onPress={() => setSelectedSessionId(session.id)}
                />
              ))}

              <SectionHeading
                title="Choose an experience"
                subtitle={`10 questions with ${selectedConnection.person.name}, in groups of 3, 3, and 4.`}
                colors={colors}
              />
              <View style={styles.activityList}>
                {feed.activities.map((activity) => (
                  <ActivityCard
                    key={activity.key}
                    activity={activity}
                    active={activeSessions.some(
                      (session) => session.activityKey === activity.key,
                    )}
                    colors={colors}
                    disabled={isSaving}
                    onPress={() => void startActivity(activity)}
                  />
                ))}
              </View>

              {hasCompletedSessions ? (
                <>
                  <SectionHeading
                    title="Completed together"
                    subtitle="Revisit the answers you shared."
                    colors={colors}
                  />
                  {selectedConnection.sessions
                    .filter((session) => session.status === "completed")
                    .map((session) => (
                      <SessionRow
                        key={session.id}
                        session={session}
                        activity={feed.activities.find(
                          (activity) => activity.key === session.activityKey,
                        )}
                        matchName={selectedConnection.person.name}
                        selected={session.id === selectedSessionId}
                        colors={colors}
                        onPress={() => setSelectedSessionId(session.id)}
                      />
                    ))}
                </>
              ) : null}

              {completedSession ? (
                <CompletedAnswers
                  session={completedSession}
                  activity={feed.activities.find(
                    (activity) => activity.key === completedSession.activityKey,
                  )}
                  colors={colors}
                />
              ) : null}

              <InsightsCard
                connection={selectedConnection}
                localProfile={localProfile}
                colors={colors}
              />
              <ChemistryScoreCard
                connection={selectedConnection}
                localProfile={localProfile}
                colors={colors}
              />
              {actionError ? (
                <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
                  {actionError}
                </Text>
              ) : null}
            </>
          ) : null}
        </>
      ) : (
        <View
          style={[
            styles.emptyCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Chemistry starts with a match
          </Text>
          <Text style={[styles.emptyCopy, { color: colors.textSecondary }]}>
            When you and someone like each other, you can choose an experience
            and explore together here.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function SectionHeading({
  title,
  subtitle,
  colors,
}: {
  title: string;
  subtitle: string;
  colors: SystemColors;
}) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.sectionSubtitle, { color: colors.textSecondary }]}>
        {subtitle}
      </Text>
    </View>
  );
}

function ConnectionCard({
  connection,
  selected,
  colors,
  onPress,
}: {
  connection: ChemistryConnection;
  selected: boolean;
  colors: SystemColors;
  onPress: () => void;
}) {
  const unfinished = connection.sessions.some((session) => session.status === "active");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.connectionCard,
        {
          backgroundColor: colors.surface,
          borderColor: selected ? colors.like : colors.border,
        },
      ]}
    >
      <View style={styles.avatarWrap}>
        {connection.person.image ? (
          <Image
            source={{ uri: connection.person.image }}
            style={{ width: 76, height: 76, borderRadius: 38 }}
          />
        ) : (
          <View
            style={[
              styles.avatarFallback,
              { backgroundColor: colors.surfaceSecondary },
            ]}
          >
            <Text style={[styles.avatarInitial, { color: colors.like }]}>
              {connection.person.name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        {unfinished ? (
          <View style={[styles.newDot, { backgroundColor: colors.like }]} />
        ) : null}
      </View>
      <Text numberOfLines={1} style={[styles.connectionName, { color: colors.text }]}>
        {connection.person.name}
        {connection.person.age ? `, ${connection.person.age}` : ""}
      </Text>
      <Text style={[styles.connectionMeta, { color: colors.textSecondary }]}>
        Matched {formatRelativeDate(connection.matchedAt)}
      </Text>
      {unfinished ? (
        <Text style={[styles.newLabel, { color: colors.like }]}>In progress</Text>
      ) : null}
    </Pressable>
  );
}

function ActivityCard({
  activity,
  active,
  colors,
  disabled,
  onPress,
}: {
  activity: ChemistryActivity;
  active: boolean;
  colors: SystemColors;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.activityCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={[styles.activityIconWrap, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[styles.activityIcon, { color: colors.like }]}>
          {activity.icon}
        </Text>
      </View>
      <View style={styles.activityText}>
        <Text style={[styles.activityTitle, { color: colors.text }]}>
          {activity.title}
        </Text>
        <Text style={[styles.activityDescription, { color: colors.textSecondary }]}>
          {active ? "Continue where you left off." : activity.description}
        </Text>
      </View>
      <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
    </Pressable>
  );
}

function SessionRow({
  session,
  activity,
  matchName,
  selected,
  colors,
  onPress,
}: {
  session: ChemistrySession;
  activity: ChemistryActivity | undefined;
  matchName: string;
  selected: boolean;
  colors: SystemColors;
  onPress: () => void;
}) {
  const waiting = session.questions.some(
    (question) =>
      question.myAnswerSubmitted && !question.matchAnswerSubmitted,
  );
  const theirTurn = session.questions.some(
    (question) =>
      question.matchAnswerSubmitted && !question.myAnswerSubmitted,
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.sessionRow,
        {
          backgroundColor: colors.surface,
          borderColor: selected ? colors.like : colors.border,
        },
      ]}
    >
      <View style={styles.sessionRowText}>
        <Text style={[styles.activityTitle, { color: colors.text }]}>
          {activity?.title ?? "Chemistry activity"}
        </Text>
        <Text style={[styles.activityDescription, { color: colors.textSecondary }]}>
          {session.status === "completed"
            ? "Completed"
            : waiting
              ? `Waiting for ${matchName} to answer`
              : theirTurn
                ? "Your turn to answer"
                : "Continue together"}
        </Text>
      </View>
      <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
    </Pressable>
  );
}

function SessionCard({
  connection,
  session,
  drafts,
  isSaving,
  error,
  colors,
  onDraftChange,
  onSubmit,
}: {
  connection: ChemistryConnection;
  session: ChemistrySession;
  drafts: Record<string, string>;
  isSaving: boolean;
  error: string;
  colors: SystemColors;
  onDraftChange: (questionId: string, value: string) => void;
  onSubmit: (question: ChemistryQuestionProgress, answer: string) => void;
}) {
  const questionsToAnswer = session.questions.filter(
    (question) =>
      !question.myAnswerSubmitted || !question.matchAnswerSubmitted,
  );
  const groupFirstPosition = session.questions[0]?.position ??
    (session.currentQuestionPosition <= 3
      ? 1
      : session.currentQuestionPosition <= 6
        ? 4
        : 7);
  const groupLastPosition = session.questions.at(-1)?.position ??
    Math.min(groupFirstPosition + (groupFirstPosition === 7 ? 3 : 2), 10);
  const sharedCount = session.questions.filter(
    (question) =>
      question.myAnswerSubmitted && question.matchAnswerSubmitted,
  ).length;
  return (
    <View
      style={[
        styles.questionCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.questionHeader}>
        <Text style={[styles.eyebrow, { color: colors.like }]}>
          {connection.person.name.toUpperCase()} & YOU
        </Text>
        <Text style={[styles.questionCount, { color: colors.textSecondary }]}>
          QUESTIONS {groupFirstPosition}-{groupLastPosition} OF 10
        </Text>
      </View>
      <Text style={[styles.groupProgress, { color: colors.textSecondary }]}>
        {sharedCount} of {session.questions.length} questions answered by both
      </Text>
      {questionsToAnswer.length ? (
        questionsToAnswer.map((question) => {
          const draft = drafts[question.id] ?? "";
          const isWaiting = question.myAnswerSubmitted;
          return (
            <View
              key={question.id}
              style={[
                styles.questionItem,
                { borderColor: colors.border },
              ]}
            >
              <Text style={[styles.questionItemNumber, { color: colors.like }]}>
                QUESTION {question.position}
              </Text>
              <Text style={[styles.questionPrompt, { color: colors.text }]}>
                {question.prompt}
              </Text>
              {isWaiting ? (
                <View
                  style={[
                    styles.questionWaiting,
                    { backgroundColor: colors.surfaceSecondary },
                  ]}
                >
                  <Text
                    style={[
                      styles.waitingText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Waiting for {connection.person.name} to answer. Your answer
                    stays private until all 10 questions are shared.
                  </Text>
                </View>
              ) : (
                <>
                  {question.matchAnswerSubmitted ? (
                    <Text
                      style={[
                        styles.waitingText,
                        { color: colors.textSecondary, marginTop: 12 },
                      ]}
                    >
                      {connection.person.name} has shared an answer. Share
                      yours to continue.
                    </Text>
                  ) : null}
                  {question.choices.length ? (
                    <View style={styles.choiceList}>
                      {question.choices.map((choice) => (
                        <Pressable
                          key={choice}
                          accessibilityRole="button"
                          accessibilityState={{ selected: draft === choice }}
                          disabled={isSaving}
                          onPress={() => onDraftChange(question.id, choice)}
                          style={[
                            styles.choiceButton,
                            {
                              borderColor:
                                draft === choice ? colors.like : colors.border,
                              backgroundColor: colors.background,
                            },
                          ]}
                        >
                          <Text
                            style={[styles.choiceText, { color: colors.text }]}
                          >
                            {choice}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : (
                    <TextInput
                      accessibilityLabel={`Answer to question ${question.position}`}
                      multiline
                      maxLength={1000}
                      onChangeText={(value) =>
                        onDraftChange(question.id, value)
                      }
                      placeholder="Write what feels true for you…"
                      placeholderTextColor={colors.textMuted}
                      style={[
                        styles.answerInput,
                        {
                          color: colors.text,
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                        },
                      ]}
                      value={draft}
                    />
                  )}
                  <Pressable
                    accessibilityRole="button"
                    disabled={!draft.trim() || isSaving}
                    onPress={() => onSubmit(question, draft)}
                    style={[
                      styles.submitButton,
                      {
                        backgroundColor: colors.like,
                        opacity: !draft.trim() || isSaving ? 0.55 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.submitText,
                        { color: colors.textInverse },
                      ]}
                    >
                      {isSaving ? "Sharing…" : "Share answer"}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          );
        })
      ) : (
        <View
          style={[
            styles.waitingBox,
            { backgroundColor: colors.surfaceSecondary },
          ]}
        >
          <ActivityIndicator color={colors.like} />
          <Text style={[styles.waitingText, { color: colors.textSecondary }]}>
            Both of you have answered this group. Loading the next questions…
          </Text>
        </View>
      )}
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function CompletedAnswers({
  session,
  activity,
  colors,
}: {
  session: ChemistrySession;
  activity: ChemistryActivity | undefined;
  colors: SystemColors;
}) {
  return (
    <View
      style={[
        styles.completedCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        {activity?.title ?? "Completed activity"}
      </Text>
      <View style={[styles.compatibilityCard, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[styles.compatibilityTitle, { color: colors.text }]}>
          Shared answer wording · {getAnswerCompatibility(session.results)}%
        </Text>
        <Text style={[styles.compatibilityCopy, { color: colors.textSecondary }]}>
          This compares shared words and choices only, not meaning or
          relationship potential.
        </Text>
      </View>
      {session.results.map((result, index) => (
        <View
          key={`${session.id}-completed-${index}`}
          style={[styles.sharedResult, { backgroundColor: colors.surfaceSecondary }]}
        >
          <Text style={[styles.resultPrompt, { color: colors.textSecondary }]}>
            {result.prompt}
          </Text>
          <Text style={[styles.resultAnswer, { color: colors.text }]}>
            You: {result.myAnswer}
          </Text>
          <Text style={[styles.resultAnswer, { color: colors.text }]}>
            Your match: {result.matchAnswer}
          </Text>
        </View>
      ))}
    </View>
  );
}

function getAnswerCompatibility(
  results: ChemistrySession["results"],
): number {
  if (!results.length) return 0;
  const total = results.reduce(
    (score, result) =>
      score + compareAnswers(result.myAnswer, result.matchAnswer),
    0,
  );
  return Math.round(total / results.length);
}

function compareAnswers(firstAnswer: string, secondAnswer: string): number {
  const first = normalizeAnswer(firstAnswer);
  const second = normalizeAnswer(secondAnswer);
  if (first === second) return 100;

  const firstWords = new Set(getMeaningfulWords(first));
  const secondWords = new Set(getMeaningfulWords(second));
  if (!firstWords.size || !secondWords.size) return 0;
  const sharedWords = [...firstWords].filter((word) => secondWords.has(word));
  const allWords = new Set([...firstWords, ...secondWords]);
  return (sharedWords.length / allWords.size) * 100;
}

function normalizeAnswer(answer: string): string {
  return answer
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const COMMON_ANSWER_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
  "i", "in", "is", "it", "me", "my", "of", "on", "or", "our", "the",
  "their", "they", "this", "to", "us", "we", "with", "you", "your",
]);

function getMeaningfulWords(answer: string): string[] {
  return answer
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((word) => word.length > 1 && !COMMON_ANSWER_WORDS.has(word)) ?? [];
}

function InsightsCard({
  connection,
  localProfile,
  colors,
}: {
  connection: ChemistryConnection;
  localProfile: LocalDatingProfile | null;
  colors: SystemColors;
}) {
  const sharedInterests = (localProfile?.profile.interests ?? []).filter((mine) =>
    connection.person.interests.some(
      (theirs) => theirs.toLocaleLowerCase() === mine.toLocaleLowerCase(),
    ),
  );
  const sharedIntentions = (localProfile?.intentions ?? []).filter((mine) =>
    connection.person.intentions.some(
      (theirs) => theirs.toLocaleLowerCase() === mine.toLocaleLowerCase(),
    ),
  );
  return (
    <View
      style={[
        styles.insightsCard,
        { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.insightsTitle, { color: colors.text }]}>
        A little in common
      </Text>
      {sharedInterests.length || sharedIntentions.length ? (
        <>
          {sharedInterests.length ? (
            <Text style={[styles.insightsCopy, { color: colors.textSecondary }]}>
              Shared interests · {sharedInterests.join(" · ")}
            </Text>
          ) : null}
          {sharedIntentions.length ? (
            <Text style={[styles.insightsCopy, { color: colors.textSecondary }]}>
              Shared intentions · {sharedIntentions.join(" · ")}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={[styles.insightsCopy, { color: colors.textSecondary }]}>
          Keep exploring together. Shared interests and intentions you both choose
          to share will appear here.
        </Text>
      )}
    </View>
  );
}

function ChemistryScoreCard({
  connection,
  localProfile,
  colors,
}: {
  connection: ChemistryConnection;
  localProfile: LocalDatingProfile | null;
  colors: SystemColors;
}) {
  const sharedInterests = calculateListOverlap(
    localProfile?.profile.interests ?? [],
    connection.person.interests,
  );
  const sharedIntentions = calculateListOverlap(
    localProfile?.intentions ?? [],
    connection.person.intentions,
  );
  const profileSignals = [sharedInterests, sharedIntentions].filter(
    (score): score is number => score !== null,
  );
  const profileAlignment = profileSignals.length
    ? Math.round(
        profileSignals.reduce((total, score) => total + score, 0) /
          profileSignals.length,
      )
    : null;
  const completedActivities = new Set(
    connection.sessions
      .filter((session) => session.status === "completed")
      .map((session) => session.activityKey),
  ).size;
  const activityProgress = Math.round((completedActivities / 3) * 100);
  const availableSignals =
    profileAlignment === null
      ? [activityProgress]
      : [profileAlignment, activityProgress];
  const score = Math.round(
    availableSignals.reduce((total, signal) => total + signal, 0) /
      availableSignals.length,
  );
  const scoreBorderColor = blendHexColors(
    colors.border,
    blendHexColors(colors.compatibility, colors.like, score / 100),
    0.4,
  );

  return (
    <View
      style={[
        styles.chemistryScoreCard,
        { backgroundColor: colors.surface, borderColor: scoreBorderColor },
      ]}
    >
      <Text style={[styles.chemistryScoreEyebrow, { color: colors.like }]}>
        A PRIVATE SNAPSHOT FOR YOU TWO
      </Text>
      <View style={styles.chemistryScoreHeader}>
        <View style={styles.chemistryScoreCopy}>
          <Text style={[styles.chemistryScoreTitle, { color: colors.text }]}>
            Chemistry Score
          </Text>
          <Text
            style={[
              styles.chemistryScoreDescription,
              { color: colors.textSecondary },
            ]}
          >
            A snapshot of shared profile details and activities completed
            together.
          </Text>
        </View>
        <View
          accessibilityLabel={`Chemistry Score ${score} percent`}
          style={[
            styles.chemistryScoreValue,
            { backgroundColor: colors.surfaceSecondary },
          ]}
        >
          <Text style={[styles.chemistryScoreNumber, { color: colors.text }]}>
            {score}%
          </Text>
          <Text
            style={[
              styles.chemistryScorePercent,
              { color: colors.textSecondary },
            ]}
          >
            PAIR
          </Text>
        </View>
      </View>
      <ScoreSignal
        label="Shared interests"
        value={formatScoreSignal(sharedInterests)}
        colors={colors}
      />
      <ScoreSignal
        label="Shared intentions"
        value={formatScoreSignal(sharedIntentions)}
        colors={colors}
      />
      <ScoreSignal
        label="Chemistry activities"
        value={`${completedActivities} of 3 completed together`}
        colors={colors}
      />
      <Text
        style={[styles.chemistryScoreDisclaimer, { color: colors.textMuted }]}
      >
        Profile signals and completed activities are equally weighted. This
        doesn’t analyze private messages or measure feelings or relationship
        potential.
      </Text>
    </View>
  );
}

function ScoreSignal({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: SystemColors;
}) {
  return (
    <View style={styles.scoreSignal}>
      <Text style={[styles.scoreSignalLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text style={[styles.scoreSignalValue, { color: colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

function calculateListOverlap(
  first: readonly string[],
  second: readonly string[],
): number | null {
  const firstValues = new Set(first.map(normalizeSharedValue).filter(Boolean));
  const secondValues = new Set(second.map(normalizeSharedValue).filter(Boolean));
  if (!firstValues.size || !secondValues.size) return null;
  const sharedCount = [...firstValues].filter((value) =>
    secondValues.has(value),
  ).length;
  return Math.round(
    (sharedCount / new Set([...firstValues, ...secondValues]).size) * 100,
  );
}

function normalizeSharedValue(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function formatScoreSignal(score: number | null): string {
  return score === null ? "Not enough shared details yet" : `${score}% overlap`;
}

function blendHexColors(first: string, second: string, ratio: number): string {
  const firstChannels = parseHexColor(first);
  const secondChannels = parseHexColor(second);
  const weight = Math.max(0, Math.min(1, ratio));
  const channels = firstChannels.map((channel, index) =>
    Math.round(channel + (secondChannels[index] - channel) * weight),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function parseHexColor(color: string): [number, number, number] {
  const hex = color.slice(1);
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

function formatRelativeDate(value: string): string {
  const days = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / (24 * 60 * 60 * 1000)),
  );
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.6 },
  title: { fontSize: 30, fontWeight: "800", marginTop: 6 },
  subtitle: { fontSize: 14, lineHeight: 21, marginTop: 6 },
  hero: { borderWidth: 1, borderRadius: 22, padding: 20, marginTop: 20 },
  heroSpark: { fontSize: 23 },
  heroTitle: { fontSize: 18, fontWeight: "700", lineHeight: 25, marginTop: 10 },
  heroCopy: { fontSize: 13, lineHeight: 20, marginTop: 7 },
  sectionHeading: { marginTop: 26 },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  sectionSubtitle: { fontSize: 12, marginTop: 4 },
  connectionRow: { gap: 12, paddingVertical: 14 },
  connectionCard: {
    width: 146,
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    alignItems: "center",
  },
  avatarWrap: { position: "relative" },
  avatarFallback: {
    width: 76,
    height: 76,
    borderRadius: 38,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarInitial: { fontSize: 28, fontWeight: "800" },
  newDot: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    right: 2,
    top: 2,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  connectionName: { fontSize: 13, fontWeight: "700", marginTop: 9 },
  connectionMeta: { fontSize: 10, marginTop: 4 },
  newLabel: { fontSize: 10, fontWeight: "700", marginTop: 5 },
  activityList: { gap: 10, marginTop: 13 },
  activityCard: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 17,
    padding: 13,
  },
  activityIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  activityIcon: { fontSize: 21, fontWeight: "700" },
  activityText: { flex: 1, paddingHorizontal: 12 },
  activityTitle: { fontSize: 14, fontWeight: "700" },
  activityDescription: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  chevron: { fontSize: 25, paddingHorizontal: 4 },
  sessionRow: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 15,
    paddingHorizontal: 15,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  sessionRowText: { flex: 1 },
  questionCard: { borderWidth: 1, borderRadius: 20, padding: 17, marginTop: 18 },
  questionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  questionCount: { fontSize: 9, fontWeight: "700", letterSpacing: 0.7 },
  groupProgress: { fontSize: 11, marginTop: 9 },
  questionItem: {
    borderWidth: 1,
    borderRadius: 15,
    padding: 13,
    marginTop: 13,
  },
  questionItemNumber: { fontSize: 9, fontWeight: "700", letterSpacing: 0.6 },
  questionPrompt: { fontSize: 17, lineHeight: 24, fontWeight: "700", marginTop: 9 },
  choiceList: { gap: 9, marginTop: 18 },
  choiceButton: { borderWidth: 1, borderRadius: 13, padding: 13 },
  choiceText: { fontSize: 13, fontWeight: "600", lineHeight: 19 },
  answerInput: {
    minHeight: 112,
    borderWidth: 1,
    borderRadius: 13,
    padding: 13,
    textAlignVertical: "top",
    fontSize: 14,
    marginTop: 16,
  },
  submitButton: { borderRadius: 14, paddingVertical: 13, alignItems: "center", marginTop: 10 },
  submitText: { fontSize: 13, fontWeight: "700" },
  waitingBox: {
    borderRadius: 14,
    padding: 14,
    marginTop: 16,
    gap: 9,
    alignItems: "center",
  },
  questionWaiting: { borderRadius: 12, padding: 11, marginTop: 12 },
  waitingText: { fontSize: 12, lineHeight: 18, textAlign: "center" },
  sharedResult: { borderRadius: 13, padding: 12, marginTop: 10 },
  resultPrompt: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  resultAnswer: { fontSize: 12, lineHeight: 18, marginTop: 5 },
  completedCard: { borderWidth: 1, borderRadius: 18, padding: 15, marginTop: 12 },
  compatibilityCard: { borderRadius: 13, padding: 12, marginTop: 12 },
  compatibilityTitle: { fontSize: 13, fontWeight: "700" },
  compatibilityCopy: { fontSize: 11, lineHeight: 16, marginTop: 5 },
  insightsCard: { borderWidth: 1, borderRadius: 18, padding: 16, marginTop: 24 },
  chemistryScoreCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginTop: 16,
  },
  chemistryScoreEyebrow: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  chemistryScoreHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  chemistryScoreCopy: {
    flex: 1,
  },
  chemistryScoreTitle: {
    fontSize: 18,
    fontWeight: "800",
  },
  chemistryScoreDescription: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  chemistryScoreValue: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  chemistryScoreNumber: {
    fontSize: 20,
    fontWeight: "800",
  },
  chemistryScorePercent: {
    fontSize: 7,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  scoreSignal: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(128, 128, 128, 0.2)",
  },
  scoreSignalLabel: {
    flex: 1,
    fontSize: 11,
  },
  scoreSignalValue: {
    fontSize: 11,
    fontWeight: "700",
    textAlign: "right",
  },
  chemistryScoreDisclaimer: {
    fontSize: 9,
    lineHeight: 14,
    marginTop: 6,
  },
  insightsTitle: { fontSize: 14, fontWeight: "700" },
  insightsCopy: { fontSize: 12, lineHeight: 18, marginTop: 8 },
  stateWrap: { alignItems: "center", paddingVertical: 32, gap: 12 },
  error: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 10 },
  retryButton: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9 },
  retryText: { fontSize: 12, fontWeight: "700" },
  emptyCard: { borderWidth: 1, borderRadius: 20, padding: 20, marginTop: 22 },
  emptyTitle: { fontSize: 16, fontWeight: "700" },
  emptyCopy: { fontSize: 13, lineHeight: 19, marginTop: 8 },
});

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
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
  ChevronLeft,
  ChevronRight,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react-native";
import VeyraLoader from "../../reusables/VeyraLoader";
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
  initialMatchId?: string | null;
  onInitialMatchSelected?: () => void;
  onClose: () => void;
};

const CHAPTERS = [
  {
    number: "01",
    title: "The Little Things",
    description: "Discover the small things that make someone special.",
    start: 1,
    end: 3,
    color: "#C9BCE5",
  },
  {
    number: "02",
    title: "Beyond the Surface",
    description: "Explore experiences, perspectives and personality.",
    start: 4,
    end: 6,
    color: "#DDA8B8",
  },
  {
    number: "03",
    title: "What Matters Most",
    description: "Discover values, intentions and what matters to you both.",
    start: 7,
    end: 10,
    color: "#B7C7B5",
  },
] as const;

export function ChemistryScreen({
  userId,
  localProfile,
  colors,
  initialMatchId = null,
  onInitialMatchSelected,
  onClose,
}: Props) {
  const [feed, setFeed] = useState<ChemistryFeed | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [isQuestionFlowOpen, setIsQuestionFlowOpen] = useState(false);
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

  useEffect(() => {
    if (!initialMatchId || !feed?.connections.some(
      (connection) => connection.matchId === initialMatchId,
    )) return;
    setSelectedMatchId(initialMatchId);
    setSelectedSessionId("");
    onInitialMatchSelected?.();
  }, [feed, initialMatchId, onInitialMatchSelected]);

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
      : selectedSessionId
        ? undefined
        : activeSessions.find(
            (session) => session.activityKey === "deep_questions",
          ) ?? activeSessions[0];
  const journeySession =
    selectedConnection?.sessions.find(
      (session) => session.activityKey === "deep_questions",
    ) ?? null;
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
        setIsQuestionFlowOpen(true);
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
        setIsQuestionFlowOpen(true);
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

  const openJourneyChapter = useCallback(
    (chapterStart: number) => {
      if (!selectedConnection) return;
      if (!journeySession) {
        const activity = feed?.activities.find(
          (item) => item.key === "deep_questions",
        );
        if (chapterStart === 1 && activity) void startActivity(activity);
        return;
      }
      if (journeySession.status === "active" &&
        chapterStart === journeySession.currentQuestionPosition) {
        setSelectedSessionId(journeySession.id);
        setIsQuestionFlowOpen(true);
      }
    },
    [feed?.activities, journeySession, selectedConnection, startActivity],
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

  if (isQuestionFlowOpen && activeSession && selectedConnection) {
    return (
      <SessionCard
        connection={selectedConnection}
        session={activeSession}
        drafts={drafts}
        isSaving={isSaving}
        error={actionError}
        colors={colors}
        onClose={() => setIsQuestionFlowOpen(false)}
        onDraftChange={(questionId, value) =>
          setDrafts((current) => ({ ...current, [questionId]: value }))
        }
        onSubmit={(question, answer) => void saveAnswer(question, answer)}
      />
    );
  }

  const myJourneyProgress = getMemberProgress(journeySession, "mine");
  const matchJourneyProgress = getMemberProgress(journeySession, "match");
  const journeyActivity = feed?.activities.find(
    (activity) => activity.key === "deep_questions",
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to chat"
          onPress={onClose}
          style={styles.topBarBack}
        >
          <ChevronLeft color={colors.text} size={21} />
        </Pressable>
        <Text style={[styles.topBarTitle, { color: colors.text }]}>
          CHEMISTRY
        </Text>
        <View style={styles.topBarBalance} />
      </View>
      <ScrollView
        style={styles.landingScroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroPortraits}>
            <Portrait
              image={localProfile?.profile.photos[0] ?? null}
              name={localProfile?.profile.nickname ?? "You"}
              colors={colors}
              own
            />
            <View style={[styles.portraitConnector, { backgroundColor: colors.like }]}>
              <Sparkles color="#FFFFFF" size={15} />
            </View>
            <Portrait
              image={selectedConnection?.person.image ?? null}
              name={selectedConnection?.person.name ?? "Your match"}
              colors={colors}
            />
          </View>
          <Text style={[styles.eyebrow, { color: colors.like }]}>
            YOUR JOURNEY TOGETHER
          </Text>
          <Text style={[styles.title, { color: colors.text }]}>
            Discover your Chemistry.
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Ten questions. Three chapters. A deeper connection.
          </Text>
          <View style={[styles.heroNote, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.heroNoteTitle, { color: colors.text }]}>
              A little more about each other.
            </Text>
            <Text style={[styles.heroNoteCopy, { color: colors.textSecondary }]}>
              Get to know each other, one group at a time. Your answers stay
              private until you both complete all ten.
            </Text>
          </View>
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
            <VeyraLoader
              size="medium"
              imageWidth={40}
              imageHeight={40}
              imageMarginBottom={8}
            />
          </View>
        ) : feed?.connections.length ? (
          <>
            <SectionHeading
              title="Choose your connection"
              subtitle="Your Chemistry journey is private to this match."
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
                <JourneyProgressCard
                  connection={selectedConnection}
                  localProfile={localProfile}
                  myProgress={myJourneyProgress}
                  matchProgress={matchJourneyProgress}
                  colors={colors}
                />

                <SectionHeading
                  title="Three chapters"
                  subtitle="Take your time. You can continue whenever you’re ready."
                  colors={colors}
                />
                <View style={styles.chapterList}>
                  {CHAPTERS.map((chapter, index) => {
                    const chapterState = getChapterState(
                      journeySession,
                      index,
                    );
                    const myChapterProgress = getChapterProgress(
                      journeySession,
                      chapter.start,
                      chapter.end,
                      "mine",
                    );
                    const matchChapterProgress = getChapterProgress(
                      journeySession,
                      chapter.start,
                      chapter.end,
                      "match",
                    );
                    return (
                      <ChapterCard
                        key={chapter.number}
                        chapter={chapter}
                        state={chapterState}
                        myProgress={myChapterProgress}
                        matchProgress={matchChapterProgress}
                        colors={colors}
                        onPress={() => openJourneyChapter(chapter.start)}
                      />
                    );
                  })}
                </View>

                {actionError ? (
                  <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
                    {actionError}
                  </Text>
                ) : null}

                {journeySession?.status === "completed" ? (
                  <CompletedAnswers
                    session={journeySession}
                    activity={journeyActivity}
                    colors={colors}
                    matchName={selectedConnection.person.name}
                  />
                ) : null}

                {journeySession?.status === "active" ? (
                  <View style={[styles.revealHint, { backgroundColor: colors.surfaceSecondary }]}>
                    <ShieldCheck color={colors.primary} size={20} />
                    <Text style={[styles.revealHintText, { color: colors.textSecondary }]}>
                      Shared answers unlock together after you both complete all
                      10 questions.
                    </Text>
                  </View>
                ) : null}

                {feed.activities.some((activity) => activity.key !== "deep_questions") ? (
                  <>
                    <SectionHeading
                      title="More ways to connect"
                      subtitle="Optional experiences, separate from your three-chapter journey."
                      colors={colors}
                    />
                    <View style={styles.activityList}>
                      {feed.activities
                        .filter((activity) => activity.key !== "deep_questions")
                        .map((activity) => (
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
                    {activeSessions
                      .filter((session) => session.activityKey !== "deep_questions")
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
                          onPress={() => {
                            setSelectedSessionId(session.id);
                            setIsQuestionFlowOpen(true);
                          }}
                        />
                      ))}
                    {selectedConnection.sessions
                      .filter(
                        (session) =>
                          session.status === "completed" &&
                          session.activityKey !== "deep_questions",
                      )
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
                    {selectedSession?.status === "completed" &&
                    selectedSession.activityKey !== "deep_questions" ? (
                      <CompletedAnswers
                        session={selectedSession}
                        activity={feed.activities.find(
                          (activity) =>
                            activity.key === selectedSession.activityKey,
                        )}
                        colors={colors}
                        matchName={selectedConnection.person.name}
                      />
                    ) : null}
                  </>
                ) : null}

                <InsightsCard
                  connection={selectedConnection}
                  localProfile={localProfile}
                  colors={colors}
                />
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
              When you and someone like each other, your shared journey will
              begin here.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Portrait({
  image,
  name,
  colors,
  own = false,
}: {
  image: string | null;
  name: string;
  colors: SystemColors;
  own?: boolean;
}) {
  return (
    <View
      style={[
        styles.heroPortrait,
        { borderColor: colors.background, backgroundColor: colors.surfaceSecondary },
        own && styles.ownPortrait,
      ]}
    >
      {image ? (
        <Image source={{ uri: image }} style={styles.heroPortraitImage} />
      ) : (
        <Text style={[styles.heroPortraitInitial, { color: colors.primary }]}>
          {name.slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

function JourneyProgressCard({
  connection,
  localProfile,
  myProgress,
  matchProgress,
  colors,
}: {
  connection: ChemistryConnection;
  localProfile: LocalDatingProfile | null;
  myProgress: number;
  matchProgress: number;
  colors: SystemColors;
}) {
  return (
    <View
      style={[
        styles.progressCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.progressCardHeading}>
        <View style={[styles.progressHeadingIcon, { backgroundColor: colors.surfaceSecondary }]}>
          <Sparkles color={colors.primary} size={17} />
        </View>
        <View style={styles.progressHeadingCopy}>
          <Text style={[styles.progressTitle, { color: colors.text }]}>
            Your journey together
          </Text>
          <Text style={[styles.progressSubtitle, { color: colors.textSecondary }]}>
            Shared progress, private answers.
          </Text>
        </View>
      </View>
      <View style={styles.progressMembers}>
        <ProgressMember
          image={localProfile?.profile.photos[0] ?? null}
          name="You"
          answerLabel="Your answers"
          count={myProgress}
          colors={colors}
        />
        <View style={[styles.progressDivider, { backgroundColor: colors.border }]} />
        <ProgressMember
          image={connection.person.image}
          name={connection.person.name}
          answerLabel={`${connection.person.name}’s answers`}
          count={matchProgress}
          colors={colors}
        />
      </View>
      <View style={[styles.privacyNote, { backgroundColor: colors.surfaceSecondary }]}>
        <ShieldCheck color={colors.primary} size={17} />
        <Text style={[styles.privacyNoteText, { color: colors.textSecondary }]}>
          Your answers are private until you both complete all 10 questions.
        </Text>
      </View>
    </View>
  );
}

function ProgressMember({
  image,
  name,
  answerLabel,
  count,
  colors,
}: {
  image: string | null;
  name: string;
  answerLabel: string;
  count: number;
  colors: SystemColors;
}) {
  return (
    <View style={styles.progressMember}>
      <View style={styles.progressMemberHeading}>
        <View style={[styles.progressAvatar, { backgroundColor: colors.surfaceSecondary }]}>
          {image ? (
            <Image source={{ uri: image }} style={styles.progressAvatarImage} />
          ) : (
            <Text style={[styles.progressAvatarInitial, { color: colors.primary }]}>
              {name.slice(0, 1).toUpperCase()}
            </Text>
          )}
        </View>
        <View style={styles.progressMemberText}>
          <Text numberOfLines={1} style={[styles.progressMemberName, { color: colors.text }]}>
            {name}
          </Text>
          <Text numberOfLines={1} style={[styles.progressMemberLabel, { color: colors.textSecondary }]}>
            {answerLabel}
          </Text>
        </View>
        <Text style={[styles.progressCount, { color: colors.text }]}>
          {count}<Text style={{ color: colors.textMuted }}> / 10</Text>
        </Text>
      </View>
      <View style={[styles.progressTrack, { backgroundColor: colors.surfaceSecondary }]}>
        <View
          style={[
            styles.progressFill,
            { width: `${count * 10}%`, backgroundColor: colors.secondary },
          ]}
        />
      </View>
    </View>
  );
}

function ChapterCard({
  chapter,
  state,
  myProgress,
  matchProgress,
  colors,
  onPress,
}: {
  chapter: (typeof CHAPTERS)[number];
  state: ChapterState;
  myProgress: number;
  matchProgress: number;
  colors: SystemColors;
  onPress: () => void;
}) {
  const questionCount = chapter.end - chapter.start + 1;
  const disabled = state === "locked" || state === "complete";
  const statusLabel =
    state === "complete"
      ? "CHAPTER COMPLETE"
      : state === "in-progress"
        ? "IN PROGRESS"
        : state === "locked"
          ? "UP NEXT"
          : "READY WHEN YOU ARE";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: state === "in-progress" }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chapterCard,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: disabled ? 0.7 : pressed ? 0.82 : 1,
        },
      ]}
    >
      <View style={styles.chapterCardTop}>
        <View style={[styles.chapterNumber, { backgroundColor: `${chapter.color}55` }]}>
          <Text style={[styles.chapterNumberText, { color: colors.primary }]}>
            {chapter.number}
          </Text>
        </View>
        <View style={styles.chapterCardMeta}>
          <Text style={[styles.chapterStatus, { color: colors.textSecondary }]}>
            {statusLabel}
          </Text>
          <Text style={[styles.chapterQuestionCount, { color: colors.textSecondary }]}>
            {questionCount} QUESTIONS
          </Text>
        </View>
        {state === "complete" ? (
          <View style={[styles.chapterStateIcon, { backgroundColor: colors.surfaceSecondary }]}>
            <Check color={colors.primary} size={17} />
          </View>
        ) : state === "locked" ? (
          <View style={[styles.chapterStateIcon, { backgroundColor: colors.surfaceSecondary }]}>
            <LockKeyhole color={colors.textMuted} size={16} />
          </View>
        ) : (
          <ChevronRight color={colors.textSecondary} size={19} />
        )}
      </View>
      <Text style={[styles.chapterTitle, { color: colors.text }]}>
        {chapter.title}
      </Text>
      <Text style={[styles.chapterDescription, { color: colors.textSecondary }]}>
        {chapter.description}
      </Text>
      <View style={styles.chapterProgressLine}>
        <Text style={[styles.chapterProgressLabel, { color: colors.textSecondary }]}>
          YOU · MATCH
        </Text>
        <Text style={[styles.chapterProgressValue, { color: colors.text }]}>
          {myProgress}/{questionCount} · {matchProgress}/{questionCount}
        </Text>
      </View>
      <View style={[styles.chapterProgressTrack, { backgroundColor: colors.surfaceSecondary }]}>
        <View
          style={[
            styles.chapterProgressFill,
            {
              width: `${(Math.min(myProgress, matchProgress) / questionCount) * 100}%`,
              backgroundColor: chapter.color,
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

type ChapterState = "available" | "in-progress" | "complete" | "locked";

function getChapterState(
  session: ChemistrySession | null,
  chapterIndex: number,
): ChapterState {
  if (!session) return chapterIndex === 0 ? "available" : "locked";
  if (session.status === "completed") return "complete";
  const currentChapterIndex =
    session.currentQuestionPosition <= 3
      ? 0
      : session.currentQuestionPosition <= 6
        ? 1
        : 2;
  if (chapterIndex < currentChapterIndex) return "complete";
  if (chapterIndex === currentChapterIndex) return "in-progress";
  return "locked";
}

function getMemberProgress(
  session: ChemistrySession | null,
  member: "mine" | "match",
): number {
  if (!session) return 0;
  if (session.status === "completed") return 10;
  const groupStart =
    session.currentQuestionPosition <= 3
      ? 1
      : session.currentQuestionPosition <= 6
        ? 4
        : 7;
  const isSubmitted =
    member === "mine"
      ? (question: ChemistryQuestionProgress) => question.myAnswerSubmitted
      : (question: ChemistryQuestionProgress) => question.matchAnswerSubmitted;
  const completedEarlier = groupStart - 1;
  const submittedInCurrentChapter = session.questions.filter(
    (question) =>
      question.position >= groupStart &&
      question.position <= (groupStart === 7 ? 10 : groupStart + 2) &&
      isSubmitted(question),
  ).length;
  return Math.min(10, completedEarlier + submittedInCurrentChapter);
}

function getChapterProgress(
  session: ChemistrySession | null,
  start: number,
  end: number,
  member: "mine" | "match",
): number {
  if (!session) return 0;
  if (session.status === "completed") return end - start + 1;
  if (session.currentQuestionPosition > end) return end - start + 1;
  const isSubmitted =
    member === "mine"
      ? (question: ChemistryQuestionProgress) => question.myAnswerSubmitted
      : (question: ChemistryQuestionProgress) => question.matchAnswerSubmitted;
  return session.questions.filter(
    (question) =>
      question.position >= start &&
      question.position <= end &&
      isSubmitted(question),
  ).length;
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
  onClose,
  onDraftChange,
  onSubmit,
}: {
  connection: ChemistryConnection;
  session: ChemistrySession;
  drafts: Record<string, string>;
  isSaving: boolean;
  error: string;
  colors: SystemColors;
  onClose: () => void;
  onDraftChange: (questionId: string, value: string) => void;
  onSubmit: (question: ChemistryQuestionProgress, answer: string) => void;
}) {
  const transition = useRef(new Animated.Value(1)).current;
  const currentQuestion =
    session.questions.find((question) => !question.myAnswerSubmitted) ??
    session.questions.find((question) => !question.matchAnswerSubmitted) ??
    null;
  const isWaitingForMatch =
    !currentQuestion || currentQuestion.myAnswerSubmitted;
  const chapter =
    CHAPTERS.find(
      (item) =>
        currentQuestion?.position
          ? currentQuestion.position >= item.start &&
            currentQuestion.position <= item.end
          : session.currentQuestionPosition >= item.start &&
            session.currentQuestionPosition <= item.end,
    ) ?? CHAPTERS[0];
  const draft = currentQuestion ? drafts[currentQuestion.id] ?? "" : "";
  const myProgress = getMemberProgress(session, "mine");
  const canSubmit = Boolean(currentQuestion && draft.trim()) &&
    !isWaitingForMatch &&
    !isSaving;

  useEffect(() => {
    transition.setValue(0);
    Animated.timing(transition, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [currentQuestion?.id, transition]);

  return (
    <KeyboardAvoidingView
      style={[styles.questionFlowRoot, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.questionFlowHeader, { borderBottomColor: colors.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Chemistry journey"
          onPress={onClose}
          style={styles.topBarBack}
        >
          <ChevronLeft color={colors.text} size={21} />
        </Pressable>
        <View style={styles.questionFlowHeaderCopy}>
          <Text style={[styles.questionFlowHeaderTitle, { color: colors.text }]}>
            {chapter.title}
          </Text>
          <Text style={[styles.questionFlowHeaderSubtitle, { color: colors.textSecondary }]}>
            CHAPTER {chapter.number}
          </Text>
        </View>
        <View style={styles.topBarBalance} />
      </View>

      <ScrollView
        style={styles.questionFlowScroll}
        contentContainerStyle={styles.questionFlowContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.questionProgressLabel, { color: colors.textSecondary }]}>
          YOUR JOURNEY
        </Text>
        <View style={styles.questionProgressRow}>
          {Array.from({ length: 10 }, (_, index) => (
            <View
              key={index}
              style={[
                styles.questionProgressSegment,
                {
                  backgroundColor:
                    index < myProgress ? colors.secondary : colors.surfaceSecondary,
                },
              ]}
            />
          ))}
        </View>
        <Text style={[styles.questionProgressCount, { color: colors.text }]}>
          {currentQuestion
            ? `Question ${currentQuestion.position} of 10`
            : `${myProgress} of 10 shared`}
        </Text>
        <View style={styles.questionFlowPromptWrap}>
          <Text style={[styles.questionPromptEyebrow, { color: colors.like }]}>
            {isWaitingForMatch ? "A MOMENT TO PAUSE" : "YOUR TURN"}
          </Text>
          <Animated.View
            style={{
              opacity: transition,
              transform: [
                {
                  translateY: transition.interpolate({
                    inputRange: [0, 1],
                    outputRange: [10, 0],
                  }),
                },
              ],
            }}
          >
            <Text style={[styles.questionPrompt, { color: colors.text }]}>
              {currentQuestion?.prompt ??
                "You’ve shared every answer in this chapter."}
            </Text>
          </Animated.View>
          {isWaitingForMatch ? (
            <View style={[styles.waitingCard, { backgroundColor: colors.surfaceSecondary }]}>
              <ShieldCheck color={colors.primary} size={20} />
              <View style={styles.waitingCopy}>
                <Text style={[styles.waitingTitle, { color: colors.text }]}>
                  Waiting for {connection.person.name}
                </Text>
                <Text style={[styles.waitingText, { color: colors.textSecondary }]}>
                  Your answers are private. You’ll continue together when this
                  chapter is complete.
                </Text>
              </View>
              <VeyraLoader
                size={12}
                imageWidth={16}
                imageHeight={16}
                imageMarginBottom={0}
                loaderShown={false}
              />
            </View>
          ) : currentQuestion ? (
            <>
              {currentQuestion.matchAnswerSubmitted ? (
                <Text style={[styles.matchAnsweredNote, { color: colors.textSecondary }]}>
                  {connection.person.name} has shared an answer. Yours remains
                  private until you both finish all 10 questions.
                </Text>
              ) : null}
              {currentQuestion.choices.length ? (
                <View style={styles.choiceList}>
                  {currentQuestion.choices.map((choice) => {
                    const selected = draft === choice;
                    return (
                      <Pressable
                        key={choice}
                        accessibilityRole="radio"
                        accessibilityState={{ selected, disabled: isSaving }}
                        disabled={isSaving}
                        onPress={() => onDraftChange(currentQuestion.id, choice)}
                        style={[
                          styles.choiceButton,
                          {
                            borderColor: selected ? colors.primary : colors.border,
                            backgroundColor: selected
                              ? colors.surfaceSecondary
                              : colors.surface,
                          },
                        ]}
                      >
                        <Text style={[styles.choiceText, { color: colors.text }]}>
                          {choice}
                        </Text>
                        <View
                          style={[
                            styles.choiceCheck,
                            {
                              borderColor: selected ? colors.primary : colors.border,
                              backgroundColor: selected ? colors.primary : "transparent",
                            },
                          ]}
                        >
                          {selected ? <Check color={colors.textInverse} size={13} /> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <TextInput
                  accessibilityLabel={`Answer to question ${currentQuestion.position}`}
                  multiline
                  maxLength={1000}
                  onChangeText={(value) =>
                    onDraftChange(currentQuestion.id, value)
                  }
                  placeholder="Write what feels true for you…"
                  placeholderTextColor={colors.textMuted}
                  style={[
                    styles.answerInput,
                    {
                      color: colors.text,
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                  value={draft}
                />
              )}
            </>
          ) : null}
        </View>
        {error ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: colors.error }]}>
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.questionFlowFooter, { borderTopColor: colors.border }]}>
        <View style={styles.questionPrivacyFooter}>
          <ShieldCheck color={colors.primary} size={16} />
          <Text style={[styles.questionPrivacyText, { color: colors.textSecondary }]}>
            Only you can see your answers until you both finish.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={!canSubmit}
          onPress={() => {
            if (currentQuestion) onSubmit(currentQuestion, draft);
          }}
          style={[
            styles.submitButton,
            {
              backgroundColor: colors.primary,
              opacity: canSubmit ? 1 : 0.5,
            },
          ]}
        >
          {isSaving ? (
            <VeyraLoader
              size={12}
              imageWidth={16}
              imageHeight={16}
              imageMarginBottom={0}
              loaderShown={false}
            />
          ) : (
            <Text style={[styles.submitText, { color: colors.textInverse }]}>
              {isWaitingForMatch ? "Waiting for your match" : "Share & continue"}
            </Text>
          )}
          {!isWaitingForMatch && !isSaving ? (
            <ChevronRight color={colors.textInverse} size={19} />
          ) : null}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function CompletedAnswers({
  session,
  activity,
  colors,
  matchName,
}: {
  session: ChemistrySession;
  activity: ChemistryActivity | undefined;
  colors: SystemColors;
  matchName: string;
}) {
  return (
    <View
      style={[
        styles.completedCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.eyebrow, { color: colors.like }]}>
        YOUR JOURNEY, COMPLETED
      </Text>
      <Text style={[styles.revealTitle, { color: colors.text }]}>
        There’s more to your connection.
      </Text>
      <Text style={[styles.revealSubtitle, { color: colors.textSecondary }]}>
        {activity?.title ?? "Your Chemistry"} · You both completed all 10
        questions. Here’s what you chose to share.
      </Text>
      {session.results.map((result, index) => (
        <View
          key={`${session.id}-completed-${index}`}
          style={[
            styles.sharedResult,
            { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.resultNumber, { color: colors.like }]}>
            QUESTION {index + 1}
          </Text>
          <Text style={[styles.resultPrompt, { color: colors.textSecondary }]}>
            {result.prompt}
          </Text>
          <View style={[styles.resultAnswerBlock, { borderTopColor: colors.border }]}>
            <Text style={[styles.resultAnswerLabel, { color: colors.textSecondary }]}>
              YOU
            </Text>
            <Text style={[styles.resultAnswer, { color: colors.text }]}>
              {result.myAnswer}
            </Text>
          </View>
          <View style={[styles.resultAnswerBlock, { borderTopColor: colors.border }]}>
            <Text style={[styles.resultAnswerLabel, { color: colors.textSecondary }]}>
              {matchName.toUpperCase()}
            </Text>
            <Text style={[styles.resultAnswer, { color: colors.text }]}>
              {result.matchAnswer}
            </Text>
          </View>
          <Text style={[styles.resultConversationStarter, { color: colors.primary }]}>
            {result.myAnswer.trim().toLocaleLowerCase() ===
            result.matchAnswer.trim().toLocaleLowerCase()
              ? "You chose the same answer. What made it stand out to each of you?"
              : "Compare what you each meant by this answer."}
          </Text>
        </View>
      ))}
    </View>
  );
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
  topBar: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topBarBack: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarTitle: { fontSize: 10, fontWeight: "800", letterSpacing: 2 },
  topBarBalance: { width: 40, height: 40 },
  landingScroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 38 },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  title: {
    maxWidth: 360,
    fontSize: 32,
    lineHeight: 39,
    fontWeight: "700",
    letterSpacing: -0.8,
    textAlign: "center",
    marginTop: 9,
  },
  subtitle: {
    maxWidth: 320,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 7,
  },
  hero: { alignItems: "center", marginTop: 8, marginBottom: 12 },
  heroPortraits: {
    height: 100,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 21,
  },
  heroPortrait: {
    width: 78,
    height: 78,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 4,
    borderRadius: 39,
  },
  ownPortrait: { width: 70, height: 70, borderRadius: 35, marginRight: -8 },
  heroPortraitImage: { width: "100%", height: "100%" },
  heroPortraitInitial: { fontSize: 24, fontWeight: "700" },
  portraitConnector: {
    zIndex: 2,
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    marginHorizontal: -5,
  },
  heroNote: {
    alignSelf: "stretch",
    padding: 17,
    marginTop: 21,
    borderRadius: 20,
  },
  heroNoteTitle: { fontSize: 16, fontWeight: "700" },
  heroNoteCopy: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  sectionHeading: { marginTop: 25 },
  sectionTitle: { fontSize: 17, fontWeight: "700" },
  sectionSubtitle: { fontSize: 12, marginTop: 4 },
  connectionRow: { gap: 10, paddingVertical: 12 },
  connectionCard: {
    width: 134,
    borderWidth: 1,
    borderRadius: 20,
    padding: 11,
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
  progressCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 17,
    marginTop: 5,
  },
  progressCardHeading: { flexDirection: "row", alignItems: "center", gap: 11 },
  progressHeadingIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
  },
  progressHeadingCopy: { flex: 1 },
  progressTitle: { fontSize: 15, fontWeight: "700" },
  progressSubtitle: { fontSize: 11, marginTop: 3 },
  progressMembers: { flexDirection: "row", alignItems: "center", marginTop: 18 },
  progressMember: { flex: 1 },
  progressMemberHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  progressAvatar: {
    width: 34,
    height: 34,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
  },
  progressAvatarImage: { width: "100%", height: "100%" },
  progressAvatarInitial: { fontSize: 14, fontWeight: "700" },
  progressMemberText: { flex: 1 },
  progressMemberName: { fontSize: 11, fontWeight: "700" },
  progressMemberLabel: { fontSize: 9, marginTop: 2 },
  progressCount: { fontSize: 12, fontWeight: "700" },
  progressDivider: { width: 1, height: 42, marginHorizontal: 13 },
  progressTrack: { height: 5, overflow: "hidden", borderRadius: 3, marginTop: 10 },
  progressFill: { height: "100%", borderRadius: 3 },
  privacyNote: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginTop: 17,
    borderRadius: 13,
  },
  privacyNoteText: { flex: 1, fontSize: 10, lineHeight: 15 },
  chapterList: { gap: 11, marginTop: 13 },
  chapterCard: {
    padding: 16,
    borderWidth: 1,
    borderRadius: 21,
  },
  chapterCardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  chapterNumber: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
  },
  chapterNumberText: { fontSize: 13, fontWeight: "800" },
  chapterCardMeta: { flex: 1 },
  chapterStatus: { fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  chapterQuestionCount: { fontSize: 9, fontWeight: "700", marginTop: 4 },
  chapterStateIcon: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
  },
  chapterTitle: { fontSize: 20, fontWeight: "700", marginTop: 14 },
  chapterDescription: { fontSize: 11, lineHeight: 17, marginTop: 5 },
  chapterProgressLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 16,
  },
  chapterProgressLabel: { fontSize: 10 },
  chapterProgressValue: { fontSize: 10, fontWeight: "700" },
  chapterProgressTrack: { height: 4, overflow: "hidden", borderRadius: 2, marginTop: 7 },
  chapterProgressFill: { height: "100%", borderRadius: 2 },
  revealHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 13,
    marginTop: 17,
    borderRadius: 15,
  },
  revealHintText: { flex: 1, fontSize: 11, lineHeight: 16 },
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
  questionFlowRoot: { flex: 1 },
  questionFlowHeader: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  questionFlowHeaderCopy: { flex: 1, alignItems: "center" },
  questionFlowHeaderTitle: { fontSize: 14, fontWeight: "700" },
  questionFlowHeaderSubtitle: { fontSize: 8, fontWeight: "800", letterSpacing: 1.2, marginTop: 3 },
  questionFlowScroll: { flex: 1 },
  questionFlowContent: { flexGrow: 1, paddingHorizontal: 23, paddingTop: 24, paddingBottom: 28 },
  questionProgressLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 1.3 },
  questionProgressRow: { flexDirection: "row", gap: 5, marginTop: 10 },
  questionProgressSegment: { flex: 1, height: 4, borderRadius: 2 },
  questionProgressCount: { fontSize: 11, fontWeight: "700", marginTop: 10 },
  questionFlowPromptWrap: { marginTop: 32 },
  questionPromptEyebrow: { fontSize: 9, fontWeight: "800", letterSpacing: 1.3 },
  questionPrompt: { fontSize: 27, lineHeight: 36, fontWeight: "700", letterSpacing: -0.4, marginTop: 12 },
  matchAnsweredNote: { fontSize: 12, lineHeight: 18, marginTop: 12 },
  choiceList: { gap: 10, marginTop: 26 },
  choiceButton: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderWidth: 1,
    borderRadius: 17,
  },
  choiceText: { flex: 1, fontSize: 13, fontWeight: "600", lineHeight: 19 },
  choiceCheck: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 11,
  },
  answerInput: {
    minHeight: 150,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    textAlignVertical: "top",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 24,
  },
  waitingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 14,
    marginTop: 24,
    borderRadius: 17,
  },
  waitingCopy: { flex: 1 },
  waitingTitle: { fontSize: 12, fontWeight: "700" },
  waitingText: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  questionFlowFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  questionPrivacyFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginBottom: 11,
  },
  questionPrivacyText: { fontSize: 10, lineHeight: 15, textAlign: "center" },
  submitButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 17,
  },
  submitText: { fontSize: 13, fontWeight: "700" },
  completedCard: { borderWidth: 1, borderRadius: 22, padding: 17, marginTop: 22 },
  revealTitle: { fontSize: 23, lineHeight: 29, fontWeight: "700", marginTop: 8 },
  revealSubtitle: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  sharedResult: { borderWidth: 1, borderRadius: 17, padding: 14, marginTop: 12 },
  resultNumber: { fontSize: 8, fontWeight: "800", letterSpacing: 1.1 },
  resultPrompt: { fontSize: 13, lineHeight: 19, fontWeight: "700", marginTop: 7 },
  resultAnswerBlock: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 10 },
  resultAnswerLabel: { fontSize: 8, fontWeight: "800", letterSpacing: 1 },
  resultAnswer: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  resultConversationStarter: { fontSize: 11, lineHeight: 16, fontWeight: "600", marginTop: 12 },
  insightsCard: { borderWidth: 1, borderRadius: 18, padding: 16, marginTop: 22 },
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

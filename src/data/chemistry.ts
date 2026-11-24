import { supabaseClient } from "../lib/supabaseClient";

export type ChemistryActivity = {
  key: string;
  title: string;
  description: string;
  icon: string;
};

export type ChemistryQuestion = {
  id: string;
  position: number;
  prompt: string;
  choices: string[];
};

export type ChemistryQuestionProgress = ChemistryQuestion & {
  myAnswerSubmitted: boolean;
  matchAnswerSubmitted: boolean;
};

export type ChemistryResult = {
  prompt: string;
  myAnswer: string;
  matchAnswer: string;
};

export type ChemistrySession = {
  id: string;
  activityKey: string;
  status: "active" | "completed";
  currentQuestionPosition: number;
  createdAt: string;
  questions: ChemistryQuestionProgress[];
  results: ChemistryResult[];
};

export type ChemistryPerson = {
  id: string;
  name: string;
  age: number | null;
  city: string | null;
  image: string | null;
  interests: string[];
  intentions: string[];
};

export type ChemistryConnection = {
  matchId: string;
  matchedAt: string;
  person: ChemistryPerson;
  sessions: ChemistrySession[];
};

export type ChemistryFeed = {
  activities: ChemistryActivity[];
  connections: ChemistryConnection[];
};

export async function getChemistryFeed(): Promise<ChemistryFeed> {
  const { data, error } = await getClient().functions.invoke<unknown>(
    "daily-discovery",
    {
      body: {
        operation: "chemistry-feed",
        timezone: getLocalTimezone(),
      },
    },
  );
  if (error) {
    throw new Error(
      `Could not load Chemistry: ${await getFunctionErrorMessage(error)}`,
    );
  }
  if (
    !isRecord(data) ||
    !Array.isArray(data.activities) ||
    !Array.isArray(data.connections)
  ) {
    throw new Error("The Chemistry response was invalid.");
  }
  return {
    activities: data.activities.map(normalizeActivity),
    connections: data.connections.map(normalizeConnection),
  };
}

export async function startChemistrySession(
  matchId: string,
  activityKey: string,
): Promise<string> {
  const { data, error } = await getClient().rpc("start_chemistry_session", {
    p_match_id: matchId,
    p_activity_key: activityKey,
  });
  if (error) throw new Error(`Could not start this activity: ${error.message}`);
  if (typeof data !== "string") {
    throw new Error("The new Chemistry session response was invalid.");
  }
  return data;
}

export async function submitChemistryResponse(
  sessionId: string,
  questionId: string,
  answer: string,
): Promise<void> {
  const { error } = await getClient().rpc("submit_chemistry_response", {
    p_session_id: sessionId,
    p_question_id: questionId,
    p_answer: answer,
  });
  if (error) throw new Error(`Could not save your answer: ${error.message}`);
}

function normalizeActivity(value: unknown): ChemistryActivity {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    typeof value.title !== "string" ||
    typeof value.description !== "string" ||
    typeof value.icon !== "string"
  ) {
    throw new Error("A Chemistry activity was invalid.");
  }
  return {
    key: value.key,
    title: value.title,
    description: value.description,
    icon: value.icon,
  };
}

function normalizeConnection(value: unknown): ChemistryConnection {
  if (
    !isRecord(value) ||
    typeof value.match_id !== "string" ||
    typeof value.matched_at !== "string" ||
    !Array.isArray(value.sessions)
  ) {
    throw new Error("A Chemistry connection was invalid.");
  }
  return {
    matchId: value.match_id,
    matchedAt: value.matched_at,
    person: normalizePerson(value.other_profile),
    sessions: value.sessions.map(normalizeSession),
  };
}

function normalizeSession(value: unknown): ChemistrySession {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.activity_key !== "string" ||
    (value.status !== "active" && value.status !== "completed") ||
    !Number.isInteger(value.current_question_position) ||
    typeof value.created_at !== "string" ||
    !Array.isArray(value.results) ||
    !Array.isArray(value.questions)
  ) {
    throw new Error("A Chemistry session was invalid.");
  }
  return {
    id: value.id,
    activityKey: value.activity_key,
    status: value.status,
    currentQuestionPosition: value.current_question_position as number,
    createdAt: value.created_at,
    questions: value.questions.map(normalizeQuestionProgress),
    results: value.results.map(normalizeResult),
  };
}

function normalizeResult(value: unknown): ChemistryResult {
  if (
    !isRecord(value) ||
    typeof value.prompt !== "string" ||
    typeof value.my_answer !== "string" ||
    typeof value.match_answer !== "string"
  ) {
    throw new Error("A Chemistry result was invalid.");
  }
  return {
    prompt: value.prompt,
    myAnswer: value.my_answer,
    matchAnswer: value.match_answer,
  };
}

function normalizeQuestion(value: unknown): ChemistryQuestion {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !Number.isInteger(value.position) ||
    typeof value.prompt !== "string" ||
    !isStringArray(value.choices)
  ) {
    throw new Error("A Chemistry question was invalid.");
  }
  return {
    id: value.id,
    position: value.position as number,
    prompt: value.prompt,
    choices: value.choices,
  };
}

function normalizeQuestionProgress(value: unknown): ChemistryQuestionProgress {
  if (
    !isRecord(value) ||
    typeof value.my_answer_submitted !== "boolean" ||
    typeof value.match_answer_submitted !== "boolean"
  ) {
    throw new Error("A Chemistry question progress record was invalid.");
  }
  return {
    ...normalizeQuestion(value),
    myAnswerSubmitted: value.my_answer_submitted,
    matchAnswerSubmitted: value.match_answer_submitted,
  };
}

function normalizePerson(value: unknown): ChemistryPerson {
  if (
    !isRecord(value) ||
    typeof value.candidate_id !== "string" ||
    typeof value.nickname !== "string" ||
    (value.age !== null && typeof value.age !== "number") ||
    (value.city !== null && typeof value.city !== "string") ||
    (value.image !== null && typeof value.image !== "string") ||
    !isStringArray(value.interests) ||
    !isStringArray(value.intentions)
  ) {
    throw new Error("A Chemistry profile was invalid.");
  }
  return {
    id: value.candidate_id,
    name: value.nickname,
    age: value.age,
    city: value.city,
    image: value.image,
    interests: value.interests,
    intentions: value.intentions,
  };
}

function getClient() {
  if (!supabaseClient) {
    throw new Error("Supabase is not configured. Chemistry is unavailable.");
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
  if (error.context instanceof Response) {
    const status = error.context.status;
    try {
      const body: unknown = await error.context.clone().json();
      if (isRecord(body)) {
        const detail =
          typeof body.error === "string"
            ? body.error
            : typeof body.message === "string"
              ? body.message
              : typeof body.msg === "string"
                ? body.msg
                : null;
        if (detail) return `${detail} (HTTP ${status})`;
      }
    } catch {
      const body = await error.context.clone().text();
      if (body.trim()) return `${body.trim()} (HTTP ${status})`;
    }
    return `${error.message} (HTTP ${status})`;
  }
  return error.message;
}

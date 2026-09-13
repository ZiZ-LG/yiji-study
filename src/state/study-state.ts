import { parseExamAttempts } from "./exam-state";
import type { ExamAttempt } from "./exam-state";

export interface QuestionProgress {
  attempts: number;
  correctCount: number;
  wrongCount: number;
  isWrong: boolean;
  bookmarked: boolean;
  lastCorrect: boolean | null;
  lastAnsweredAt: string | null;
}

export interface StudyCursor {
  questionId: string;
  updatedAt: string;
}

export interface StudyHistoryEntry {
  questionId: string;
  correct: boolean;
  answeredAt: string;
}

export interface StudyDataV1 {
  version: 1;
  questions: Record<string, QuestionProgress>;
  cursors: Record<string, StudyCursor>;
  history: StudyHistoryEntry[];
  exams?: Record<string, ExamAttempt>;
}

export type WrongAction = "added" | "kept" | "removed" | "correct";

export interface AnswerTransition {
  data: StudyDataV1;
  wrongAction: WrongAction;
}

export interface StudySummary {
  answeredCount: number;
  attemptCount: number;
  correctCount: number;
  wrongCount: number;
  bookmarkedCount: number;
  accuracy: number;
}

const HISTORY_LIMIT = 500;

function emptyQuestionProgress(): QuestionProgress {
  return {
    attempts: 0,
    correctCount: 0,
    wrongCount: 0,
    isWrong: false,
    bookmarked: false,
    lastCorrect: null,
    lastAnsweredAt: null,
  };
}

export function createEmptyStudyData(): StudyDataV1 {
  return { version: 1, questions: {}, cursors: {}, history: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function parseQuestionProgress(value: unknown): QuestionProgress | null {
  if (!isRecord(value)) return null;
  const lastCorrect = typeof value.lastCorrect === "boolean" ? value.lastCorrect : null;
  const lastAnsweredAt = typeof value.lastAnsweredAt === "string" ? value.lastAnsweredAt : null;
  return {
    attempts: asNonNegativeInteger(value.attempts),
    correctCount: asNonNegativeInteger(value.correctCount),
    wrongCount: asNonNegativeInteger(value.wrongCount),
    isWrong: value.isWrong === true,
    bookmarked: value.bookmarked === true,
    lastCorrect,
    lastAnsweredAt,
  };
}

export function parseStudyData(raw: unknown): StudyDataV1 {
  if (!isRecord(raw) || raw.version !== 1) return createEmptyStudyData();

  const questions: Record<string, QuestionProgress> = {};
  if (isRecord(raw.questions)) {
    for (const [questionId, value] of Object.entries(raw.questions)) {
      const progress = parseQuestionProgress(value);
      if (progress) questions[questionId] = progress;
    }
  }

  const cursors: Record<string, StudyCursor> = {};
  if (isRecord(raw.cursors)) {
    for (const [key, value] of Object.entries(raw.cursors)) {
      if (!isRecord(value)) continue;
      if (typeof value.questionId !== "string" || typeof value.updatedAt !== "string") continue;
      cursors[key] = { questionId: value.questionId, updatedAt: value.updatedAt };
    }
  }

  const history = Array.isArray(raw.history)
    ? raw.history
        .filter(
          (value): value is Record<string, unknown> =>
            isRecord(value) &&
            typeof value.questionId === "string" &&
            typeof value.correct === "boolean" &&
            typeof value.answeredAt === "string",
        )
        .map((value) => ({
          questionId: value.questionId as string,
          correct: value.correct as boolean,
          answeredAt: value.answeredAt as string,
        }))
        .slice(-HISTORY_LIMIT)
    : [];

  return { version: 1, questions, cursors, history,
    ...(raw.exams !== undefined ? { exams: parseExamAttempts(raw.exams) } : {}),
  };
}

export function recordAnswer(
  data: StudyDataV1,
  questionId: string,
  correct: boolean,
  answeredAt: string,
): AnswerTransition {
  const previous = data.questions[questionId] ?? emptyQuestionProgress();
  const wasWrong = previous.isWrong;
  const nextProgress: QuestionProgress = {
    ...previous,
    attempts: previous.attempts + 1,
    correctCount: previous.correctCount + (correct ? 1 : 0),
    wrongCount: previous.wrongCount + (correct ? 0 : 1),
    isWrong: !correct,
    lastCorrect: correct,
    lastAnsweredAt: answeredAt,
  };

  const wrongAction: WrongAction = correct
    ? wasWrong
      ? "removed"
      : "correct"
    : wasWrong
      ? "kept"
      : "added";

  return {
    wrongAction,
    data: {
      ...data,
      questions: { ...data.questions, [questionId]: nextProgress },
      history: [...data.history, { questionId, correct, answeredAt }].slice(-HISTORY_LIMIT),
    },
  };
}

export function toggleBookmark(data: StudyDataV1, questionId: string): StudyDataV1 {
  const previous = data.questions[questionId] ?? emptyQuestionProgress();
  return {
    ...data,
    questions: {
      ...data.questions,
      [questionId]: { ...previous, bookmarked: !previous.bookmarked },
    },
  };
}

export function saveCursor(
  data: StudyDataV1,
  key: string,
  questionId: string,
  updatedAt = new Date().toISOString(),
): StudyDataV1 {
  return {
    ...data,
    cursors: {
      ...data.cursors,
      [key]: { questionId, updatedAt },
    },
  };
}

export function getStudySummary(data: StudyDataV1): StudySummary {
  const progress = Object.values(data.questions);
  const answered = progress.filter((entry) => entry.attempts > 0);
  const attemptCount = progress.reduce((total, entry) => total + entry.attempts, 0);
  const correctCount = progress.reduce((total, entry) => total + entry.correctCount, 0);
  return {
    answeredCount: answered.length,
    attemptCount,
    correctCount,
    wrongCount: progress.filter((entry) => entry.isWrong).length,
    bookmarkedCount: progress.filter((entry) => entry.bookmarked).length,
    accuracy: attemptCount ? Math.round((correctCount / attemptCount) * 100) : 0,
  };
}

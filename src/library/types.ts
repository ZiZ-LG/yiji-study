import type { ExamPaper } from "../content/exam-paper";
import type { Question, QuestionOption, QuestionType } from "../domain/question";
import type { ExamAttempt } from "../state/exam-state";
import type { StudyDataV1 } from "../state/study-state";

export type AnswerOrigin = "source" | "user" | "ai-adopted";
export interface SourceReference {
  file: string;
  label?: string;
  page?: number;
  ordinal?: string;
  locator?: string;
}
export interface QuestionInput {
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  answers: string[];
  domain: string;
  tags?: string[];
  sources?: SourceReference[];
  explanation?: string;
  /** Source defects or transcription caveats; never an answer/explanation. */
  sourceNote?: string;
  explanationOrigin?: AnswerOrigin;
  answerOrigin?: AnswerOrigin;
  notePath?: string;
  attachmentIds?: string[];
  ruleVersion?: string;
}
export interface QuestionRevision extends QuestionInput {
  id: string;
  questionId: string;
  createdAt: string;
  parentRevisionId?: string;
  reason: string;
  fingerprint: string;
  /** Same key means that only formatting/provenance changed. */
  learningKey: string;
}
export interface LibraryQuestion {
  id: string;
  activeRevisionId: string;
  revisions: Record<string, QuestionRevision>;
  inactive: boolean;
  updatedAt: string;
}
export interface ImportCandidate {
  id: string;
  batchId: string;
  input: QuestionInput;
  issues: string[];
  status: "pending" | "accepted" | "duplicate";
  questionId?: string;
  /** A managed Markdown edit proposes a revision of this existing identity. */
  targetQuestionId?: string;
  ancestorDigests?: string[];
}
export type ScoreMode = "exact" | "proportional";
export interface FrozenPaperItem {
  ordinal: number;
  questionId: string;
  revisionId: string;
  points: number;
  snapshot: QuestionRevision;
}
export interface FrozenPaper {
  id: string;
  bankId: string;
  title: string;
  createdAt: string;
  durationMinutes: number;
  scoreMode: ScoreMode;
  items: FrozenPaperItem[];
  totalScore: number;
  digest: string;
  kind: "original" | "composed";
  declaredTotalScore?: number;
  sourceFile?: string;
  ruleNote?: string;
}
export interface LibraryAttachment {
  id: string;
  path: string;
  mimeType: string;
  /** Required in a portable complete backup. Runtime storage may use path only. */
  dataBase64?: string;
}
export interface ExamWrite {
  id: string;
  sessionId: string;
  parentIds: string[];
  at: string;
  attempt: ExamAttempt;
}
export interface LibraryBank {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nameUpdatedAt: string;
  reviewUpdatedAt: string;
  deletedAt?: string;
  reviewEnabled: boolean;
  questions: Record<string, LibraryQuestion>;
  candidates: Record<string, ImportCandidate>;
  papers: Record<string, FrozenPaper>;
  attachments: Record<string, LibraryAttachment>;
  /** Immutable legacy totals; legacy history is never replayed as new events. */
  baseline: StudyDataV1;
  baselineId: string;
  examSessions: Record<string, ExamAttempt>;
  /** One immutable identity per start time; latest sessions remain compatible with the old UI. */
  examHistory: Record<string, ExamAttempt>;
  examWrites: Record<string, ExamWrite>;
  examHeads: Record<string, string>;
  legacy?: { migratedAt: string; sourceVersion: 1; unknownQuestionIds: string[] };
}
export interface StudyEventBase {
  id: string;
  deviceId: string;
  bankId: string;
  questionId: string;
  revisionId: string;
  at: string;
}
export type LibraryStudyEvent = StudyEventBase & (
  | { kind: "answer"; correct: boolean; selected?: string[]; guessed: boolean; reviewEligible: boolean; context: "practice" | "exam" | "review" }
  | { kind: "bookmark"; value: boolean }
  | { kind: "cursor"; key: string }
  | { kind: "review-enroll" }
  | { kind: "review-reset" }
);
export interface LibraryConflict {
  id: string;
  kind: "revision" | "question-head" | "event" | "baseline" | "paper" | "exam" | "exam-write" | "attachment" | "candidate" | "bank";
  bankId: string;
  entityId: string;
  local: unknown;
  remote: unknown;
  resolved?: boolean;
}
export interface LibraryState {
  version: 2;
  deviceId: string;
  activeBankId: string | null;
  banks: Record<string, LibraryBank>;
  events: Record<string, LibraryStudyEvent>;
  conflicts: LibraryConflict[];
}
export interface CommitOptions {
  bankId?: string;
  questionId?: string;
  revisionId?: string;
  reason?: string;
  now?: string;
  allowSeparate?: boolean;
  /** Explicit user confirmation after comparing an answer-conflicting candidate. */
  resolveConflict?: boolean;
}
export interface CommitResult {
  state: LibraryState;
  status: "created" | "revised" | "duplicate" | "invalid" | "conflict";
  questionId?: string;
  revisionId?: string;
  issues: string[];
  conflictingQuestionIds?: string[];
}
export interface ComposeOptions {
  bankId?: string;
  id?: string;
  title: string;
  durationMinutes: number;
  scoreMode?: ScoreMode;
  counts: Partial<Record<QuestionType, number>>;
  points?: Partial<Record<QuestionType, number>>;
  domains?: string[];
  sources?: string[];
  filter?: "all" | "wrong" | "unanswered" | "bookmarked";
  now?: string;
}
export interface ComposeResult {
  state: LibraryState;
  paper?: FrozenPaper;
  shortages: Partial<Record<QuestionType, number>>;
  issues: string[];
}
export interface OriginalPaperOptions {
  bankId?: string;
  batchId?: string;
  id?: string;
  title: string;
  sourceFile: string;
  durationMinutes: number;
  scoreMode?: ScoreMode;
  declaredTotalScore?: number;
  declaredQuestionCount?: number;
  ruleNote?: string;
  completenessConfirmed: boolean;
  items: { candidateId: string; ordinal: number; points: number }[];
  now?: string;
}
export interface ReviewSchedule {
  questionId: string;
  revisionId: string;
  stage: number;
  dueAt: string;
  lastReviewedAt: string;
}
export interface RecordAnswerOptions {
  id?: string;
  bankId?: string;
  revisionId?: string;
  now?: string;
  selected?: string[];
  guessed?: boolean;
  context?: "practice" | "exam" | "review";
}
export interface LibraryBackup {
  format: "yiji-library-backup";
  version: 1;
  createdAt: string;
  checksum: string;
  library: LibraryState;
}
export interface ValidationResult {
  valid: boolean;
  issues: string[];
}
export interface PaperGrade {
  score: number;
  totalScore: number;
  correctCount: number;
  answeredCount: number;
  results: { ordinal: number; correct: boolean; answered: boolean; points: number }[];
}
export interface AnswerEvidence {
  sampleCount: number;
  correctCount: number;
  accuracy: number | null;
}
export interface DomainLearningEvidence {
  domain: string;
  observedQuestions: number;
  answerCount: number;
  firstAnswers: AnswerEvidence;
  delayedAnswers: AnswerEvidence;
  repeatedWrongQuestions: number;
  unretestedQuestions: number;
}
export interface LearningEvidence {
  firstAnswers: AnswerEvidence;
  delayedAnswers: AnswerEvidence;
  answerCount: number;
  observedQuestions: number;
  repeatedWrongQuestionIds: string[];
  unretestedQuestionIds: string[];
  domains: DomainLearningEvidence[];
  legacyAttemptCount: number;
  legacyHistoryCount: number;
  legacyHistoryIncomplete: boolean;
  legacyExcludedFromFirstAndDelayed: boolean;
  note: string;
}
export type { ExamPaper, Question, QuestionType, StudyDataV1 };

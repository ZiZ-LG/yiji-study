import type { ExamPaper } from "../content/exam-paper";
import type { Question } from "../domain/question";
import { recordAnswer } from "./study-state";
import type { StudyDataV1 } from "./study-state";

export interface ExamAttempt {
  paperId: string;
  paperDigest: string;
  startedAt: number;
  deadlineAt: number;
  index: number;
  answers: Record<string, string[]>;
  submittedAt?: number;
  score?: number;
  correctCount?: number;
  answeredCount?: number;
}

export function parseExamAttempts(raw: unknown): Record<string, ExamAttempt> {
  const result: Record<string, ExamAttempt> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const v = value as Record<string, unknown>;
    if (v.paperId !== id || typeof v.paperDigest !== "string"
      || typeof v.startedAt !== "number" || !Number.isFinite(v.startedAt) || v.startedAt < 0
      || typeof v.deadlineAt !== "number" || !Number.isFinite(v.deadlineAt) || v.deadlineAt <= v.startedAt
      || typeof v.index !== "number" || !Number.isInteger(v.index) || v.index < 0 || v.index >= 170) continue;
    const answers: Record<string, string[]> = {};
    if (v.answers && typeof v.answers === "object" && !Array.isArray(v.answers)) {
      for (const [ordinal, selected] of Object.entries(v.answers)) {
        if (!/^\d+$/.test(ordinal) || Number(ordinal) < 1 || Number(ordinal) > 170) continue;
        if (Array.isArray(selected) && selected.every((key) => typeof key === "string" && /^(?:[A-H]|对|错)$/.test(key))) {
          answers[ordinal] = [...new Set(selected as string[])];
        }
      }
    }
    const attempt: ExamAttempt = {
      paperId: id, paperDigest: v.paperDigest, startedAt: v.startedAt,
      deadlineAt: v.deadlineAt, index: v.index, answers,
    };
    if (v.submittedAt !== undefined) {
      if (typeof v.submittedAt !== "number" || !Number.isFinite(v.submittedAt) || v.submittedAt < v.startedAt
        || typeof v.score !== "number" || !Number.isFinite(v.score) || v.score < 0 || v.score > 100
        || typeof v.correctCount !== "number" || !Number.isInteger(v.correctCount) || v.correctCount < 0
        || typeof v.answeredCount !== "number" || !Number.isInteger(v.answeredCount)
        || v.answeredCount < v.correctCount || v.answeredCount > 170) continue;
      Object.assign(attempt, { submittedAt: v.submittedAt, score: v.score, correctCount: v.correctCount, answeredCount: v.answeredCount });
    }
    result[id] = attempt;
  }
  return result;
}

export function startExam(paper: ExamPaper, now: number): ExamAttempt {
  return { paperId: paper.id, paperDigest: paper.sourceSha256, startedAt: now,
    deadlineAt: now + paper.durationMinutes * 60_000, index: 0, answers: {} };
}

export function saveExam(data: StudyDataV1, attempt: ExamAttempt): StudyDataV1 {
  return { ...data, exams: { ...data.exams, [attempt.paperId]: attempt } };
}

export function isCorrectSelection(question: Question, selected: readonly string[]): boolean {
  return new Set(selected).size === selected.length && selected.length === question.answers.length
    && selected.every((key) => question.answers.includes(key));
}

export function submitExam(data: StudyDataV1, paper: ExamPaper, bank: ReadonlyMap<string, Question>, now: number): StudyDataV1 {
  const attempt = data.exams?.[paper.id];
  if (!attempt || attempt.paperDigest !== paper.sourceSha256) throw new Error("试卷版本不一致，请重新开考");
  if (attempt.submittedAt !== undefined) return data;
  // Validate the entire paper before applying any study progress.
  const questions = paper.items.map((item) => {
    const question = bank.get(item.questionId);
    if (!question) throw new Error(`试卷缺少第 ${item.ordinal} 题`);
    return { question, item };
  });
  let next = data;
  let score = 0;
  let correctCount = 0;
  let answeredCount = 0;
  for (const { question, item } of questions) {
    const selected = attempt.answers[String(item.ordinal)] ?? [];
    if (!selected.length) continue;
    answeredCount += 1;
    const correct = isCorrectSelection(question, selected);
    if (correct) { score += item.points; correctCount += 1; }
    next = recordAnswer(next, question.id, correct, new Date(now).toISOString()).data;
  }
  return saveExam(next, { ...attempt, submittedAt: now, score, correctCount, answeredCount });
}

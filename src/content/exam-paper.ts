import type { QuestionType } from "../domain/question";

export interface ExamPaper {
  id: string;
  title: string;
  sourcePdf: string;
  sourceSha256: string;
  durationMinutes: number;
  ruleNote: string;
  declaredTotalScore: number;
  totalScore: number;
  counts: Record<QuestionType, number>;
  items: { ordinal: number; questionId: string; points: number }[];
}

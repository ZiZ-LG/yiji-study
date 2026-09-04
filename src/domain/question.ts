export type QuestionType = "single" | "multiple" | "judge";

export interface QuestionOption {
  key: string;
  text: string;
}

export interface QuestionIdentityInput {
  type: QuestionType;
  stem: string;
  options: readonly QuestionOption[];
  answers: readonly string[];
}

export interface Question extends QuestionIdentityInput {
  id: string;
  options: QuestionOption[];
  answers: string[];
  domain: string;
  sources: string[];
  repeatCount: number;
  sourceFile: string;
  sourceOrdinal: number;
}

export type ParseIssueCode =
  | "unknown-type"
  | "missing-stem"
  | "missing-options"
  | "missing-answer"
  | "missing-domain"
  | "invalid-answer";

export interface ParseIssue {
  code: ParseIssueCode;
  message: string;
  sourceFile: string;
  sourceOrdinal: number;
}

export interface ParseResult {
  questions: Question[];
  issues: ParseIssue[];
}

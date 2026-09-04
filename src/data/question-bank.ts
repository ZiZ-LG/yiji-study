import type { Vault } from "obsidian";
import { ACTIVE_CONTENT_PACKAGE } from "../content/content-package";
import type { ParseIssue, Question, QuestionType } from "../domain/question";
import { EMBEDDED_QUESTIONS } from "../generated/electricity-trader-pack";
import { parseQuestionFile } from "./question-parser";

export const TYPE_BANK_ROOT = ACTIVE_CONTENT_PACKAGE.questionBankRoot;
export const DOMAIN_ORDER = ACTIVE_CONTENT_PACKAGE.domains;

export interface QuestionSourceFile {
  path: string;
  content: string;
}

export interface DomainSummary {
  name: string;
  count: number;
  counts: Record<QuestionType, number>;
}

export interface QuestionCounts extends Record<QuestionType, number> {
  total: number;
}

export interface DuplicateQuestionIssue {
  code: "duplicate-id";
  message: string;
  sourceFile: string;
  sourceOrdinal: number;
}

export type QuestionBankIssue = ParseIssue | DuplicateQuestionIssue;

export interface QuestionBank {
  questions: Question[];
  byId: Map<string, Question>;
  domains: DomainSummary[];
  counts: QuestionCounts;
  issues: QuestionBankIssue[];
  sourceKind: "markdown" | "embedded";
}

export function isQuestionSourcePath(path: string): boolean {
  if (!path.startsWith(`${TYPE_BANK_ROOT}/`)) return false;
  const directories = Object.values(ACTIVE_CONTENT_PACKAGE.questionTypeDirectories);
  const relative = path.slice(TYPE_BANK_ROOT.length + 1);
  return directories.some((directory) =>
    relative.startsWith(`${directory}/`) && /\/[^/]+-测验-第\d+卷\.md$/.test(`/${relative}`),
  );
}

function emptyTypeCounts(): Record<QuestionType, number> {
  return { single: 0, multiple: 0, judge: 0 };
}

function indexQuestions(
  candidates: readonly Question[],
  issues: QuestionBankIssue[],
): { questions: Question[]; byId: Map<string, Question> } {
  const questions: Question[] = [];
  const byId = new Map<string, Question>();

  for (const question of candidates) {
    const existing = byId.get(question.id);
    if (existing) {
      issues.push({
        code: "duplicate-id",
        message: `稳定 ID 与 ${existing.sourceFile}#${existing.sourceOrdinal} 重复`,
        sourceFile: question.sourceFile,
        sourceOrdinal: question.sourceOrdinal,
      });
      continue;
    }
    byId.set(question.id, question);
    questions.push(question);
  }
  return { questions, byId };
}

function finalizeQuestionBank(
  candidates: readonly Question[],
  issues: QuestionBankIssue[],
  sourceKind: QuestionBank["sourceKind"],
): QuestionBank {
  const { questions, byId } = indexQuestions(candidates, issues);

  const counts: QuestionCounts = { ...emptyTypeCounts(), total: questions.length };
  for (const question of questions) counts[question.type] += 1;

  const domainMap = new Map<string, DomainSummary>();
  for (const name of DOMAIN_ORDER) {
    domainMap.set(name, { name, count: 0, counts: emptyTypeCounts() });
  }
  for (const question of questions) {
    const summary = domainMap.get(question.domain) ?? {
      name: question.domain,
      count: 0,
      counts: emptyTypeCounts(),
    };
    summary.count += 1;
    summary.counts[question.type] += 1;
    domainMap.set(question.domain, summary);
  }

  const knownDomains = DOMAIN_ORDER.map((name) => domainMap.get(name)).filter(
    (domain): domain is DomainSummary => Boolean(domain),
  );
  const knownNames = new Set<string>(DOMAIN_ORDER);
  const extraDomains = Array.from(domainMap.values())
    .filter((domain) => !knownNames.has(domain.name))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  return {
    questions,
    byId,
    domains: [...knownDomains, ...extraDomains],
    counts,
    issues,
    sourceKind,
  };
}

export function buildQuestionBank(files: readonly QuestionSourceFile[]): QuestionBank {
  const candidates: Question[] = [];
  const issues: QuestionBankIssue[] = [];

  const orderedFiles = [...files]
    .filter((file) => isQuestionSourcePath(file.path))
    .sort((left, right) => left.path.localeCompare(right.path, "zh-CN", { numeric: true }));

  for (const file of orderedFiles) {
    const parsed = parseQuestionFile(file.path, file.content);
    issues.push(...parsed.issues);
    candidates.push(...parsed.questions);
  }
  return finalizeQuestionBank(candidates, issues, "markdown");
}

export function buildQuestionBankFromQuestions(questions: readonly Question[]): QuestionBank {
  return finalizeQuestionBank(questions, [], "embedded");
}

export async function loadQuestionBank(vault: Vault): Promise<QuestionBank> {
  const sourceFiles = vault.getMarkdownFiles().filter((file) => isQuestionSourcePath(file.path));
  if (sourceFiles.length !== ACTIVE_CONTENT_PACKAGE.sourceFileCount) {
    return buildQuestionBankFromQuestions(EMBEDDED_QUESTIONS);
  }
  const files = await Promise.all(
    sourceFiles.map(async (file) => ({
      path: file.path,
      content: await vault.cachedRead(file),
    })),
  );
  return buildQuestionBank(files);
}

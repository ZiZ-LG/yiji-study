import {
  ParseIssue,
  ParseResult,
  Question,
  QuestionIdentityInput,
  QuestionOption,
  QuestionType,
} from "../domain/question";

const QUESTION_START = /^>\s*\[!question\]\+\s*Q(\d+)\.\s*(.*)$/;
const ANSWER_CALLOUT = /^>>\s*\[!success\]-\s*答案\s*$/;
const OPTION_LINE = /^([A-H])[.．、]\s*(.*)$/;
const JUDGE_LINE = /^对\s*[／/]\s*错\s*[？?]?$/;

interface QuestionBlock {
  sourceOrdinal: number;
  firstStemLine: string;
  lines: string[];
}

function normalizeIdentityText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[，]/g, ",")
    .replace(/[。]/g, ".")
    .trim();
}

function hash32(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function createQuestionId(input: QuestionIdentityInput): string {
  const identity = [
    input.type,
    normalizeIdentityText(input.stem),
    ...input.options.map((option) => `${option.key}:${normalizeIdentityText(option.text)}`),
    `answer:${input.answers.join(",")}`,
  ].join("|");
  const first = hash32(identity, 0x811c9dc5).toString(16).padStart(8, "0");
  const second = hash32(identity, 0x9e3779b9).toString(16).padStart(8, "0");
  return `q_${first}${second}`;
}

function inferQuestionType(path: string, markdown: string): QuestionType | null {
  const source = `${path}\n${markdown.slice(0, 800)}`;
  if (source.includes("单选题")) return "single";
  if (source.includes("多选题")) return "multiple";
  if (source.includes("判断题")) return "judge";
  return null;
}

function collectBlocks(markdown: string): QuestionBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: QuestionBlock[] = [];
  let current: QuestionBlock | null = null;

  for (const line of lines) {
    const start = line.match(QUESTION_START);
    if (start) {
      if (current) blocks.push(current);
      current = {
        sourceOrdinal: Number.parseInt(start[1] ?? "0", 10),
        firstStemLine: (start[2] ?? "").trim(),
        lines: [],
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) blocks.push(current);
  return blocks;
}

function cleanQuoteLine(line: string): string {
  return line.replace(/^>>?\s?/, "").trim();
}

function parseMetadata(lines: readonly string[]): {
  domain: string;
  sources: string[];
  repeatCount: number;
} {
  const line = lines.map(cleanQuoteLine).find((entry) => entry.includes("归属：")) ?? "";
  const domainMatch = line.match(/归属：\s*(.*?)\s*来源：/);
  const sourceMatch = line.match(/来源：\s*`?(.+?)`?\s*(?:跨卷(?:重复)?|$)/);
  const repeatMatch = line.match(/跨卷(?:重复)?\s*[×xX]\s*(\d+)/);

  return {
    domain: domainMatch?.[1]?.trim() ?? "",
    sources: (sourceMatch?.[1] ?? "")
      .replace(/`/g, "")
      .split(/[、,，]/)
      .map((source) => source.trim())
      .filter(Boolean),
    repeatCount: repeatMatch ? Number.parseInt(repeatMatch[1] ?? "1", 10) : 1,
  };
}

function parseAnswers(type: QuestionType, answerText: string): string[] {
  if (type === "judge") {
    if (answerText.includes("对") || answerText.includes("正确")) return ["对"];
    if (answerText.includes("错") || answerText.includes("错误")) return ["错"];
    return [];
  }
  return Array.from(answerText.matchAll(/[A-H]/g), (match) => match[0]);
}

function issue(
  code: ParseIssue["code"],
  sourceFile: string,
  sourceOrdinal: number,
  message: string,
): ParseIssue {
  return { code, sourceFile, sourceOrdinal, message };
}

function parseBlock(
  type: QuestionType,
  sourceFile: string,
  block: QuestionBlock,
): { question?: Question; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];
  const answerCalloutIndex = block.lines.findIndex((line) => ANSWER_CALLOUT.test(line));
  const questionLines = answerCalloutIndex >= 0 ? block.lines.slice(0, answerCalloutIndex) : block.lines;
  const answerLines = answerCalloutIndex >= 0 ? block.lines.slice(answerCalloutIndex + 1) : [];
  const stemParts = block.firstStemLine ? [block.firstStemLine] : [];
  const options: QuestionOption[] = [];
  let reachedChoices = false;

  for (const rawLine of questionLines) {
    if (!rawLine.startsWith(">") || rawLine.startsWith(">>")) continue;
    const line = cleanQuoteLine(rawLine);
    if (!line) continue;
    const optionMatch = line.match(OPTION_LINE);
    if (optionMatch) {
      reachedChoices = true;
      options.push({ key: optionMatch[1] ?? "", text: (optionMatch[2] ?? "").trim() });
      continue;
    }
    if (JUDGE_LINE.test(line)) {
      reachedChoices = true;
      continue;
    }
    if (!reachedChoices) stemParts.push(line);
  }

  if (type === "judge") {
    options.push(
      { key: "对", text: "正确" },
      { key: "错", text: "错误" },
    );
  }

  const answerText = answerLines
    .map(cleanQuoteLine)
    .map((line) => line.match(/^\*\*(.+?)\*\*$/)?.[1])
    .find((value): value is string => Boolean(value)) ?? "";
  const answers = parseAnswers(type, answerText);
  const stem = stemParts.join(" ").replace(/\s+/g, " ").trim();
  const metadata = parseMetadata(block.lines);

  if (!stem) issues.push(issue("missing-stem", sourceFile, block.sourceOrdinal, "题干为空"));
  if (options.length < 2) issues.push(issue("missing-options", sourceFile, block.sourceOrdinal, "选项不足两个"));
  if (!answers.length) issues.push(issue("missing-answer", sourceFile, block.sourceOrdinal, "未找到参考答案"));
  if (!metadata.domain) issues.push(issue("missing-domain", sourceFile, block.sourceOrdinal, "未找到知识域"));
  if (answers.some((answer) => !options.some((option) => option.key === answer))) {
    issues.push(issue("invalid-answer", sourceFile, block.sourceOrdinal, `答案 ${answers.join("、")} 不在选项中`));
  }

  if (issues.length) return { issues };

  const identity: QuestionIdentityInput = { type, stem, options, answers };
  return {
    issues,
    question: {
      ...identity,
      id: createQuestionId(identity),
      options,
      answers,
      domain: metadata.domain,
      sources: metadata.sources,
      repeatCount: metadata.repeatCount,
      sourceFile,
      sourceOrdinal: block.sourceOrdinal,
    },
  };
}

export function parseQuestionFile(path: string, markdown: string): ParseResult {
  const type = inferQuestionType(path, markdown);
  if (!type) {
    return {
      questions: [],
      issues: [issue("unknown-type", path, 0, "无法从文件路径或 frontmatter 判断题型")],
    };
  }

  const questions: Question[] = [];
  const issues: ParseIssue[] = [];
  for (const block of collectBlocks(markdown)) {
    const parsed = parseBlock(type, path, block);
    if (parsed.question) questions.push(parsed.question);
    issues.push(...parsed.issues);
  }
  return { questions, issues };
}

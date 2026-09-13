import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { ACTIVE_CONTENT_PACKAGE } from "../src/content/content-package";
import { createQuestionId, parseQuestionFile } from "../src/data/question-parser";
import { mergeQuestions } from "../src/data/merge-questions";
import type { ExamPaper } from "../src/content/exam-paper";
import { readPdfQuestions } from "./recent-pdf";
import type { Question, QuestionType } from "../src/domain/question";

const projectRoot = process.cwd();
const sourceRoot = resolve(projectRoot, ACTIVE_CONTENT_PACKAGE.questionBankRoot);
const generatedDirectory = resolve(projectRoot, "src/generated");
const outputPath = resolve(generatedDirectory, "electricity-trader-pack.ts");
const metadataPath = resolve(generatedDirectory, "electricity-trader-pack.meta.json");

interface SourceFile {
  path: string;
  content: string;
}

async function loadSourceFiles(root = sourceRoot): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for (const directory of Object.values(ACTIVE_CONTENT_PACKAGE.questionTypeDirectories)) {
    const absoluteDirectory = join(root, directory);
    const names = (await readdir(absoluteDirectory))
      .filter((name) => name.includes("-测验-第") && name.endsWith("卷.md"))
      .sort((left, right) => left.localeCompare(right, "zh-CN", { numeric: true }));
    for (const name of names) {
      const absolutePath = join(absoluteDirectory, name);
      files.push({
        path: relative(projectRoot, absolutePath).split(sep).join("/"),
        content: await readFile(absolutePath, "utf8"),
      });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, "zh-CN", { numeric: true }));
}

function countQuestions(questions: readonly Question[]): Record<QuestionType, number> & { total: number } {
  const counts = { single: 0, multiple: 0, judge: 0, total: questions.length };
  for (const question of questions) counts[question.type] += 1;
  return counts;
}

function assertPack(files: readonly SourceFile[], questions: readonly Question[]): void {
  if (files.length !== ACTIVE_CONTENT_PACKAGE.sourceFileCount + 11) {
    throw new Error(`题源文件应为 31 个，实际为 ${files.length} 个`);
  }
  const actualCounts = countQuestions(questions);
  if (JSON.stringify(actualCounts) !== JSON.stringify(ACTIVE_CONTENT_PACKAGE.expectedQuestionCounts)) {
    throw new Error(
      `题量变化，拒绝覆盖内置题包：期望 ${JSON.stringify(ACTIVE_CONTENT_PACKAGE.expectedQuestionCounts)}，实际 ${JSON.stringify(actualCounts)}`,
    );
  }
  if (new Set(questions.map((question) => question.id)).size !== questions.length) {
    throw new Error("稳定题目 ID 存在冲突，拒绝生成内置题包");
  }
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const recentRoot = "电力交易员StudyVault-近期真题版";
const originalFiles = await loadSourceFiles();
const recentFiles = await loadSourceFiles(resolve(projectRoot, recentRoot));
const files = [...originalFiles, ...recentFiles];
const originalQuestions: Question[] = [];
const recentQuestions: Question[] = [];
const issues: string[] = [];
for (const file of files) {
  const parsed = parseQuestionFile(file.path, file.content);
  (file.path.startsWith(`${recentRoot}/`) ? recentQuestions : originalQuestions).push(...parsed.questions);
  issues.push(...parsed.issues.map((entry) => `${entry.sourceFile}#${entry.sourceOrdinal}: ${entry.message}`));
}

if (issues.length) {
  throw new Error(`题库存在 ${issues.length} 个解析问题：\n${issues.slice(0, 20).join("\n")}`);
}
if (originalQuestions.length !== 1085 || recentQuestions.length !== 605) {
  throw new Error("原始题库或新增 Markdown 题量异常");
}

const papers: ExamPaper[] = [];
const pdfDigests: string[] = [];
for (const [sourceId, title] of [
  ["6-26-A", "2026 年 6 月 26 日 · A 卷"],
  ["6-26-B", "2026 年 6 月 26 日 · B 卷"],
  ["6-30", "2026 年 6 月 30 日 · 真题"],
  ["7-18", "2026 年 7 月 18 日 · 真题"],
] as const) {
  const sourcePdf = `${recentRoot}/近期真题 pdf/2026-${sourceId}.pdf`;
  const sourceSha256 = createHash("sha256").update(await readFile(sourcePdf)).digest("hex");
  pdfDigests.push(sourceSha256);
  const pdf = readPdfQuestions(sourcePdf);
  const items: ExamPaper["items"] = [];
  const counts = { single: 0, multiple: 0, judge: 0 };
  for (const pdfQuestion of pdf.questions) {
    const source = `${sourceId}#${pdfQuestion.ordinal}`;
    const matches = recentQuestions.filter((question) => question.sources.includes(source));
    if (matches.length !== 1) throw new Error(`${source}: missing or duplicated source mapping`);
    const question = matches[0]!;
    // Two defects confirmed visually against the original PDF; never rewrite historical sources.
    if (source === "6-30#122") {
      if (question.options[4]?.text !== "热爱本职 F：勇于创新" || question.answers.join("") !== "ABE") {
        throw new Error("Unexpected source change at 6-30#122; re-audit required");
      }
      question.options = pdfQuestion.options.map((option) => ({ ...option }));
      question.answers = [...pdfQuestion.answers];
      question.id = createQuestionId(question);
    }
    if (source === "6-30#39") {
      if (question.options.map((option) => option.text).join("|") !== "5\u000015min|10\u000030min|15\u000060min|30\u000060min"
        || pdfQuestion.options.map((option) => option.text).join("|") !== "5 15min|10 30min|15 60min|30 60min") {
        throw new Error("Unexpected source change at 6-30#39; re-audit required");
      }
      question.options = question.options.map((option) => ({ ...option, text: option.text.replace(/\u0000/g, "□") }));
      question.sourceNote = "原 PDF 的选项区间符号已缺字，使用 □ 保留缺字位置，未推测补写。";
      question.id = createQuestionId(question);
      pdfQuestion.options = question.options;
    }
    if (question.id !== createQuestionId(pdfQuestion)) {
      throw new Error(`${source}: PDF and Markdown differ; manual audit required`);
    }
    counts[question.type] += 1;
    items.push({ ordinal: pdfQuestion.ordinal, questionId: question.id, points: pdfQuestion.points });
  }
  const expectedCounts = sourceId === "7-18" ? { single: 100, multiple: 20, judge: 50 } : { single: 100, multiple: 30, judge: 40 };
  if (JSON.stringify(counts) !== JSON.stringify(expectedCounts)) throw new Error(`${sourceId}: unexpected section counts`);
  const totalScore = items.reduce((sum, item) => sum + item.points, 0);
  papers.push({
    id: `real-2026-${sourceId}`, title, sourcePdf, sourceSha256,
    durationMinutes: 120, declaredTotalScore: pdf.declaredTotalScore, totalScore, counts, items,
    ruleNote: "练习限时沿用易记的 120 分钟设置；原 PDF 只记录个人考试用时，未注明考试限时。多选须全部选对才得分。"
      + (totalScore !== pdf.declaredTotalScore ? ` 原卷卷头标注 ${pdf.declaredTotalScore} 分，逐题合计 ${totalScore} 分；本卷按逐题标注计分，不折算为百分制。` : ""),
  });
}
const questions = mergeQuestions(originalQuestions, recentQuestions);
assertPack(files, questions);

const digest = createHash("sha256");
for (const file of files) digest.update(file.path).update("\0").update(file.content).update("\0");
for (const pdfDigest of pdfDigests) digest.update(pdfDigest).update("\0");
const sourceDigest = digest.digest("hex");
const questionCounts = countQuestions(questions);
const generated = `/* 此文件由 npm run content:generate 生成，请勿手工编辑。 */
import type { Question } from "../domain/question";
import type { ExamPaper } from "../content/exam-paper";

export const EMBEDDED_CONTENT_VERSION = ${JSON.stringify(ACTIVE_CONTENT_PACKAGE.contentVersion)};
export const EMBEDDED_SOURCE_DIGEST = ${JSON.stringify(sourceDigest)};
export const EMBEDDED_QUESTIONS: readonly Question[] = ${safeJson(questions)};
export const EMBEDDED_RECENT_QUESTION_IDS: readonly string[] = ${safeJson(recentQuestions.map((question) => question.id))};
export const EMBEDDED_EXAM_PAPERS: readonly ExamPaper[] = ${safeJson(papers)};
`;

await mkdir(generatedDirectory, { recursive: true });
await writeFile(outputPath, generated, "utf8");
await writeFile(
  metadataPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      contentPackageId: ACTIVE_CONTENT_PACKAGE.id,
      contentVersion: ACTIVE_CONTENT_PACKAGE.contentVersion,
      sourceDigest,
      sourceFileCount: files.length,
      questionCounts,
      recentQuestionCount: recentQuestions.length,
      papers: papers.map(({ id, counts, items, totalScore, declaredTotalScore, sourceSha256 }) => ({
        id, counts, questionCount: items.length, totalScore, declaredTotalScore, sourceSha256,
      })),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`CONTENT_PACK: PASS · ${questions.length} 题 · ${sourceDigest.slice(0, 12)}`);
console.log(`已生成：${outputPath}`);
console.log(`题包清单：${metadataPath}`);

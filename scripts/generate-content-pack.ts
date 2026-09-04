import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { ACTIVE_CONTENT_PACKAGE } from "../src/content/content-package";
import { parseQuestionFile } from "../src/data/question-parser";
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

async function loadSourceFiles(): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for (const directory of Object.values(ACTIVE_CONTENT_PACKAGE.questionTypeDirectories)) {
    const absoluteDirectory = join(sourceRoot, directory);
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
  if (files.length !== ACTIVE_CONTENT_PACKAGE.sourceFileCount) {
    throw new Error(`题源文件应为 ${ACTIVE_CONTENT_PACKAGE.sourceFileCount} 个，实际为 ${files.length} 个`);
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

const files = await loadSourceFiles();
const questions: Question[] = [];
const issues: string[] = [];
for (const file of files) {
  const parsed = parseQuestionFile(file.path, file.content);
  questions.push(...parsed.questions);
  issues.push(...parsed.issues.map((entry) => `${entry.sourceFile}#${entry.sourceOrdinal}: ${entry.message}`));
}

if (issues.length) {
  throw new Error(`题库存在 ${issues.length} 个解析问题：\n${issues.slice(0, 20).join("\n")}`);
}
assertPack(files, questions);

const digest = createHash("sha256");
for (const file of files) digest.update(file.path).update("\0").update(file.content).update("\0");
const sourceDigest = digest.digest("hex");
const questionCounts = countQuestions(questions);
const generated = `/* 此文件由 npm run content:generate 生成，请勿手工编辑。 */
import type { Question } from "../domain/question";

export const EMBEDDED_CONTENT_VERSION = ${JSON.stringify(ACTIVE_CONTENT_PACKAGE.contentVersion)};
export const EMBEDDED_SOURCE_DIGEST = ${JSON.stringify(sourceDigest)};
export const EMBEDDED_QUESTIONS: readonly Question[] = ${safeJson(questions)};
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
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`CONTENT_PACK: PASS · ${questions.length} 题 · ${sourceDigest.slice(0, 12)}`);
console.log(`已生成：${outputPath}`);
console.log(`题包清单：${metadataPath}`);

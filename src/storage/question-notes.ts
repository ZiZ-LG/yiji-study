import { contentDigest, validateQuestion } from "../library";
import type { LibraryQuestion, QuestionInput, QuestionRevision } from "../library";

const TYPES = { single: "单选", multiple: "多选", judge: "判断" } as const;

export function renderQuestionNote(revision: QuestionRevision): string {
  return `# ${revision.stem}\n\n${revision.options.map((option) => `${option.key}. ${option.text}`).join("\n\n")}\n\n`
    + `> 参考答案：${revision.answers.join("、")}\n\n题型：${TYPES[revision.type]}\n\n知识点：${revision.domain}\n\n${revision.explanation ?? ""}\n\n`
    + `<!-- 修改上方正文后，重新读取易记会把改动送入待核对区。下方身份记录请保留。 -->\n\n\`\`\`yiji-question\n${JSON.stringify(revision, null, 2)}\n\`\`\`\n`;
}

export interface NoteInspection {
  unchanged: boolean;
  input: QuestionInput;
  issues: string[];
  targetQuestionId: string;
}

/** Reads only our explicit note format. Unrecognized edits become blocked drafts. */
export function inspectQuestionNote(content: string, question: LibraryQuestion): NoteInspection {
  const issues: string[] = [];
  const active = question.revisions[question.activeRevisionId]!;
  const block = content.match(/```yiji-question\s*\n([\s\S]*?)\n```/);
  let original = active;
  if (block) {
    try {
      const metadata = JSON.parse(block[1]!) as Partial<QuestionRevision>;
      const known = metadata.id ? question.revisions[metadata.id] : undefined;
      if (!known || metadata.questionId !== question.id || contentDigest(metadata) !== contentDigest(known)) issues.push("题目身份记录被修改或不完整，请保留原身份并在管理页核对正文");
      else original = known;
    } catch { issues.push("题目身份记录不是有效 JSON"); }
  } else issues.push("缺少题目身份记录，不能自动建立修订");
  if (!issues.length && content === renderQuestionNote(original)) return { unchanged: true, input: original, issues, targetQuestionId: question.id };
  const body = content.split("<!--")[0] ?? content;
  const answer = body.match(/^>\s*参考答案：(.+)$/m);
  const domain = body.match(/^知识点：(.+)$/m);
  const typeText = body.match(/^题型：(.+)$/m)?.[1]?.trim();
  const type = (Object.entries(TYPES).find(([, label]) => label === typeText)?.[0] ?? original.type) as QuestionInput["type"];
  const answerIndex = answer?.index ?? body.length;
  const contentBeforeAnswer = body.slice(0, answerIndex);
  const firstOption = /^([^\s.]+)\.\s+/m.exec(contentBeforeAnswer);
  const stem = contentBeforeAnswer.slice(0, firstOption?.index ?? contentBeforeAnswer.length).replace(/^#\s*/, "").trim();
  const optionText = firstOption ? contentBeforeAnswer.slice(firstOption.index) : "";
  const options = [...optionText.matchAll(/^([^\s.]+)\.\s+([\s\S]*?)(?=^[^\s.]+\.\s+|(?![\s\S]))/gm)]
    .map((match) => ({ key: match[1]!, text: match[2]!.trim() }));
  const explanation = domain ? body.slice((domain.index ?? 0) + domain[0].length).trim() : original.explanation;
  const input: QuestionInput = { type, stem, options, answers: answer?.[1]?.trim().split(/[、,，\s]+/).filter(Boolean) ?? [],
    domain: domain?.[1]?.trim() ?? "", tags: original.tags, sources: original.sources, explanation,
    explanationOrigin: "user", answerOrigin: "user", notePath: original.notePath,
    attachmentIds: original.attachmentIds, ruleVersion: original.ruleVersion, sourceNote: original.sourceNote };
  if (!firstOption) issues.push("未识别选项，请保留“编号. 内容”格式");
  if (typeText && !Object.values(TYPES).some((label) => label === typeText)) issues.push("题型应填写单选、多选或判断");
  issues.push(...validateQuestion(input));
  return { unchanged: false, input, issues: [...new Set(issues)], targetQuestionId: question.id };
}

import { execFileSync } from "node:child_process";
import type { QuestionIdentityInput, QuestionType } from "../src/domain/question";

/** Read only question content. Candidate identity, score and personal answers are never exported. */
export function readPdfQuestions(path: string) {
  const text = execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" })
    .replace(/\f/g, "\n");
  const starts = [...text.matchAll(/^\s*(\d+)、/gm)];
  const questions = starts.map((start, index) => {
    const before = text.slice(0, start.index);
    const section = [...before.matchAll(/^(单选题|多选题|判断题)\s*$/gm)].at(-1)?.[1];
    const type: QuestionType = section === "单选题" ? "single" : section === "多选题" ? "multiple" : "judge";
    const block = text.slice(start.index! + start[0].length, starts[index + 1]?.index ?? text.length);
    const score = block.match(/[（(]\s*本\s*题\s*分\s*值\s*([\d.]+)\s*分\s*[）)]/);
    const ordinal = Number(start[1]);
    if (!section || !score) throw new Error(`${path}#${ordinal}: missing section/score`);
    const stem = block.slice(0, score.index).replace(/\s+/g, " ").trim();
    const optionText = block.slice(score.index! + score[0].length).split("答题结果：")[0]!;
    const options = [...optionText.matchAll(/^\s*([A-H])：([\s\S]*?)(?=^\s*[A-H]：|$(?![\s\S]))/gm)]
      .map((m) => ({ key: m[1]!, text: m[2]!.replace(/\s+/g, " ").trim() }));
    const answer = block.match(/正确答案：\s*([A-H](?:\s*[,，]\s*[A-H])*)/)?.[1];
    if (!answer || options.length < 2) throw new Error(`${path}#${ordinal}: missing options/answer`);
    let answers = answer.match(/[A-H]/g)!;
    if (type === "judge") {
      answers = answers.map((key) => options.find((o) => o.key === key)?.text === "正确" ? "对" : "错");
      if (options.length !== 2 || options[0]?.text !== "正确" || options[1]?.text !== "错误") {
        throw new Error(`${path}#${ordinal}: unrecognized judge labels`);
      }
    }
    const identity: QuestionIdentityInput = {
      type, stem, answers,
      options: type === "judge" ? [{ key: "对", text: "正确" }, { key: "错", text: "错误" }] : options,
    };
    return { ordinal, points: Number(score[1]), ...identity };
  });
  const declaredTotalScore = Number(text.match(/试卷总分：\s*([\d.]+)/)?.[1]);
  if (questions.length !== 170 || questions.some((q, index) => q.ordinal !== index + 1) || !declaredTotalScore) {
    throw new Error(`${path}: incomplete paper`);
  }
  return { questions, declaredTotalScore };
}

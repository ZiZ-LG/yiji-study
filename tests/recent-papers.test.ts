import { describe, expect, it } from "vitest";
import { EMBEDDED_EXAM_PAPERS, EMBEDDED_QUESTIONS, EMBEDDED_RECENT_QUESTION_IDS } from "../src/generated/electricity-trader-pack";
import { buildQuestionBankFromQuestions } from "../src/data/question-bank";
import { createQuestionId, parseQuestionFile } from "../src/data/question-parser";
import { mergeQuestions } from "../src/data/merge-questions";
import { createEmptyStudyData, parseStudyData, recordAnswer, saveCursor, toggleBookmark } from "../src/state/study-state";
import { isCorrectSelection, parseExamAttempts, saveExam, startExam, submitExam } from "../src/state/exam-state";

const bank = buildQuestionBankFromQuestions(EMBEDDED_QUESTIONS);
const paper = EMBEDDED_EXAM_PAPERS[0]!;
const now = Date.parse("2026-09-13T10:00:00Z");

describe("four complete recent papers", () => {
  it("covers all 680 original ordinals and all 605 recent questions", () => {
    expect(EMBEDDED_EXAM_PAPERS).toHaveLength(4);
    const ids = new Set<string>();
    for (const exam of EMBEDDED_EXAM_PAPERS) {
      expect(exam.items.map((item) => item.ordinal)).toEqual(Array.from({ length: 170 }, (_, i) => i + 1));
      const counts = { single: 0, multiple: 0, judge: 0 };
      for (const item of exam.items) {
        const question = bank.byId.get(item.questionId)!;
        expect(question).toBeDefined();
        expect(question.id).toBe(createQuestionId(question));
        expect(question.sources).toContain(`${exam.id.replace("real-2026-", "")}#${item.ordinal}`);
        expect(question.answers.every((key) => question.options.some((o) => o.key === key))).toBe(true);
        counts[question.type] += 1;
        ids.add(item.questionId);
      }
      expect(counts).toEqual(exam.counts);
      expect(exam.items.reduce((sum, item) => sum + item.points, 0)).toBe(exam.totalScore);
    }
    expect(ids.size).toBe(605);
    expect(ids).toEqual(new Set(EMBEDDED_RECENT_QUESTION_IDS));
    expect(bank.issues).toEqual([]);
  });

  it("keeps July paper's actual 100/20/50 structure and documents 95 vs 100", () => {
    const july = EMBEDDED_EXAM_PAPERS[3]!;
    expect(july.counts).toEqual({ single: 100, multiple: 20, judge: 50 });
    expect(july.totalScore).toBe(95);
    expect(july.declaredTotalScore).toBe(100);
    expect(july.ruleNote).toContain("不折算为百分制");
    for (const june of EMBEDDED_EXAM_PAPERS.slice(0, 3)) expect(june.totalScore).toBe(100);
  });

  it("restores option F and answer F; exposes damaged source glyphs without NUL", () => {
    const june = EMBEDDED_EXAM_PAPERS[2]!;
    const corrected = bank.byId.get(june.items[121]!.questionId)!;
    expect(corrected.options.map((o) => o.key)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(corrected.answers).toEqual(["A", "B", "E", "F"]);
    expect(EMBEDDED_EXAM_PAPERS[3]!.items[112]!.questionId).toBe(corrected.id);
    const damaged = bank.byId.get(june.items[38]!.questionId)!;
    expect(damaged.sourceNote).toContain("缺字");
    expect(damaged.options.every((o) => o.text.includes("□"))).toBe(true);
    for (const id of EMBEDDED_RECENT_QUESTION_IDS) expect(JSON.stringify(bank.byId.get(id))).not.toContain("\\u0000");
  });

  it("parses both recent and historical provenance formats", () => {
    for (const repeat of ["跨卷 ×2", "跨卷重复 ×2"]) {
      const parsed = parseQuestionFile("01-单选题专项/测试.md", "> [!question]+ Q1. 测试\n> A. 甲\n> B. 乙\n>> [!success]- 答案\n>> **A**\n>> 归属：经济学基础　来源：`6-26-A#1、6-30#2`　" + repeat);
      expect(parsed.issues).toEqual([]);
      expect(parsed.questions[0]?.sources).toEqual(["6-26-A#1", "6-30#2"]);
      expect(parsed.questions[0]?.repeatCount).toBe(2);
    }
  });

  it("merges exact identities without mutating originals or losing progress", () => {
    const original = EMBEDDED_QUESTIONS[0]!;
    const before = JSON.stringify(original);
    const merged = mergeQuestions([original], [{ ...original, domain: "未归类", sources: ["test#1"] }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(original.id);
    expect(merged[0]?.domain).toBe(original.domain);
    expect(merged[0]?.sources).toContain("test#1");
    expect(JSON.stringify(original)).toBe(before);
    let data = recordAnswer(createEmptyStudyData(), original.id, false, new Date(now).toISOString()).data;
    data = toggleBookmark(saveCursor(data, "type:single", original.id), original.id);
    expect(parseStudyData(data)).toEqual(data);
    expect(bank.domains.some((d) => d.name === "未归类" && d.count > 0)).toBe(true);
  });
});

describe("persistent exam sessions", () => {
  it("persists answers and position and doesn't reveal or record results before submission", () => {
    const attempt = { ...startExam(paper, now), index: 100, answers: { "1": ["A"], "101": ["B", "D"] } };
    const data = saveExam(createEmptyStudyData(), attempt);
    expect(parseStudyData(JSON.parse(JSON.stringify(data)))).toEqual(data);
    expect(data.history).toEqual([]);
    expect(attempt.deadlineAt - now).toBe(120 * 60_000);
  });

  it.each(EMBEDDED_EXAM_PAPERS.map((p) => [p.id, p] as const))("grades every original answer: %s", (_, exam) => {
    const answers = Object.fromEntries(exam.items.map((item) => [String(item.ordinal), bank.byId.get(item.questionId)!.answers]));
    const data = saveExam(createEmptyStudyData(), { ...startExam(exam, now), answers });
    const result = submitExam(data, exam, bank.byId, now + 1000);
    expect(result.exams?.[exam.id]?.score).toBe(exam.totalScore);
    expect(result.exams?.[exam.id]?.correctCount).toBe(170);
    expect(result.exams?.[exam.id]?.answeredCount).toBe(170);
    expect(result.history).toHaveLength(170);
    expect(submitExam(result, exam, bank.byId, now + 2000)).toBe(result);
    expect(parseStudyData(result)).toEqual(result);
  });

  it("requires an exact multiple selection; excludes unanswered questions from wrongbook", () => {
    const item = paper.items[100]!;
    const question = bank.byId.get(item.questionId)!;
    expect(isCorrectSelection(question, question.answers.slice(1))).toBe(false);
    expect(isCorrectSelection(question, [...question.answers, question.answers[0]!])).toBe(false);
    let data = saveExam(createEmptyStudyData(), { ...startExam(paper, now), answers: { "101": ["invalid"] } });
    data = submitExam(data, paper, bank.byId, now + 1000);
    expect(data.exams?.[paper.id]?.score).toBe(0);
    expect(data.questions[item.questionId]?.isWrong).toBe(true);
    expect(Object.keys(data.questions)).toEqual([item.questionId]);
    data = saveExam(data, { ...startExam(paper, now + 2000), answers: { "101": [...question.answers] } });
    data = submitExam(data, paper, bank.byId, now + 3000);
    expect(data.questions[item.questionId]?.isWrong).toBe(false);
  });

  it("rejects corrupt attempts and incompatible or incomplete papers", () => {
    expect(parseExamAttempts({ bad: { paperId: "bad", index: -1 } })).toEqual({});
    const data = saveExam(createEmptyStudyData(), startExam(paper, now));
    expect(() => submitExam(data, { ...paper, sourceSha256: "changed" }, bank.byId, now)).toThrow();
    expect(() => submitExam(data, paper, new Map(), now)).toThrow();
    expect(data.history).toEqual([]);
    expect(parseExamAttempts({ [paper.id]: { ...startExam(paper, now), submittedAt: now } })).toEqual({});
  });
});

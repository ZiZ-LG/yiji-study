import { describe, expect, it } from "vitest";
import {
  ACTIVE_CONTENT_PACKAGE,
  getExamQuestionCount,
  getExamRuleText,
  getKnowledgeNotePath,
} from "../src/content/content-package";

describe("active content package", () => {
  it("把电力考试元数据与易记外壳分离", () => {
    expect(ACTIVE_CONTENT_PACKAGE.id).toBe("electricity-trader-level-4");
    expect(ACTIVE_CONTENT_PACKAGE.domains).toHaveLength(22);
    expect(ACTIVE_CONTENT_PACKAGE.sourceFileCount).toBe(20);
    expect(ACTIVE_CONTENT_PACKAGE.expectedQuestionCounts).toEqual({
      single: 704,
      multiple: 351,
      judge: 378,
      total: 1433,
    });
    expect(ACTIVE_CONTENT_PACKAGE.exam.papers).toHaveLength(7);
    expect(ACTIVE_CONTENT_PACKAGE.exam.papers.filter((paper) => paper.badge === "原卷")).toHaveLength(2);
    expect(ACTIVE_CONTENT_PACKAGE.exam.papers.filter((paper) => paper.badge === "模拟")).toHaveLength(5);
  });

  it("固定真实考试题型、题量、时长与分值", () => {
    expect(getExamQuestionCount(ACTIVE_CONTENT_PACKAGE)).toBe(170);
    expect(ACTIVE_CONTENT_PACKAGE.exam.sections).toEqual([
      { type: "single", label: "单选", questionCount: 100, pointsPerQuestion: 0.5 },
      { type: "multiple", label: "多选", questionCount: 30, pointsPerQuestion: 1 },
      { type: "judge", label: "判断", questionCount: 40, pointsPerQuestion: 0.5 },
    ]);
    expect(getExamRuleText(ACTIVE_CONTENT_PACKAGE)).toBe(
      "每套固定为 100 道单选、30 道多选、40 道判断，共 170 题、120 分钟、100 分。",
    );
  });

  it("由内容包生成知识笔记路径", () => {
    expect(getKnowledgeNotePath(ACTIVE_CONTENT_PACKAGE, "电力现货市场")).toBe(
      "Study_Vault/电力交易员StudyVault/07-电力现货市场/电力现货市场.md",
    );
    expect(getKnowledgeNotePath(ACTIVE_CONTENT_PACKAGE, "不存在的知识域")).toBeNull();
  });
});

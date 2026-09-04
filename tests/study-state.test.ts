import { describe, expect, it } from "vitest";
import {
  createEmptyStudyData,
  getStudySummary,
  parseStudyData,
  recordAnswer,
  saveCursor,
  toggleBookmark,
} from "../src/state/study-state";

describe("study state", () => {
  it("答错加入、答对移出，同时保留累计历史", () => {
    const data = createEmptyStudyData();
    const first = recordAnswer(data, "q_1", false, "2026-09-03T00:00:00.000Z");

    expect(first.wrongAction).toBe("added");
    expect(first.data.questions.q_1).toMatchObject({
      attempts: 1,
      correctCount: 0,
      wrongCount: 1,
      isWrong: true,
    });

    const second = recordAnswer(
      first.data,
      "q_1",
      true,
      "2026-09-03T00:01:00.000Z",
    );

    expect(second.wrongAction).toBe("removed");
    expect(second.data.questions.q_1).toMatchObject({
      attempts: 2,
      correctCount: 1,
      wrongCount: 1,
      isWrong: false,
      lastCorrect: true,
    });
    expect(second.data.history).toHaveLength(2);
  });

  it("重复答错不会创建重复错题", () => {
    const first = recordAnswer(
      createEmptyStudyData(),
      "q_1",
      false,
      "2026-09-03T00:00:00.000Z",
    );
    const second = recordAnswer(
      first.data,
      "q_1",
      false,
      "2026-09-03T00:01:00.000Z",
    );

    expect(second.wrongAction).toBe("kept");
    expect(second.data.questions.q_1?.wrongCount).toBe(2);
    expect(getStudySummary(second.data).wrongCount).toBe(1);
  });

  it("收藏和断点不改变原对象", () => {
    const original = createEmptyStudyData();
    const bookmarked = toggleBookmark(original, "q_2");
    const withCursor = saveCursor(
      bookmarked,
      "domain:电力现货市场",
      "q_2",
      "2026-09-03T00:02:00.000Z",
    );

    expect(original.questions.q_2).toBeUndefined();
    expect(bookmarked.questions.q_2?.bookmarked).toBe(true);
    expect(withCursor.cursors["domain:电力现货市场"]).toEqual({
      questionId: "q_2",
      updatedAt: "2026-09-03T00:02:00.000Z",
    });
  });

  it("从未知数据安全恢复版本 1 状态", () => {
    expect(parseStudyData(null)).toEqual(createEmptyStudyData());

    const parsed = parseStudyData({
      version: 1,
      questions: {
        q_1: {
          attempts: 2,
          correctCount: 1,
          wrongCount: 1,
          isWrong: false,
          bookmarked: true,
          lastCorrect: true,
          lastAnsweredAt: "2026-09-03T00:01:00.000Z",
        },
      },
      cursors: {},
      history: [],
    });

    expect(parsed.questions.q_1?.bookmarked).toBe(true);
    expect(getStudySummary(parsed)).toEqual({
      answeredCount: 1,
      attemptCount: 2,
      correctCount: 1,
      wrongCount: 0,
      bookmarkedCount: 1,
      accuracy: 50,
    });
  });
});

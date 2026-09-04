import { describe, expect, it } from "vitest";
import { ACTIVE_CONTENT_PACKAGE } from "../src/content/content-package";
import {
  EMBEDDED_CONTENT_VERSION,
  EMBEDDED_QUESTIONS,
  EMBEDDED_SOURCE_DIGEST,
} from "../src/generated/electricity-trader-pack";

describe("embedded electricity trader content", () => {
  it("冻结当前内容版本和可追溯摘要", () => {
    expect(EMBEDDED_CONTENT_VERSION).toBe(ACTIVE_CONTENT_PACKAGE.contentVersion);
    expect(EMBEDDED_SOURCE_DIGEST).toMatch(/^[a-f0-9]{64}$/);
  });

  it("包含 1085 道可判题题目且稳定 ID 唯一", () => {
    const counts = EMBEDDED_QUESTIONS.reduce(
      (result, question) => {
        result[question.type] += 1;
        return result;
      },
      { single: 0, multiple: 0, judge: 0 },
    );

    expect(counts).toEqual({ single: 503, multiple: 277, judge: 305 });
    expect(EMBEDDED_QUESTIONS).toHaveLength(1085);
    expect(new Set(EMBEDDED_QUESTIONS.map((question) => question.id)).size).toBe(1085);
    expect(
      EMBEDDED_QUESTIONS.every(
        (question) =>
          question.stem.length > 0 &&
          question.domain.length > 0 &&
          question.options.length >= 2 &&
          question.answers.length >= 1,
      ),
    ).toBe(true);
  });
});

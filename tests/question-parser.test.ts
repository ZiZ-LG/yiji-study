import { describe, expect, it } from "vitest";
import { createQuestionId, parseQuestionFile } from "../src/data/question-parser";

describe("parseQuestionFile", () => {
  it("解析单选题、跨行题干和来源元数据", () => {
    const markdown = `
---
title: 单选题专项-测验-第1卷
tags:
  - 题型/单选题
---

> [!question]+ Q1. 中长期交易结果汇总的原则
> 不包括（） 。
>
> A. 准确性原则
> B. 完整性原则
> C. 一致性原则
> D. 灵活性原则
>
>> [!success]- 答案
>> **D**
>>
>> D. 灵活性原则
>>
>> 归属：中长期交易　来源：\`bank#125、bank#148、四级-第2套#76\`　跨卷重复 ×3
`;

    const result = parseQuestionFile(
      "Study_Vault/电力交易员StudyVault-题型版/01-单选题专项/单选题专项-测验-第1卷.md",
      markdown,
    );

    expect(result.issues).toEqual([]);
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]).toMatchObject({
      type: "single",
      stem: "中长期交易结果汇总的原则 不包括（） 。",
      answers: ["D"],
      domain: "中长期交易",
      sources: ["bank#125", "bank#148", "四级-第2套#76"],
      repeatCount: 3,
      sourceOrdinal: 1,
    });
    expect(result.questions[0]?.options).toEqual([
      { key: "A", text: "准确性原则" },
      { key: "B", text: "完整性原则" },
      { key: "C", text: "一致性原则" },
      { key: "D", text: "灵活性原则" },
    ]);
  });

  it("解析多选题并保持答案顺序", () => {
    const markdown = `
> [!question]+ Q7. 市场运营机构应当披露的公开信息包括（） 。
>
> A. 公告类信息
> B. 交易结果总体情况
> C. 交易计划及其实际执行情况
> D. 市场主体申报总体信息
> E. 运营机构联系方式
>
>> [!success]- 答案
>> **A、B、C、D**
>>
>> 归属：信息披露与交易平台操作　来源：\`bank#375、四级-第1套#38\`　跨卷重复 ×2
`;

    const result = parseQuestionFile("02-多选题专项/多选题专项-测验-第1卷.md", markdown);

    expect(result.issues).toEqual([]);
    expect(result.questions[0]).toMatchObject({
      type: "multiple",
      answers: ["A", "B", "C", "D"],
      domain: "信息披露与交易平台操作",
    });
  });

  it("解析判断题", () => {
    const markdown = `
> [!question]+ Q2. 一般而言，批发用户报量报价参与现货市场时，其申报不需作为日前市场出清的依据。
>
> 对　／　错 ？
>
>> [!success]- 答案
>> **错**
>>
>> 归属：电力现货市场　来源：\`bank#761、四级-第1套#30\`　跨卷重复 ×2
`;

    const result = parseQuestionFile("03-判断题专项/判断题专项-测验-第1卷.md", markdown);

    expect(result.issues).toEqual([]);
    expect(result.questions[0]).toMatchObject({
      type: "judge",
      answers: ["错"],
      options: [
        { key: "对", text: "正确" },
        { key: "错", text: "错误" },
      ],
    });
  });

  it("稳定 ID 忽略排版空白但区分题型", () => {
    const base = {
      type: "single" as const,
      stem: "电力 市场（ ）",
      options: [
        { key: "A", text: "选项一" },
        { key: "B", text: "选项二" },
      ],
      answers: ["A"],
    };

    expect(createQuestionId(base)).toBe(
      createQuestionId({ ...base, stem: " 电力\n市场（ ） " }),
    );
    expect(createQuestionId(base)).not.toBe(
      createQuestionId({ ...base, type: "multiple" }),
    );
  });

  it("缺少答案时保留问题报告而不生成不可判题题目", () => {
    const markdown = `
> [!question]+ Q1. 没有答案的题目。
>
> A. 一
> B. 二
`;

    const result = parseQuestionFile("01-单选题专项/异常.md", markdown);

    expect(result.questions).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "missing-answer", sourceOrdinal: 1 }),
    );
  });
});

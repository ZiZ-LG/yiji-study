import { describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { extractDocument, extractDocxParts, pdfPageText } from "../src/import/extract";
import { candidateFromObject, extractAnswerEntries, matchAnswers, parseCsvQuestions, parseCsvRows, parseDocumentCandidates, parseStructuredQuestions, validateCandidate } from "../src/import/parse";
import { buildChatRequest, buildCodexTask, normalizeAiEndpoint, parseChatResponse, parseCodexResult, runAiImport } from "../src/import/ai";
import { createImportBatch, interruptImportBatch, mergeImportResult, pendingImportUnits } from "../src/import/batch";
import type { PdfLibrary, SourceDocument } from "../src/import/types";

async function source(content: string, name = "自制题卷.txt", role: SourceDocument["role"] = "questions"): Promise<SourceDocument> {
  return extractDocument({ name, bytes: strToU8(content), role, paperTitle: "自制测试卷" });
}

const plain = `一、单选题\n1. 下列哪项为偶数？\nA. 3\nB. 4\n答案：B\n知识点：整数\n解析：4 可以被 2 整除。\n二、多选题\n1. 下列哪些为偶数？\nA. 2\nB. 3\nC. 4\n答案：AC\n三、判断题\n1. 2 是偶数。\n答案：对`;

describe("import parser and provenance", () => {
  it("cancels a timed-out PDF preview, releases its canvas and reports the failed page", async () => {
    let cancelled = false; let destroyed = false; let intent = ""; const stages: string[] = [];
    const canvas = { width: 0, height: 0, getContext: () => ({}) } as unknown as HTMLCanvasElement;
    const pdf: PdfLibrary = { getDocument: () => ({ promise: Promise.resolve({ numPages: 1, destroy: async () => { destroyed = true; },
      getPage: async () => ({ getTextContent: async () => ({ items: [] }), getViewport: () => ({ width: 100, height: 100 }),
        render: (options) => { intent = options.intent ?? ""; return { promise: new Promise<void>(() => {}), cancel: () => { cancelled = true; } }; } }) }) }) };
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    try {
      await expect(extractDocument({ name: "timeout.pdf", bytes: new Uint8Array([37, 80, 68, 70]) }, {
        pdf, createCanvas: () => canvas, renderTimeoutMs: 5, onStage: (status) => { stages.push(status.phase); },
      })).rejects.toThrow("第 1 页预览等待超时");
    } finally { vi.unstubAllGlobals(); }
    expect(intent).toBe("print"); expect(cancelled).toBe(true); expect(destroyed).toBe(true);
    expect([canvas.width, canvas.height]).toEqual([0, 0]); expect(stages).toEqual(["load", "text", "render", "release"]);
  });

  it("reconstructs PDF glyph lines without Chinese gaps while retaining English word boundaries and raw text", async () => {
    const item = (str: string, x: number, y: number, width: number, hasEOL = false) => ({ str, transform: [12, 0, 0, 12, x, y], width, hasEOL });
    const extracted = pdfPageText([item("## 单 ", 0, 100, 36), item("选 题", 36, 100, 36, true),
      item("1. ⼀⼩时有多少分钟？", 0, 80, 120, true), item("A. 30", 0, 60, 40, true), item("B. 60", 0, 40, 40, true),
      item("答案：B", 0, 20, 40, true), item("English", 0, 0, 40), item("words", 45, 0, 35)]);
    expect(extracted.text).toContain("## 单选题\n1. 一小时有多少分钟?");
    expect(extracted.text).toContain("English words"); expect(extracted.rawText).toContain("⼀⼩");
    const parsed = parseDocumentCandidates(await source(extracted.text)); expect(parsed.candidates[0]!.type).toBe("single");
    const judge = parseDocumentCandidates(await source("## 判 断 题\n1. 此句正确。\n答案：对"));
    expect(judge.candidates[0]!.options.map((option) => option.key)).toEqual(["对", "错"]);
  });

  it("matches separated multiple answers without swallowing the next numbered answer", async () => {
    const answerSource = await source("4. A、C 5. A,B,C; 6. C/D\n7. 对\n8. 错\n9. B", "答案.md", "answers");
    const entries = extractAnswerEntries(answerSource);
    expect(entries.map((entry) => [entry.ordinal, entry.answers])).toEqual([["4", ["A", "C"]], ["5", ["A", "B", "C"]], ["6", ["C", "D"]], ["7", ["对"]], ["8", ["错"]], ["9", ["B"]]]);
    const imageQuestion = parseDocumentCandidates(await source("## 单选题\n1. 根据附图选择答案。\nA.甲\nB.乙\n答案：B"));
    expect(imageQuestion.candidates[0]!.issues.some((issue) => issue.code === "missing-source-image")).toBe(true);
  });
  it("reads three question types with repeated section ordinals without merging occurrences", async () => {
    const document = await source(plain);
    const result = parseDocumentCandidates(document);
    expect(result.candidates.map((item) => item.type)).toEqual(["single", "multiple", "judge"]);
    expect(result.candidates.map((item) => item.answers)).toEqual([["B"], ["A", "C"], ["对"]]);
    expect(new Set(result.candidates.map((item) => item.id)).size).toBe(3);
    expect(result.candidates[0]!.explanation).toBe("4 可以被 2 整除。");
    expect(result.candidates[0]!.explanationOrigin).toBe("source");
    expect(result.candidates.every((item) => item.sourceUnitIds[0] === document.units[0]!.id)).toBe(true);
    expect(result.candidates.every((item) => !item.issues.some((problem) => problem.blocking))).toBe(true);
  });

  it("retains unsupported and missing-answer candidates instead of silently dropping them", async () => {
    const document = await source("示例", "题库.json");
    const result = parseStructuredQuestions(JSON.stringify({ questions: [
      { type: "short", stem: "解释一个概念", options: [], answers: [] },
      { type: "single", stem: "选择答案", options: { A: "甲", B: "乙" }, answers: [] },
    ] }), document);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]!.issues.map((item) => item.code)).toContain("unsupported-type");
    expect(result.candidates[1]!.issues.map((item) => item.code)).toContain("missing-answer");
  });

  it("parses quoted CSV fields and rejects malformed row quoting", async () => {
    const document = await source("placeholder", "题目.csv");
    const result = parseCsvQuestions('ordinal,type,stem,A,B,answers,domain\r\n1,single,"含逗号,与\n换行的题干",选项甲,选项乙,A,章节\r\n', document);
    expect(result.candidates[0]!.stem).toBe("含逗号,与\n换行的题干");
    expect(result.candidates[0]!.sourceLocator).toBe("数据行 2");
    expect(() => parseCsvRows('a,b\n"未闭合,b')).toThrow("未闭合");
    expect(() => parseCsvRows('a,b\n"已闭合"错误,b')).toThrow("引号后");
  });

  it("matches an independent answer file by paper, question type and ordinal", async () => {
    const questions = parseDocumentCandidates(await source(plain.replace(/答案：[^\n]+\n?/g, ""))).candidates;
    const answerSource = await source("单选题\n1. B\n多选题\n1. AC\n判断题\n1. 对", "答案.txt", "answers");
    const entries = extractAnswerEntries(answerSource);
    expect(entries).toHaveLength(3);
    const matched = matchAnswers(questions, entries);
    expect(matched.map((item) => item.answers)).toEqual([["B"], ["A", "C"], ["对"]]);
    expect(matched.every((item) => item.answerSourceId === answerSource.id)).toBe(true);
    expect(matched.every((item) => !item.issues.some((problem) => problem.code === "missing-answer"))).toBe(true);
  });

  it("does not align ambiguous repeated ordinals or contradictory answers by row order", async () => {
    const document = await source(plain);
    const candidates = parseDocumentCandidates(document).candidates;
    const ambiguous = extractAnswerEntries(await source("1. B", "答案.txt", "answers"));
    expect(matchAnswers(candidates, ambiguous).every((item) => item.issues.some((problem) => problem.code === "ambiguous-answer"))).toBe(true);
    const contradictory = extractAnswerEntries(await source("单选题\n1. A", "答案.txt", "answers"));
    expect(matchAnswers(candidates, contradictory)[0]!.issues.map((problem) => problem.code)).toContain("answer-conflict");
    expect(matchAnswers(candidates, contradictory)[0]!.answers).toEqual(["B"]);
  });

  it("requires explicit adoption of AI answers and available question images", async () => {
    const document = await source("example");
    const candidate = candidateFromObject({ type: "single", stem: "题干", options: { A: "甲", B: "乙" }, answers: ["A"], answerOrigin: "ai", attachments: ["missing"] }, document, 0);
    expect(validateCandidate(candidate, new Set()).map((problem) => problem.code)).toEqual(expect.arrayContaining(["ai-answer", "missing-attachment"]));
  });

  it("rejects unsupported formats, oversized files and unreadable encodings before processing", async () => {
    await expect(extractDocument({ name: "旧文档.doc", bytes: strToU8("a") })).rejects.toThrow("暂不支持");
    await expect(extractDocument({ name: "大文档.txt", bytes: strToU8("12345") }, { maxFileBytes: 4 })).rejects.toThrow("文件过大");
    await expect(extractDocument({ name: "乱码.txt", bytes: new Uint8Array([0xff, 0xff, 0xfe]) })).rejects.toThrow("编码无法识别");
  });

  it("extracts only the required DOCX archive parts, never unrelated entries", () => {
    const zipped = zipSync({ "word/document.xml": strToU8("<doc/>"), "word/media/a.png": new Uint8Array([1]), "private.txt": strToU8("should not be read") });
    expect(Object.keys(extractDocxParts(zipped))).toEqual(["word/document.xml", "word/media/a.png"]);
    expect(() => extractDocxParts(zipSync({ "random.txt": strToU8("empty") }))).toThrow("缺少正文");
  });
});

describe("explicit AI scope and Codex exchange", () => {
  async function fixture() {
    const selected = await source(plain);
    const unselected = await source("私人笔记，不应发送", "未选笔记.txt");
    const scope = { unitIds: [selected.units[0]!.id] };
    const task = buildCodexTask([selected, unselected], scope);
    const payload = { format: "yiji-import", version: 1, taskId: task.taskId, questions: [{
      type: "single", ordinal: "1", stem: "下列哪项为偶数？", options: [{ key: "A", text: "3" }, { key: "B", text: "4" }], answers: ["B"],
      domain: "整数", sourceId: selected.id, sourceUnitIds: scope.unitIds, sourceLocator: selected.units[0]!.locator,
    }], unresolvedUnitIds: [] };
    return { selected, unselected, scope: task.scope, task, payload };
  }

  it("exports only selected content and round-trips task-bound results", async () => {
    const data = await fixture();
    expect(data.task.markdown).not.toContain("私人笔记");
    const parsed = parseCodexResult(JSON.stringify(data.payload), [data.selected, data.unselected], data.scope);
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]!.answers).toEqual(["B"]);
    expect(parsed.candidates[0]!.sourceUnitIds).toEqual(data.scope.unitIds);
    expect(() => parseCodexResult(JSON.stringify({ ...data.payload, taskId: "other" }), [data.selected], data.scope)).toThrow("任务编号");
    expect(() => buildCodexTask([data.selected], { unitIds: [] })).toThrow("选择");
  });

  it("derives explanation provenance from the verified original instead of trusting AI labels", async () => {
    const data = await fixture();
    const parse = (explanation: string, explanationOrigin: string) => parseCodexResult(JSON.stringify({ ...data.payload,
      questions: [{ ...data.payload.questions[0], explanation, explanationOrigin }] }), [data.selected], data.scope).candidates[0]!;
    expect(parse("4 可以被 2 整除。", "ai").explanationOrigin).toBe("source");
    expect(parse("可以记住：偶数的个位为 0、2、4、6、8。", "source").explanationOrigin).toBe("ai");
    expect(parse("用户已经核对过这段话。", "user").explanationOrigin).toBe("ai");
    expect(parse("", "source").explanationOrigin).toBeUndefined();
  });

  it("rejects sources outside scope and marks invented positions for review", async () => {
    const data = await fixture();
    const foreign = { ...data.payload, questions: [{ ...data.payload.questions[0], sourceId: data.unselected.id }] };
    expect(() => parseCodexResult(JSON.stringify(foreign), [data.selected, data.unselected], data.scope)).toThrow("未选定");
    const wrongPosition = { ...data.payload, questions: [{ ...data.payload.questions[0], sourceUnitIds: ["invented"] }] };
    const result = parseCodexResult(JSON.stringify(wrongPosition), [data.selected], data.scope);
    expect(result.candidates[0]!.issues.map((item) => item.code)).toContain("invalid-source-position");
  });

  it("blocks an otherwise valid answer when its question is attributed to another selected page or altered options", async () => {
    const document = await source("## 单选题\n1. 第一页问题？\nA.甲\nB.乙\n答案：A\f## 单选题\n2. 第二页问题？\nA.丙\nB.丁\n答案：B");
    const task = buildCodexTask([document], { unitIds: document.units.map((unit) => unit.id) });
    const question = { ordinal: "1", type: "single", stem: "第一页问题？", options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }], answers: ["A"],
      domain: "测试", sourceId: document.id, sourceUnitIds: [document.units[1]!.id], sourceLocator: document.units[1]!.locator, paperTitle: document.paperTitle };
    const parse = (value: object) => parseCodexResult(JSON.stringify({ format: "yiji-import", version: 1, taskId: task.taskId, questions: [value], unresolvedUnitIds: [] }), [document], task.scope).candidates[0]!;
    expect(parse(question).issues.some((issue) => issue.code === "unverified-question-source" && issue.blocking)).toBe(true);
    const correctPosition = { ...question, sourceUnitIds: [document.units[0]!.id], sourceLocator: document.units[0]!.locator };
    expect(parse(correctPosition).issues.filter((issue) => issue.blocking)).toEqual([]);
    expect(parse({ ...correctPosition, options: [{ key: "A", text: "被改写" }, { key: "B", text: "乙" }] }).issues.some((issue) => issue.code === "question-content-mismatch")).toBe(true);
    expect(parse({ ...correctPosition, sourceLocator: `${document.units[0]!.locator} · 第 99 题` }).issues.some((issue) => issue.code === "invalid-source-locator")).toBe(true);
  });

  it("verifies a separate answer file by its paper, role and actual entry location", async () => {
    const questionSource = await source("## 单选题\n1. 测试问题？\nA.甲\nB.乙");
    const answerSource = await source("1. B", "答案.txt", "answers");
    const otherAnswers = await source("1. B", "另一卷答案.txt", "answers"); otherAnswers.id += "_other"; otherAnswers.paperTitle = "另一卷";
    otherAnswers.units = otherAnswers.units.map((unit) => ({ ...unit, id: `${unit.id}_other` }));
    const sources = [questionSource, answerSource, otherAnswers];
    const task = buildCodexTask(sources, { unitIds: sources.flatMap((item) => item.units.map((unit) => unit.id)) });
    const question = { ordinal: "1", type: "single", stem: "测试问题？", options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }], answers: ["B"],
      domain: "测试", sourceId: questionSource.id, sourceUnitIds: [questionSource.units[0]!.id], sourceLocator: "全文", paperTitle: questionSource.paperTitle,
      answerSourceId: answerSource.id, answerSourceLocator: "全文" };
    const parse = (value: object) => parseCodexResult(JSON.stringify({ format: "yiji-import", version: 1, taskId: task.taskId, questions: [value], unresolvedUnitIds: [] }), sources, task.scope).candidates[0]!;
    expect(parse(question).issues.filter((issue) => issue.blocking)).toEqual([]);
    expect(parse({ ...question, answerSourceId: otherAnswers.id }).issues.some((issue) => issue.code === "answer-source-mismatch")).toBe(true);
    expect(parse({ ...question, answerSourceLocator: "不存在的位置" }).issues.some((issue) => issue.code === "answer-source-mismatch")).toBe(true);
  });

  it("builds a bounded request with a memory-only key and no unselected text", async () => {
    const data = await fixture();
    const request = buildChatRequest({ endpoint: "https://example.com/v1/", model: "test-model", supportsImages: false }, [data.selected, data.unselected], data.scope, "test-key-not-real");
    expect(request.url).toBe("https://example.com/v1/chat/completions");
    expect(request.headers.Authorization).toBe("Bearer test-key-not-real");
    expect(request.body).not.toContain("test-key-not-real");
    expect(request.body).not.toContain("私人笔记");
    expect(() => normalizeAiEndpoint("https://key@example.com/v1")).toThrow("HTTPS");
    expect(() => normalizeAiEndpoint("http://remote.example.com/v1")).toThrow("HTTPS");
    expect(normalizeAiEndpoint("http://localhost:1234/v1")).toBe("http://localhost:1234/v1/chat/completions");
  });

  it("refuses text-only AI for scans and never claims a truncated response succeeded", async () => {
    const document = await extractDocument({ name: "扫描.png", bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) });
    expect(() => buildChatRequest({ endpoint: "https://example.com/v1", model: "text", supportsImages: false }, [document], { unitIds: [document.units[0]!.id] }, "")).toThrow("图像");
    const data = await fixture();
    expect(() => parseChatResponse(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: JSON.stringify(data.payload) } }] }), [data.selected], data.scope)).toThrow("截断");
  });

  it("makes exactly one transport call and surfaces uncertain failed requests without replay", async () => {
    const data = await fixture();
    let calls = 0;
    const config = { endpoint: "https://example.com/v1", model: "test", supportsImages: false };
    await expect(runAiImport(config, [data.selected], data.scope, "", async () => { calls++; return { status: 429, text: "rate limit" }; })).rejects.toThrow("未自动重发");
    expect(calls).toBe(1);
    const result = await runAiImport(config, [data.selected], data.scope, "", async () => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: JSON.stringify(data.payload) }, finish_reason: "stop" }] }) }));
    expect(result.candidates).toHaveLength(1);
  });

  it("replaces retried page drafts and preserves interrupted batch progress", async () => {
    const data = await fixture();
    const batch = createImportBatch([data.selected], data.scope, "2026-11-04T00:00:00Z");
    const parsed = parseCodexResult(JSON.stringify(data.payload), [data.selected], data.scope);
    const once = mergeImportResult(batch, parsed, data.scope.unitIds);
    const again = mergeImportResult(once, parsed, data.scope.unitIds);
    expect(again.candidates).toHaveLength(1);
    expect(pendingImportUnits(again)).toEqual([]);
    const interrupted = interruptImportBatch(again, "用户切到后台");
    expect(interrupted.status).toBe("interrupted");
    expect(interrupted.candidates).toHaveLength(1);
    const unresolved = mergeImportResult(again, { ...parsed, unresolvedUnitIds: data.scope.unitIds }, data.scope.unitIds);
    expect(pendingImportUnits(unresolved)).toEqual(data.scope.unitIds);
  });
});

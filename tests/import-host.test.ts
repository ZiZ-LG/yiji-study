import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { App } from "obsidian";
import { LibraryController, defaultSettings } from "../src/host/library-controller";
import { ManagerController } from "../src/host/manager-controller";
import { contentDigest, createBank, createLibrary, getBank, getBankStudyData, getReviewQueue, recordAnswerEvent, restoreBackup, validateLibrary } from "../src/library";
import type { LibraryState } from "../src/library";
import type { ManagerAiScope } from "../src/ui/library-manager";
import { LibraryRepository } from "../src/storage/library-repository";

const http = vi.hoisted(() => vi.fn());
const pdfLoader = vi.hoisted(() => vi.fn());
const notices = vi.hoisted(() => [] as { messages: string[]; duration?: number; hidden: boolean }[]);
vi.mock("obsidian", () => ({ requestUrl: http, loadPdfJs: pdfLoader, TFile: class {},
  TFolder: class {}, Notice: class {
    record: { messages: string[]; duration?: number; hidden: boolean };
    constructor(message: string, duration?: number) { this.record = { messages: [message], duration, hidden: false }; notices.push(this.record); }
    setMessage(message: string) { this.record.messages.push(message); return this; }
    hide() { this.record.hidden = true; }
  }, requireApiVersion: () => false, normalizePath: (path: string) => path.replace(/\\/g, "/") }));

class MemoryFiles {
  data = new Map<string, Uint8Array>();
  exists(path: string) { return Promise.resolve(this.data.has(path)); }
  list(directory: string) { return Promise.resolve([...this.data.keys()].filter((path) => path.startsWith(`${directory}/`))); }
  async read(path: string) { return new TextDecoder().decode(await this.readBinary(path)); }
  write(path: string, text: string) { this.data.set(path, new TextEncoder().encode(text)); return Promise.resolve(); }
  readBinary(path: string): Promise<ArrayBuffer> { const value = this.data.get(path); if (!value) return Promise.reject(new Error(`Missing ${path}`)); return Promise.resolve(Uint8Array.from(value).buffer); }
  writeBinary(path: string, data: ArrayBuffer) { this.data.set(path, new Uint8Array(data.slice(0))); return Promise.resolve(); }
}
function setup() {
  const files = new MemoryFiles();
  const holder = {
    files, settings: defaultSettings(), deviceId: "device_test", state: createBank(createLibrary("device_test"), "常识", { id: "bank_test" }),
    getApiKey: () => "session-secret", setApiKey: vi.fn(), refresh: vi.fn(), app: {},
    async mutate(fn: (state: LibraryState) => LibraryState | Promise<LibraryState>) {
      const next = await fn(this.state); const result = validateLibrary(next); if (!result.valid) throw new Error(result.issues.join(";")); this.state = next;
    },
  };
  return { holder, files, manager: new ManagerController(holder as unknown as LibraryController) };
}
const SINGLE = "## 单选题\n1. 测试题？\nA. 甲\nB. 乙\n";
const upload = (name: string, text: string, role: "questions" | "answers" = "questions") => ({ name, role, paperTitle: "测试卷", mimeType: "text/plain", bytes: new TextEncoder().encode(text).buffer });
async function importOne(context: ReturnType<typeof setup>, text = SINGLE, answer?: string) {
  await context.manager.execute({ type: "preview-import", bankId: "bank_test", files: [upload("题卷.md", text)] });
  if (answer) await context.manager.execute({ type: "preview-import", bankId: "bank_test", files: [upload("答案.md", answer, "answers")] });
}
async function addImageQuestion(context: ReturnType<typeof setup>) {
  await importOne(context, `${SINGLE}答案：B`);
  await context.manager.execute({ type: "commit-normal-candidates", bankId: "bank_test", candidateIds: Object.keys(getBank(context.holder.state).candidates) });
  const imagePath = "易记题库/资料/bank_test/附件/自制图.png";
  const image = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1cAAAAASUVORK5CYII=", "base64"));
  await context.files.writeBinary(imagePath, image.buffer);
  await context.holder.mutate((state) => {
    const next = JSON.parse(JSON.stringify(state)) as LibraryState;
    getBank(next).attachments.test_image = { id: "test_image", path: imagePath, mimeType: "image/png" };
    return next;
  });
  const question = Object.values(getBank(context.holder.state).questions)[0]!;
  await context.manager.execute({ type: "save-question", options: { bankId: "bank_test", questionId: question.id, reason: "补齐自制题图" },
    expectedRevisionId: question.activeRevisionId, input: { ...question.revisions[question.activeRevisionId]!, attachmentIds: ["test_image"] } });
  return { imagePath, image, questionId: question.id };
}
async function scope(context: ReturnType<typeof setup>): Promise<ManagerAiScope> {
  const snapshot = await context.manager.getSnapshot();
  return { bankId: "bank_test", sourceIds: snapshot.importSources!.map((source) => source.id),
    unitIds: snapshot.importSources!.flatMap((source) => source.units!.map((unit) => unit.id)), pageFrom: 1, pageTo: 50, includeExplanations: false, confirmed: true };
}
async function exportedTask(context: ReturnType<typeof setup>) {
  const result = await context.manager.execute({ type: "export-codex", scope: await scope(context) });
  const task = JSON.parse(await context.files.read(result.path!.replace("任务.md", "task.json")));
  return { result, task };
}
function resultFor(task: { scope: { taskId: string } }, source: { id: string; units?: { id: string; locator: string }[] }, overrides = {}) {
  return JSON.stringify({ format: "yiji-import", version: 1, taskId: task.scope.taskId, questions: [{ ordinal: "1", type: "single", stem: "测试题？",
    options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }], answers: ["B"], answerOrigin: "source", domain: "常识", explanation: "",
    sourceId: source.id, sourceUnitIds: source.units!.map((unit) => unit.id), sourceLocator: "全文 · 第 1 题", paperTitle: "测试卷", attachments: [], issues: [], ...overrides }], unresolvedUnitIds: [] });
}
beforeEach(() => { http.mockReset(); pdfLoader.mockReset(); notices.length = 0; vi.stubGlobal("window", { setTimeout, clearTimeout }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("manager import integration with persistent fake vault files", () => {
  it("imports and accepts 200 questions with paused window timers while yielding posted tasks and closing both ports", async () => {
    const c = setup();
    const pausedTimer = vi.fn(() => 0);
    vi.stubGlobal("window", { setTimeout: pausedTimer, clearTimeout });
    const NativeMessageChannel = globalThis.MessageChannel;
    const channels: { posted: ReturnType<typeof vi.spyOn>; closeOne: ReturnType<typeof vi.spyOn>; closeTwo: ReturnType<typeof vi.spyOn> }[] = [];
    vi.stubGlobal("MessageChannel", class extends NativeMessageChannel {
      constructor() {
        super();
        channels.push({ posted: vi.spyOn(this.port2, "postMessage"), closeOne: vi.spyOn(this.port1, "close"), closeTwo: vi.spyOn(this.port2, "close") });
      }
    });
    const questions = Array.from({ length: 200 }, (_, index) => ({ ordinal: String(index + 1), type: "single", stem: `自制后台批处理第 ${index + 1} 题`,
      options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }], answers: ["B"], domain: "基础" }));
    await c.manager.execute({ type: "preview-import", bankId: "bank_test", files: [upload("后台批处理.json", JSON.stringify({ questions }))] });
    expect(Object.keys(getBank(c.holder.state).candidates)).toHaveLength(200);
    const importYields = channels.length;
    expect(importYields).toBeGreaterThanOrEqual(3);
    await c.manager.execute({ type: "commit-normal-candidates", bankId: "bank_test", candidateIds: Object.keys(getBank(c.holder.state).candidates) });
    expect(Object.keys(getBank(c.holder.state).questions)).toHaveLength(200);
    expect(channels.length - importYields).toBeGreaterThanOrEqual(4);
    for (const channel of channels) {
      expect(channel.posted).toHaveBeenCalledOnce();
      expect(channel.closeOne).toHaveBeenCalledOnce();
      expect(channel.closeTwo).toHaveBeenCalledOnce();
    }
    expect(pausedTimer).not.toHaveBeenCalled();
  });

  it("updates one progress notice for new and additional PDF pages and closes it on success or failure", async () => {
    const c = setup();
    vi.stubGlobal("createEl", () => ({ width: 0, height: 0, getContext: () => ({}), toDataURL: () => "data:image/jpeg;base64,/9j/" }));
    pdfLoader.mockResolvedValue({ getDocument: () => ({ promise: Promise.resolve({ numPages: 2,
      getPage: async (page: number) => ({ getTextContent: async () => ({ items: [{ str: `## 单选题\n${page}. 自制进度测试题${page}？\nA.甲\nB.乙\n答案：B`, hasEOL: true }] }),
        getViewport: () => ({ width: 100, height: 100 }), render: () => ({ promise: Promise.resolve() }), cleanup() {} }), destroy: async () => {} }) }) });
    const file = upload("分页进度.pdf", "synthetic-progress-pdf");
    for (const page of [1, 2]) {
      await c.manager.execute({ type: "preview-import", bankId: "bank_test", files: [{ ...file, pageFrom: page, pageTo: page }] });
      const current = notices.filter((notice) => notice.duration === 0).at(-1)!;
      expect(current.messages.some((message) => message.includes(`第 ${page} / 2 页`))).toBe(true);
      expect(current.messages).toContain("已读取 分页进度.pdf · 本批 1 / 1 页");
      expect(current.messages.some((message) => message.includes("正在生成原页预览"))).toBe(true);
      expect(current.hidden).toBe(true);
    }
    expect(notices.filter((notice) => notice.duration === 0)).toHaveLength(2);
    expect(notices.filter((notice) => notice.messages[0]?.includes("资料已保存在本地"))).toHaveLength(2);
    const saved = new Map(c.files.data);
    pdfLoader.mockRejectedValueOnce(new Error("读取器故障"));
    await expect(c.manager.execute({ type: "preview-import", bankId: "bank_test", files: [{ ...file, pageFrom: 1, pageTo: 1 }] })).rejects.toThrow("读取器故障");
    expect(notices.filter((notice) => notice.duration === 0).at(-1)?.hidden).toBe(true);
    expect(notices.at(-1)?.messages[0]).toBe("本地资料处理未完成：读取器故障");
    expect(c.files.data).toEqual(saved);
  });

  it("accumulates selected PDF page batches, clips the ending page and blocks stale exported task metadata", async () => {
    const c = setup();
    vi.stubGlobal("createEl", () => ({ width: 0, height: 0, getContext: () => ({}), toDataURL: () => "data:image/jpeg;base64,/9j/" }));
    let repeatedOrdinals = false;
    pdfLoader.mockResolvedValue({ getDocument: () => ({ promise: Promise.resolve({ numPages: 51,
      getPage: async (page: number) => ({ getTextContent: async () => ({ items: [{ str: `## 单选题\n${repeatedOrdinals ? 1 : page}. 本页自制第 ${page} 页测试题目？\nA.甲\nB.乙\n答案：B`, hasEOL: true }] }),
        getViewport: () => ({ width: 100, height: 100 }), render: () => ({ promise: Promise.resolve() }), cleanup() {} }), destroy: async () => {} }) }) });
    try {
      const file = { ...upload("大卷.pdf", "synthetic-pdf-bytes"), pageFrom: 1, pageTo: 50 };
      await c.manager.execute({ type: "preview-import", bankId: "bank_test", files: [file] });
      const first = (await c.manager.getSnapshot()).importSources![0]!; expect(first.units).toHaveLength(50);
      const { task } = await exportedTask(c);
      await c.manager.execute({ type: "preview-import", bankId: "bank_test", files: [{ ...file, pageFrom: 51, pageTo: 100 }] });
      expect((await c.manager.getSnapshot()).importSources![0]!.units).toHaveLength(51);
      expect(Object.keys(getBank(c.holder.state).candidates)).toHaveLength(51);
      await expect(c.manager.execute({ type: "import-codex", bankId: "bank_test", text: resultFor(task, first) })).rejects.toThrow("索引已改变");
      await expect(c.manager.execute({ type: "preview-import", bankId: "bank_test", files: [{ ...file, pageFrom: 52, pageTo: 100 }] })).rejects.toThrow("超出原卷");
      repeatedOrdinals = true; const sections = setup();
      await sections.manager.execute({ type: "preview-import", bankId: "bank_test", files: [{ ...file, pageTo: 2 }] });
      const separate = Object.values(getBank(sections.holder.state).candidates);
      expect(separate).toHaveLength(2); expect(new Set(separate.map((candidate) => candidate.input.sources![0]!.locator)).size).toBe(2);
      expect(separate.every((candidate) => candidate.issues.some((issue) => issue.includes("多个候选位置")))).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it("renames a knowledge category without resetting learning and resets review without an answer event", async () => {
    const c = setup(); await importOne(c, `${SINGLE}答案：B`);
    await c.manager.execute({ type: "commit-normal-candidates", bankId: "bank_test", candidateIds: Object.keys(getBank(c.holder.state).candidates) });
    const question = Object.values(getBank(c.holder.state).questions)[0]!; const learningKey = question.revisions[question.activeRevisionId]!.learningKey;
    await c.manager.execute({ type: "set-review", bankId: "bank_test", enabled: true });
    await c.holder.mutate((state) => recordAnswerEvent(state, question.id, true));
    const attempts = getBankStudyData(c.holder.state).questions[question.id]!.attempts;
    await c.manager.execute({ type: "rename-domain", bankId: "bank_test", from: "未归类", to: "常识" });
    const changed = getBank(c.holder.state).questions[question.id]!;
    expect(changed.revisions[changed.activeRevisionId]!.learningKey).toBe(learningKey);
    await c.manager.execute({ type: "reset-review", bankId: "bank_test", questionIds: [question.id] });
    expect(getBankStudyData(c.holder.state).questions[question.id]!.attempts).toBe(attempts);
    expect(Object.values(c.holder.state.events).filter((event) => event.kind === "review-reset")).toHaveLength(1);
    expect(getReviewQueue(c.holder.state, new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString())).toHaveLength(1);
  });
  it("updates a pending source when its separate answer arrives without duplicating or overwriting accepted edits", async () => {
    const c = setup(); await importOne(c);
    const first = Object.values(getBank(c.holder.state).candidates)[0]!;
    expect(first.issues.join()).toContain("答案");
    await c.manager.execute({ type: "preview-import", bankId: "bank_test", files: [upload("答案.md", "1. B", "answers")] });
    let entries = Object.values(getBank(c.holder.state).candidates);
    expect(entries).toHaveLength(1); expect(entries[0]!.id).toBe(first.id); expect(entries[0]!.input.answers).toEqual(["B"]);
    expect(entries[0]!.ancestorDigests?.length).toBeGreaterThan(0);
    await c.manager.execute({ type: "commit-candidate", bankId: "bank_test", candidateId: first.id,
      input: { ...entries[0]!.input, answers: ["A"] }, resolveConflict: true, reason: "用户校订" });
    await importOne(c);
    entries = Object.values(getBank(c.holder.state).candidates);
    expect(entries).toHaveLength(1); expect(entries[0]!.input.answers).toEqual(["A"]);
    const question = Object.values(getBank(c.holder.state).questions)[0]!;
    await expect(c.manager.execute({ type: "save-question", input: entries[0]!.input,
      options: { bankId: "bank_test", questionId: question.id }, expectedRevisionId: "old_revision" })).rejects.toThrow("更新");
  });

  it("persists source versus AI explanation labels and preserves a user's edited explanation", async () => {
    const c = setup(); await importOne(c, `${SINGLE}答案：B\n解析：这是原文解析。`);
    let candidate = Object.values(getBank(c.holder.state).candidates)[0]!;
    expect(candidate.input.explanationOrigin).toBe("source");
    const { task } = await exportedTask(c); const source = (await c.manager.getSnapshot()).importSources![0]!;
    await c.manager.execute({ type: "import-codex", bankId: "bank_test", text: resultFor(task, source, { explanation: "这是 AI 重新组织的解释。", explanationOrigin: "source" }) });
    candidate = Object.values(getBank(c.holder.state).candidates)[0]!;
    expect(candidate.input.explanationOrigin).toBe("ai-adopted");
    await c.manager.execute({ type: "commit-candidate", bankId: "bank_test", candidateId: candidate.id,
      input: { ...candidate.input, explanation: "用户补充的解释。", explanationOrigin: "user" }, resolveConflict: true, reason: "核对并修改解析" });
    const question = Object.values(getBank(c.holder.state).questions)[0]!;
    expect(question.revisions[question.activeRevisionId]!.explanationOrigin).toBe("user");
    expect(question.revisions[question.activeRevisionId]!.explanation).toBe("用户补充的解释。");
  });

  it("retains separate occurrences when the same question type restarts numbering", async () => {
    const c = setup();
    await importOne(c, "## 单选题\n1. 第一节的问题？\nA.甲\nB.乙\n答案：A\n## 单选题\n1. 第二节的问题？\nA.丙\nB.丁\n答案：B");
    let entries = Object.values(getBank(c.holder.state).candidates);
    expect(entries).toHaveLength(2); expect(entries.map((candidate) => candidate.input.stem)).toEqual(["第一节的问题？", "第二节的问题？"]);
    expect(entries.every((candidate) => candidate.issues.some((issue) => issue.includes("多个候选位置")))).toBe(true);
    await importOne(c, "## 单选题\n1. 第一节的问题？\nA.甲\nB.乙\n答案：A\n## 单选题\n1. 第二节的问题？\nA.丙\nB.丁\n答案：B");
    entries = Object.values(getBank(c.holder.state).candidates); expect(entries).toHaveLength(2);
  });

  it("reconciles a corrected type at the same source position without adding a second candidate", async () => {
    const c = setup(); await importOne(c, "1. 哪些答案正确？\nA.甲\nB.乙\n答案：AB");
    const first = Object.values(getBank(c.holder.state).candidates)[0]!; expect(first.input.type).toBe("single");
    const { task } = await exportedTask(c); const source = (await c.manager.getSnapshot()).importSources![0]!;
    await c.manager.execute({ type: "import-codex", bankId: "bank_test", text: resultFor(task, source, { type: "multiple", stem: "哪些答案正确？", answers: ["A", "B"] }) });
    const candidates = Object.values(getBank(c.holder.state).candidates); expect(candidates).toHaveLength(1);
    expect(candidates[0]!.id).toBe(first.id); expect(candidates[0]!.input.type).toBe("multiple");
  });

  it("binds Codex output to saved source bytes and retains missing answers, conflicts and images as issues", async () => {
    const c = setup(); await importOne(c, SINGLE, "1. B\n1. A");
    const { task } = await exportedTask(c); const source = (await c.manager.getSnapshot()).importSources![0]!;
    await c.manager.execute({ type: "import-codex", bankId: "bank_test", text: resultFor(task, source) });
    let entries = Object.values(getBank(c.holder.state).candidates);
    expect(entries).toHaveLength(1); expect(entries[0]!.issues.join()).toContain("多个");
    expect(entries[0]!.input.sources![0]!.locator).toBe("全文 · 第 1 题");
    await c.manager.execute({ type: "import-codex", bankId: "bank_test", text: resultFor(task, source) });
    expect(Object.keys(getBank(c.holder.state).candidates)).toHaveLength(1);
    await expect(c.manager.execute({ type: "commit-normal-candidates", bankId: "bank_test", candidateIds: [entries[0]!.id] })).rejects.toThrow("未处理");
    await c.manager.execute({ type: "import-codex", bankId: "bank_test", text: resultFor(task, source, { answers: [] }) });
    entries = Object.values(getBank(c.holder.state).candidates); expect(entries[0]!.issues.join()).toContain("缺少答案");
    await c.files.write(source.path!, "changed source");
    await expect(c.manager.execute({ type: "import-codex", bankId: "bank_test", text: resultFor(task, source) })).rejects.toThrow("修改");
    await expect(importOne(c)).rejects.toThrow("原资料被修改");
    const missing = setup(); await importOne(missing, `${SINGLE}【图像附件缺失】\n答案：B`);
    const missingCandidate = Object.values(getBank(missing.holder.state).candidates)[0]!;
    expect(missingCandidate.issues.join()).toContain("题图缺失");
    await expect(missing.manager.execute({ type: "commit-candidate", bankId: "bank_test", candidateId: missingCandidate.id,
      input: missingCandidate.input, resolveConflict: true, reason: "已核对" })).rejects.toThrow("补齐题图");
  });

  it("sends distinct-question weakness evidence and keeps insufficient samples subject to explicit category choice", async () => {
    const c = setup(); await importOne(c, `${SINGLE}答案：B`);
    await c.manager.execute({ type: "commit-normal-candidates", bankId: "bank_test", candidateIds: Object.keys(getBank(c.holder.state).candidates) });
    const questionId = Object.keys(getBank(c.holder.state).questions)[0]!;
    await c.holder.mutate((state) => recordAnswerEvent(recordAnswerEvent(state, questionId, false), questionId, false));
    c.holder.settings.ai.mode = "api"; c.holder.settings.ai.model = "fixture";
    http.mockResolvedValue({ status: 200, text: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ counts: { single: 1 } }) } }] }) });
    const result = await c.manager.execute({ type: "parse-compose", bankId: "bank_test", prompt: "按薄弱章节选一题" });
    const instruction = JSON.parse(http.mock.calls[0]![0].body).messages[0].content as string;
    const summary = JSON.parse(instruction.split("\n").at(-1)!);
    expect(summary.domains[0]).toMatchObject({ answered: 1, wrong: 1, currentWrongPercent: 100, sampleInsufficient: true });
    expect(instruction).toContain("不得据此自动排序选择薄弱章节");
    expect(instruction).toContain("未指定时省略 domains");
    expect(result.composeOptions?.domains).toBeUndefined();
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("never recursively requests composition and strictly rejects invalid types or unknown conditions", async () => {
    const c = setup(); c.holder.settings.ai.mode = "api"; c.holder.settings.ai.model = "fixture";
    http.mockResolvedValue({ status: 200, text: JSON.stringify({ choices: [{ message: { content: "请继续调用模型" } }] }) });
    await expect(c.manager.execute({ type: "parse-compose", bankId: "bank_test", prompt: "生成练习" })).rejects.toThrow("JSON");
    expect(http).toHaveBeenCalledTimes(1);
    for (const value of [{ counts: { single: "3" } }, { counts: { single: 1 }, command: "run" }, { domains: ["unknown"] }]) {
      await expect(c.manager.execute({ type: "parse-compose", bankId: "bank_test", prompt: JSON.stringify(value) })).rejects.toThrow();
    }
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("does not resend a request whose remote outcome is unknown", async () => {
    const c = setup(); await importOne(c); c.holder.settings.ai.mode = "api"; c.holder.settings.ai.model = "fixture";
    http.mockImplementation(async () => { throw new Error("connection lost"); }); const selected = await scope(c);
    await expect(c.manager.execute({ type: "run-ai", scope: selected })).rejects.toThrow("connection lost");
    const jobs = [...c.files.data.keys()].filter((path) => path.includes("/批次/"));
    expect(jobs).toHaveLength(1); expect(JSON.parse(await c.files.read(jobs[0]!)).uncertain).toBe(true);
    await expect(new ManagerController(c.holder as unknown as LibraryController).execute({ type: "run-ai", scope: selected })).rejects.toThrow("没有重发");
    expect(http).toHaveBeenCalledTimes(1);
    expect([...c.files.data.values()].map((bytes) => new TextDecoder().decode(bytes)).join()).not.toContain("session-secret");
  });

  it("preserves saved AI results after a staging failure and resumes without another request", async () => {
    const c = setup(); await importOne(c, SINGLE, "1. B"); const { task } = await exportedTask(c);
    const source = (await c.manager.getSnapshot()).importSources![0]!; c.holder.settings.ai.mode = "api"; c.holder.settings.ai.model = "fixture";
    http.mockResolvedValue({ status: 200, text: JSON.stringify({ choices: [{ message: { content: resultFor(task, source) } }] }) });
    const mutate = c.holder.mutate.bind(c.holder); let fail = true;
    c.holder.mutate = async (fn) => { if (fail) { fail = false; throw new Error("staging unavailable"); } return mutate(fn); };
    const selected = await scope(c);
    await expect(c.manager.execute({ type: "run-ai", scope: selected })).rejects.toThrow("staging unavailable");
    const resumed = await c.manager.execute({ type: "run-ai", scope: selected });
    expect(resumed.message).toContain("没有再次"); expect(http).toHaveBeenCalledTimes(1);
  });

  it("freezes only a complete accepted original and preserves declared versus computed points", async () => {
    const c = setup(); await importOne(c, `${SINGLE}答案：B`);
    const source = (await c.manager.getSnapshot()).importSources![0]!;
    const options = { bankId: "bank_test", batchId: source.id, sourceFile: source.path!, title: "原卷", durationMinutes: 20,
      scoreMode: "exact" as const, declaredQuestionCount: 1, declaredTotalScore: 100, points: { single: 2, multiple: 3, judge: 1 }, ruleNote: "卷头100分，资料仅一道", completenessConfirmed: true as const };
    await expect(c.manager.execute({ type: "freeze-original", options })).rejects.toThrow("未核对");
    await c.manager.execute({ type: "commit-normal-candidates", bankId: "bank_test", candidateIds: Object.keys(getBank(c.holder.state).candidates) });
    await expect(c.manager.execute({ type: "freeze-original", options: { ...options, declaredQuestionCount: 2 } })).rejects.toThrow("题量");
    const saved = await c.manager.execute({ type: "freeze-original", options });
    expect(saved.paper?.kind).toBe("original"); expect(saved.paper?.totalScore).toBe(2); expect(saved.paper?.declaredTotalScore).toBe(100);
  });

  it("refuses to freeze a composition when a previewed question becomes conflicted", async () => {
    const c = setup(); await importOne(c, `${SINGLE}答案：B`);
    await c.manager.execute({ type: "commit-normal-candidates", bankId: "bank_test", candidateIds: Object.keys(getBank(c.holder.state).candidates) });
    const options = { bankId: "bank_test", title: "预览", durationMinutes: 30, counts: { single: 1 } };
    const preview = await c.manager.execute({ type: "compose-paper", options, freeze: false });
    const question = Object.values(getBank(c.holder.state).questions)[0]!;
    c.holder.state.conflicts.push({ id: "conflict_preview", bankId: "bank_test", kind: "question-head", entityId: question.id, local: question.activeRevisionId, remote: question.activeRevisionId });
    await expect(c.manager.execute({ type: "compose-paper", options, freeze: true, preview: preview.paper })).rejects.toThrow("待核对冲突");
    await expect(c.manager.execute({ type: "export-backup", includeHistory: false, includeSources: true })).rejects.toThrow("内容冲突");
  });

  it("exports pending work, restores immutable source references and refuses arbitrary or conflicting file writes", async () => {
    const c = setup(); await importOne(c, `${SINGLE}答案：B`); await exportedTask(c);
    const full = await c.manager.execute({ type: "export-backup", includeHistory: true, includeSources: false });
    const archive = JSON.parse(full.text!); expect(archive.files.some((file: { path: string }) => file.path.endsWith(".source.json"))).toBe(true);
    expect(archive.files.some((file: { path: string }) => file.path.endsWith("task.json"))).toBe(true);
    expect(archive.files.some((file: { path: string }) => file.path.endsWith(".draft.json"))).toBe(true);
    const fresh = setup(); await fresh.manager.execute({ type: "restore-backup", text: full.text!, confirmed: true });
    expect(Object.values(getBank(fresh.holder.state).candidates)[0]!.input.sources).toEqual(Object.values(getBank(c.holder.state).candidates)[0]!.input.sources);
    const source = (await fresh.manager.getSnapshot()).importSources![0]!; await fresh.files.write(source.path!, "existing edited data");
    await expect(fresh.manager.execute({ type: "restore-backup", text: full.text!, confirmed: true })).rejects.toThrow("已有不同内容");
    expect(await fresh.files.read(source.path!)).toBe("existing edited data");
    archive.files.push({ path: "易记题库/记录/evil.json", dataBase64: "e30=" });
    archive.checksum = contentDigest({ kind: archive.kind, root: archive.root, libraryBackup: archive.libraryBackup, files: archive.files });
    const empty = setup(); await expect(empty.manager.execute({ type: "restore-backup", text: JSON.stringify(archive), confirmed: true })).rejects.toThrow("资料目录");
    expect(empty.files.data.size).toBe(0);
    const content = JSON.parse((await c.manager.execute({ type: "export-backup", includeHistory: false, includeSources: false })).text!);
    const bank = content.libraryBackup.library.banks.bank_test; expect(bank.candidates).toEqual({}); expect(bank.examWrites).toEqual({}); expect(bank.examHeads).toEqual({});
  });

  it("repairs a missing question image from a complete backup before preserving current learning and restoring", async () => {
    const c = setup(); const { imagePath, image, questionId } = await addImageQuestion(c);
    const full = await c.manager.execute({ type: "export-backup", includeHistory: true, includeSources: true });
    await c.holder.mutate((state) => recordAnswerEvent(state, questionId, false, { selected: ["A"] }));
    c.files.data.delete(imagePath);
    vi.stubGlobal("window", { setTimeout, clearTimeout, localStorage: { getItem: () => "device_test", setItem: () => undefined } });
    const host = new LibraryController({ vault: {} } as App, async () => undefined, c.holder.settings);
    // The controller and manager are production code; only disk I/O is isolated.
    Object.assign(host, { files: c.files, repository: new LibraryRepository(c.files, host.settings.root, host.deviceId), state: c.holder.state });
    const manager = new ManagerController(host);
    await host.reloadFromDisk();
    const revisionId = host.getRevision(questionId)!.id;
    expect(host.getQuestionBank().questions).toHaveLength(0);
    await expect(host.submitPracticeAnswer(questionId, revisionId, ["B"], "practice")).rejects.toThrow("图片缺失");
    const existingPaths = [...c.files.data.keys()];
    const preview = await manager.execute({ type: "restore-backup", text: full.text!, confirmed: false });
    expect(preview.restoreSummary).toContain("当前缺少 1 个附件");
    expect(preview.restoreSummary).toContain(imagePath);
    expect([...c.files.data.keys()]).toEqual(existingPaths);
    await manager.execute({ type: "restore-backup", text: full.text!, confirmed: true });
    expect(new Uint8Array(await c.files.readBinary(imagePath))).toEqual(image);
    expect(host.getQuestionBank().questions.map((question) => question.id)).toEqual([questionId]);
    expect(host.getStudyData().questions[questionId]!.attempts).toBe(1);
    const preRestorePath = [...c.files.data.keys()].find((path) => path.includes("/备份/完整备份-") && path !== full.path)!;
    const snapshot = JSON.parse(await c.files.read(preRestorePath));
    expect(snapshot.kind).toBe("full");
    const preserved = restoreBackup(snapshot.libraryBackup);
    expect(getBankStudyData(preserved).questions[questionId]!.attempts).toBe(1);
    expect(getBank(preserved).attachments.test_image!.dataBase64).toBe(Buffer.from(image).toString("base64"));
    expect(await host.submitPracticeAnswer(questionId, revisionId, ["B"], "practice")).toBe("removed");
    expect(host.getStudyData().questions[questionId]!.attempts).toBe(2);
  });

  it("stops without writes when a recovery package cannot repair current missing files or would overwrite different bytes", async () => {
    const c = setup(); const { imagePath } = await addImageQuestion(c);
    const full = await c.manager.execute({ type: "export-backup", includeHistory: true, includeSources: true });
    const unrelated = setup();
    const unrelatedBackup = await unrelated.manager.execute({ type: "export-backup", includeHistory: true, includeSources: true });
    c.files.data.delete(imagePath);
    const before = new Map(c.files.data); const state = JSON.stringify(c.holder.state);
    await expect(c.manager.execute({ type: "restore-backup", text: unrelatedBackup.text!, confirmed: true })).rejects.toThrow("当前缺失附件未包含");
    expect(c.files.data).toEqual(before); expect(JSON.stringify(c.holder.state)).toBe(state);
    await c.files.write(imagePath, "用户另外保存的不同图片");
    const different = new Map(c.files.data);
    await expect(c.manager.execute({ type: "restore-backup", text: full.text!, confirmed: true })).rejects.toThrow("已有不同内容");
    expect(c.files.data).toEqual(different); expect(JSON.stringify(c.holder.state)).toBe(state);
  });

  it("saves a complete backup before deletion and restores deleted banks under a new identity", async () => {
    const c = setup(); await importOne(c); const result = await c.manager.execute({ type: "delete-bank", bankId: "bank_test", confirmName: "常识" });
    expect(c.holder.state.banks.bank_test?.deletedAt).toBeTruthy(); const backup = await c.files.read(result.path!);
    await c.manager.execute({ type: "restore-backup", text: backup, confirmed: true });
    const restored = getBank(c.holder.state); expect(restored.id).not.toBe("bank_test"); expect(c.holder.state.banks.bank_test?.deletedAt).toBeTruthy();
    expect(Object.keys(restored.candidates)).toHaveLength(1); expect((await c.manager.getSnapshot()).importSources).toHaveLength(1);
  });

  it("restores content exports as a fresh bank without merging their empty baseline into existing learning", async () => {
    const c = setup(); await importOne(c, `${SINGLE}答案：B`);
    await c.manager.execute({ type: "commit-normal-candidates", bankId: "bank_test", candidateIds: Object.keys(getBank(c.holder.state).candidates) });
    const questionId = Object.keys(getBank(c.holder.state).questions)[0]!;
    await c.manager.execute({ type: "set-review", bankId: "bank_test", enabled: true });
    await c.holder.mutate((state) => recordAnswerEvent(state, questionId, true));
    const content = await c.manager.execute({ type: "export-backup", includeHistory: false, includeSources: true });
    await c.manager.execute({ type: "restore-backup", text: content.text!, confirmed: true });
    const copy = getBank(c.holder.state); expect(copy.id).not.toBe("bank_test"); expect(copy.reviewEnabled).toBe(false);
    expect(getBankStudyData(c.holder.state).questions).toEqual({});
    expect(getBankStudyData(c.holder.state, "bank_test").questions[questionId]!.attempts).toBe(1);
    expect(c.holder.state.conflicts).toHaveLength(0);
  });

  it.runIf(process.env.YIJI_CAPACITY === "1")("measures the 2000-question manager workflow on synthetic material", async () => {
    const c = setup(); const file = await readFile(resolve(".artifacts/acceptance-materials/计算机基础-2000题.json"), "utf8");
    const steps: { name: string; milliseconds: number; maxEventLoopDelayMs: number; heapUsedBytes: number }[] = [];
    let maxDelay = 0; let tick = performance.now();
    const heartbeat = setInterval(() => { const now = performance.now(); maxDelay = Math.max(maxDelay, now - tick - 10); tick = now; }, 10);
    const measured = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
      maxDelay = 0; tick = performance.now(); const start = tick; const result = await action();
      const elapsed = performance.now() - start; await new Promise((done) => setTimeout(done, 15));
      steps.push({ name, milliseconds: Math.round(elapsed), maxEventLoopDelayMs: Math.round(Math.max(0, maxDelay)), heapUsedBytes: process.memoryUsage().heapUsed }); return result;
    };
    try {
      await measured("import_and_stage_2000", () => c.manager.execute({ type: "preview-import", bankId: "bank_test", files: [upload("计算机基础-2000题.json", file)] }));
      expect(Object.keys(getBank(c.holder.state).candidates)).toHaveLength(2000);
      await measured("accept_2000_candidates", () => c.manager.execute({ type: "commit-normal-candidates", bankId: "bank_test", candidateIds: Object.keys(getBank(c.holder.state).candidates) }));
      const options = { bankId: "bank_test", title: "容量验收 200 题", counts: { single: 100, multiple: 50, judge: 50 }, points: { single: 0.5, multiple: 1, judge: 1 }, durationMinutes: 90 };
      const preview = await measured("compose_200_questions", () => c.manager.execute({ type: "compose-paper", options, freeze: false }));
      expect(preview.paper?.items).toHaveLength(200); expect(preview.paper?.totalScore).toBe(150);
      await measured("freeze_200_question_paper", () => c.manager.execute({ type: "compose-paper", options, freeze: true, preview: preview.paper }));
      const backup = await measured("full_backup", () => c.manager.execute({ type: "export-backup", includeHistory: true, includeSources: true }));
      const fresh = setup(); await measured("restore_and_reconcile", () => fresh.manager.execute({ type: "restore-backup", text: backup.text!, confirmed: true }));
      const before = getBank(c.holder.state); const after = getBank(fresh.holder.state);
      expect(contentDigest(after.questions)).toBe(contentDigest(before.questions)); expect(contentDigest(after.papers)).toBe(contentDigest(before.papers));
      expect(Object.values(after.candidates).filter((candidate) => candidate.status === "accepted")).toHaveLength(2000);
      await writeFile(resolve(".artifacts/capacity-report.json"), JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version,
        environment: "Production ManagerController with isolated in-memory Vault; no UI, disk I/O, Obsidian, mobile or iCloud timing claim", fixtureBytes: Buffer.byteLength(file), questions: 2000,
        composedQuestions: 200, totalScore: 150, backupBytes: Buffer.byteLength(backup.text!), restoredQuestions: Object.keys(after.questions).length, restoredQuestionAndPaperDigestsMatch: true,
        steps, observation: "Event-loop delay measures synchronous work in this Node fixture. Desktop UI and mobile responsiveness require host measurements; no pass/fail speed threshold is asserted." }, null, 2));
    } finally { clearInterval(heartbeat); }
  }, 120_000);

  it("exports the exact production Codex scope for the independent synthetic acceptance task", async () => {
    const c = setup();
    await c.manager.execute({ type: "preview-import", bankId: "bank_test", files: [
      upload("custom-paper-source.md", await readFile(resolve("tests/fixtures/custom-paper-source.md"), "utf8")),
      upload("custom-paper-answers.md", await readFile(resolve("tests/fixtures/custom-paper-answers.md"), "utf8"), "answers"),
    ] });
    const { task, result } = await exportedTask(c); expect(task.scope.instructions).toBe("整理原题与知识点，解析留空。");
    const directory = resolve(".artifacts/codex-ui-acceptance"); await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "任务.md"), result.text!); await writeFile(resolve(directory, "task.json"), JSON.stringify(task, null, 2));
    await writeFile(resolve(directory, "vault-files.json"), JSON.stringify(Object.fromEntries([...c.files.data].map(([path, bytes]) => [path, Buffer.from(bytes).toString("base64")])), null, 2));
    await writeFile(resolve(directory, "library.json"), JSON.stringify(c.holder.state, null, 2));
    expect(task.scope.taskId).toBeTruthy();
  });

  it.runIf(existsSync(resolve(".artifacts/codex-ui-acceptance/result.json")))("imports the independently produced Codex result through the saved task and leaves three defects pending", async () => {
    const c = setup(); const directory = resolve(".artifacts/codex-ui-acceptance");
    const savedFiles: Record<string, string> = JSON.parse(await readFile(resolve(directory, "vault-files.json"), "utf8"));
    for (const [path, encoded] of Object.entries(savedFiles)) c.files.data.set(path, new Uint8Array(Buffer.from(encoded, "base64")));
    c.holder.state = JSON.parse(await readFile(resolve(directory, "library.json"), "utf8")) as LibraryState;
    const task = JSON.parse(await c.files.read([...c.files.data.keys()].find((path) => path.endsWith("/task.json"))!));
    const aiText = await readFile(resolve(directory, "result.json"), "utf8"); expect(JSON.parse(aiText).taskId).toBe(task.scope.taskId);
    await c.manager.execute({ type: "import-codex", bankId: "bank_test", text: aiText });
    await c.manager.execute({ type: "import-codex", bankId: "bank_test", text: aiText });
    const entries = Object.values(getBank(c.holder.state).candidates); expect(entries).toHaveLength(12);
    const normal = entries.filter((candidate) => !candidate.issues.length); expect(normal).toHaveLength(9);
    const issues = entries.filter((candidate) => candidate.issues.length); expect(issues.map((candidate) => candidate.input.sources![0]!.ordinal).sort()).toEqual(["10", "11", "12"]);
    await c.manager.execute({ type: "commit-normal-candidates", bankId: "bank_test", candidateIds: normal.map((candidate) => candidate.id) });
    expect(Object.keys(getBank(c.holder.state).questions)).toHaveLength(9);
    expect(Object.values(getBank(c.holder.state).candidates).filter((candidate) => candidate.status === "pending")).toHaveLength(3);
    await writeFile(resolve(directory, "verification.json"), JSON.stringify({ environment: "production ManagerController with isolated in-memory Vault; independently produced Codex JSON", taskId: task.scope.taskId,
      totalCandidates: 12, accepted: 9, pending: issues.map((candidate) => ({ ordinal: candidate.input.sources![0]!.ordinal, issues: candidate.issues })), repeatImportCreatedDuplicates: false,
      sourceBindingChecked: true, actualObsidianOrMobile: false }, null, 2));
  });
});

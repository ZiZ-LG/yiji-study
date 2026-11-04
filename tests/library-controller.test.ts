import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

vi.mock("obsidian", () => ({
  Notice: class Notice { constructor(_message: string) {} },
  TFile: class TFile { path = ""; },
  TFolder: class TFolder { path = ""; },
  normalizePath: (path: string) => path.replace(/\\/g, "/"),
  requireApiVersion: () => false,
}));

import { TFile, TFolder } from "obsidian";
import { LibraryController } from "../src/host/library-controller";
import { acceptCandidate, commitQuestion, composePaper, getBank, stageCandidates, submitPaperAttempt, toExamPaper } from "../src/library";
import { startExam } from "../src/state/exam-state";
import { createEmptyStudyData, recordAnswer } from "../src/state/study-state";
import { EMBEDDED_QUESTIONS } from "../src/generated/electricity-trader-pack";

const NOW = "2026-11-04T12:00:00.000Z";
class FakeVault {
  texts = new Map<string, string>();
  folders = new Set<string>();
  indexed = true;
  adapter = {
    exists: (path: string) => Promise.resolve(this.texts.has(path) || this.folders.has(path)),
    stat: (path: string) => Promise.resolve(this.texts.has(path) ? { type: "file", size: 1, ctime: 0, mtime: 0 } : this.folders.has(path) ? { type: "folder", size: 0, ctime: 0, mtime: 0 } : null),
    mkdir: (path: string) => { this.folders.add(path); return Promise.resolve(); },
    list: (path: string) => Promise.resolve({ files: [...this.texts.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/")),
      folders: [...this.folders].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/")) }),
    read: (path: string) => this.texts.has(path) ? Promise.resolve(this.texts.get(path)!) : Promise.reject(new Error("missing")),
    write: (path: string, text: string) => { this.texts.set(path, text); return Promise.resolve(); },
  };
  getFiles() { return this.indexed ? [...this.texts.keys()].map((path) => Object.assign(Object.create(TFile.prototype) as TFile, { path })) : []; }
  getMarkdownFiles() { return this.getFiles().filter((file) => file.path.endsWith(".md")); }
  getAbstractFileByPath(path: string) {
    if (!this.indexed) return null;
    if (this.texts.has(path)) return Object.assign(Object.create(TFile.prototype) as TFile, { path });
    if (this.folders.has(path)) return Object.assign(Object.create(TFolder.prototype) as TFolder, { path });
    return null;
  }
  createFolder(path: string) { this.folders.add(path); return Promise.resolve(); }
  read(file: TFile) { return this.adapter.read(file.path); }
  cachedRead(file: TFile) { return this.read(file); }
  create(path: string, text: string) { this.texts.set(path, text); return Promise.resolve(this.getAbstractFileByPath(path)); }
  async process(file: TFile, fn: (text: string) => string) { this.texts.set(file.path, fn(await this.read(file))); }
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
});
afterEach(() => vi.unstubAllGlobals());

async function controller() {
  const vault = new FakeVault();
  const save = vi.fn(async () => undefined);
  const app = { vault } as unknown as App;
  const result = new LibraryController(app, save, null);
  await result.initialize(null);
  return { controller: result, vault, save };
}
async function addQuestion(controller: LibraryController): Promise<string> {
  let id = "";
  await controller.mutate((state) => {
    const result = commitQuestion(state, { type: "single", stem: "测试题", domain: "第一章",
      options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }], answers: ["A"] }, { now: NOW });
    id = result.questionId!;
    return result.state;
  });
  return id;
}

describe("library controller integration with fake Obsidian files", () => {
  it("loads saved questions and drafts before Obsidian's file index is ready", async () => {
    const { controller: first, vault } = await controller();
    const id = await addQuestion(first);
    await first.mutate((state) => stageCandidates(state, [{ ...first.getRevision(id)!, stem: "未完成的导入草稿" }], { batchId: "source-test" }));
    const shardPath = first.repository.shardPath;
    const saved = vault.texts.get(shardPath);
    vault.indexed = false;
    expect(vault.getFiles()).toEqual([]);
    const second = new LibraryController({ vault } as unknown as App, async () => undefined, first.settings);
    await second.initialize(first.settings);
    expect(second.state.activeBankId).toBe(first.state.activeBankId);
    expect(second.getQuestionBank().questions.map((question) => question.id)).toEqual([id]);
    expect(Object.values(getBank(second.state).candidates)).toHaveLength(1);
    expect(vault.texts.get(shardPath)).toBe(saved);
    await second.submitPracticeAnswer(id, second.getRevision(id)!.id, ["A"], "practice");
    await second.reloadFromDisk();
    expect(second.getStudyData().questions[id]?.attempts).toBe(1);
    expect(Object.values(getBank(second.state).candidates)).toHaveLength(1);
  });

  it("stops when existing settings name a bank but its records have not synced", async () => {
    const { controller: first, vault } = await controller();
    const settings = { ...first.settings };
    vault.texts.clear();
    const save = vi.fn(async () => undefined);
    for (const activeBankId of [settings.activeBankId, null]) {
      const raw = { ...settings, activeBankId };
      const second = new LibraryController({ vault } as unknown as App, save, raw);
      await expect(second.initialize(raw)).rejects.toThrow("尚未读取到");
    }
    expect(save).not.toHaveBeenCalled();
    expect(vault.texts.size).toBe(0);
  });

  it("does not treat disk enumeration errors as an empty library", async () => {
    const { controller: first, vault } = await controller();
    const saved = new Map(vault.texts);
    vi.spyOn(vault.adapter, "list").mockRejectedValue(new Error("disk unavailable"));
    const second = new LibraryController({ vault } as unknown as App, async () => undefined, first.settings);
    await expect(second.initialize(first.settings)).rejects.toThrow("disk unavailable");
    expect(vault.texts).toEqual(saved);
  });

  it("stores selections and review context and rejects stale question versions", async () => {
    const { controller: host } = await controller();
    const id = await addQuestion(host);
    const revisionId = host.getRevision(id)!.id;
    expect(await host.submitPracticeAnswer(id, revisionId, ["B"], "review")).toBe("added");
    expect(Object.values(host.state.events).find((event) => event.kind === "answer")).toMatchObject({ selected: ["B"], context: "review", correct: false });
    await host.mutate((state) => commitQuestion(state, { ...host.getRevision(id)!, stem: "修订题干" }, { questionId: id }).state);
    await expect(host.submitPracticeAnswer(id, revisionId, ["A"], "practice")).rejects.toThrow("版本已变化");
    expect(host.getStudyData().questions[id]?.attempts).toBe(1);
  });

  it("preserves a second device's old baseline even when a migrated shard already exists", async () => {
    const vault = new FakeVault();
    const app = { vault } as unknown as App;
    const id = EMBEDDED_QUESTIONS[0]!.id;
    const oldA = recordAnswer(createEmptyStudyData(), id, true, NOW).data;
    window.localStorage.setItem("yiji-study-device-id", "device-A");
    const one = new LibraryController(app, async () => undefined, oldA);
    await one.initialize(oldA);
    const oldB = recordAnswer(oldA, id, false, NOW).data;
    window.localStorage.setItem("yiji-study-device-id", "device-B");
    const two = new LibraryController(app, async () => undefined, oldB);
    await two.initialize(oldB);
    expect(two.state.conflicts.some((conflict) => conflict.kind === "baseline")).toBe(true);
    expect(vault.texts.get("易记题库/备份/旧版学习记录-device-B.json")).toBe(JSON.stringify(oldB));
    expect(two.getStudyData().questions[id]?.attempts).toBe(1);
  });

  it("excludes a question when its required image file disappears after import", async () => {
    const { controller: host, vault } = await controller();
    const id = await addQuestion(host);
    const path = "易记题库/附件/图.png";
    vault.texts.set(path, "fake image bytes");
    await host.mutate((state) => {
      const next = JSON.parse(JSON.stringify(state)) as typeof state;
      getBank(next).attachments.diagram = { id: "diagram", path, mimeType: "image/png" };
      return commitQuestion(next, { ...host.getRevision(id)!, attachmentIds: ["diagram"] }, { questionId: id }).state;
    });
    expect(host.getQuestionBank().questions).toHaveLength(1);
    vault.texts.delete(path);
    await host.reloadFromDisk();
    expect(host.getQuestionBank().questions).toHaveLength(0);
    await expect(host.submitPracticeAnswer(id, host.getRevision(id)!.id, ["A"], "practice")).rejects.toThrow("图片缺失");
  });
  it("refreshes external edits into candidates, preserves the original file and only applies after review", async () => {
    const { controller: host, vault } = await controller();
    const id = await addQuestion(host);
    const path = [...vault.texts.keys()].find((entry) => entry.endsWith(`${id}.md`))!;
    const edited = vault.texts.get(path)!.replace("参考答案：A", "参考答案：B");
    vault.texts.set(path, edited);
    await host.refresh();
    expect(host.getQuestionBank().questions[0]?.answers).toEqual(["A"]);
    const candidates = Object.values(getBank(host.state).candidates);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.targetQuestionId).toBe(id);
    await host.refresh();
    expect(Object.keys(getBank(host.state).candidates)).toHaveLength(1);
    await host.mutate((state) => acceptCandidate(state, candidates[0]!.id, { reason: "对照资料修正", now: NOW }).state);
    expect(host.getQuestionBank().questions[0]?.answers).toEqual(["B"]);
    expect(vault.texts.get(path)).toBe(edited);
    expect([...vault.texts.keys()].filter((entry) => entry.includes(`/题目/`) && entry.endsWith(".md"))).toHaveLength(2);
  });

  it("reviews a previous exam without replacing the latest attempt or permitting historical writes", async () => {
    const { controller: host } = await controller();
    await addQuestion(host);
    let paperId = "";
    await host.mutate((state) => {
      const result = composePaper(state, { title: "测验", counts: { single: 1 }, durationMinutes: 30, now: NOW });
      paperId = result.paper!.id;
      return result.state;
    });
    const paper = getBank(host.state).papers[paperId]!;
    const start = startExam(toExamPaper(paper), Date.parse(NOW));
    await host.persistStudyData({ ...host.getStudyData(), exams: { [paperId]: { ...start, answers: { "1": ["A"] } } } });
    await host.mutate((state) => submitPaperAttempt(state, paperId, "2026-11-04T12:01:00.000Z"));
    const oldId = host.getExamHistory()[0]!.id;
    const second = startExam(toExamPaper(paper), Date.parse("2026-11-05T12:00:00.000Z"));
    await host.persistStudyData({ ...host.getStudyData(), exams: { [paperId]: second } });
    expect(host.getExamHistory()).toHaveLength(2);
    expect(host.selectExamHistory(oldId)).toBe(paperId);
    expect(host.getStudyData().exams?.[paperId]?.score).toBe(1);
    await expect(host.persistStudyData(host.getStudyData())).rejects.toThrow("只读");
    host.clearExamHistorySelection();
    expect(host.getStudyData().exams?.[paperId]?.startedAt).toBe(second.startedAt);
  });

  it("rejects a queued stale exam write and permits continuation after reading the saved attempt", async () => {
    const { controller: host } = await controller();
    await addQuestion(host);
    let paperId = "";
    await host.mutate((state) => {
      const result = composePaper(state, { title: "并发测验", counts: { single: 1 }, durationMinutes: 30, now: NOW });
      paperId = result.paper!.id;
      return result.state;
    });
    const started = startExam(toExamPaper(getBank(host.state).papers[paperId]!), Date.parse(NOW));
    await host.persistStudyData({ ...host.getStudyData(), exams: { [paperId]: started } });
    const snapshot = host.getStudyData();
    const first = host.persistStudyData({ ...snapshot, exams: { [paperId]: { ...started, answers: { "1": ["A"] } } } });
    const stale = host.persistStudyData({ ...snapshot, exams: { [paperId]: { ...started, answers: { "1": ["B"] } } } });
    const outcomes = await Promise.allSettled([first, stale]);
    expect(outcomes[0]?.status).toBe("fulfilled");
    expect(outcomes[1]?.status).toBe("rejected");
    if (outcomes[1]?.status === "rejected") expect(String(outcomes[1].reason)).toContain("另一个视图更新");
    await host.reloadFromDisk();
    expect(host.getStudyData().exams?.[paperId]?.answers).toEqual({ "1": ["A"] });
    const fresh = host.getStudyData();
    await host.persistStudyData({ ...fresh, exams: { [paperId]: { ...fresh.exams![paperId]!, answers: { "1": ["B"] } } } });
    await host.reloadFromDisk();
    expect(host.getStudyData().exams?.[paperId]?.answers).toEqual({ "1": ["B"] });
    expect(host.state.conflicts).toHaveLength(0);
  });

  it("keeps older-host API keys in the session and excludes them from saved settings", async () => {
    const { controller: host, save, vault } = await controller();
    host.setApiKey("test-only-secret");
    expect(host.getApiKey()).toBe("test-only-secret");
    await addQuestion(host);
    expect(JSON.stringify(save.mock.calls)).not.toContain("test-only-secret");
    expect([...vault.texts.values()].join("\n")).not.toContain("test-only-secret");
  });
});

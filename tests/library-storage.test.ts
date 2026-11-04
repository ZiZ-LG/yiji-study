import { describe, expect, it } from "vitest";
import { LibraryRepository, safeLibraryRoot } from "../src/storage/library-repository";
import type { LibraryFiles } from "../src/storage/library-repository";
import { inspectQuestionNote, renderQuestionNote } from "../src/storage/question-notes";
import { acceptCandidate, commitQuestion, createBank, createLibrary, getActiveQuestions, getBank, getBankStudyData,
  recordAnswerEvent, stageCandidates } from "../src/library";
import type { LibraryState } from "../src/library";

const NOW = "2026-11-04T12:00:00.000Z";
class FakeFiles implements LibraryFiles {
  files = new Map<string, string>();
  writes: string[] = [];
  behavior: "normal" | "committed-error" | "before-error" | "mismatch" = "normal";
  list(directory: string): Promise<string[]> { return Promise.resolve([...this.files.keys()].filter((key) => key.startsWith(`${directory}/`))); }
  exists(path: string): Promise<boolean> { return Promise.resolve(this.files.has(path)); }
  read(path: string): Promise<string> {
    const value = this.files.get(path);
    return value === undefined ? Promise.reject(new Error("missing")) : Promise.resolve(value);
  }
  write(path: string, text: string): Promise<void> {
    this.writes.push(path);
    if (this.behavior === "before-error") return Promise.reject(new Error("failed before write"));
    this.files.set(path, this.behavior === "mismatch" ? `${text}broken` : text);
    return this.behavior === "committed-error" ? Promise.reject(new Error("response lost after commit")) : Promise.resolve();
  }
}
function state(): { state: LibraryState; id: string } {
  const library = createBank(createLibrary("device-A"), "考试", { id: "bank-A", now: NOW });
  const result = commitQuestion(library, { type: "single", stem: "问题", options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }],
    answers: ["A"], domain: "第一章", explanation: "原解释" }, { now: NOW });
  return { state: result.state, id: result.questionId! };
}

describe("device shard persistence", () => {
  it("keeps both devices' independent answers and never writes another device's shard", async () => {
    const files = new FakeFiles();
    const one = new LibraryRepository(files, "易记题库", "device-A");
    const two = new LibraryRepository(files, "易记题库", "device-B");
    const initial = state();
    await one.save(initial.state);
    const second = (await two.load()).state!;
    await one.save(recordAnswerEvent(initial.state, initial.id, false, { id: "event-A", now: NOW }));
    await two.save(recordAnswerEvent(second, initial.id, true, { id: "event-B", now: "2026-11-05T12:00:00.000Z" }));
    const merged = (await one.load()).state!;
    expect(getBankStudyData(merged).questions[initial.id]?.attempts).toBe(2);
    expect(merged.conflicts).toEqual([]);
    expect([...files.files.keys()].filter((key) => /device-[AB]\.json$/.test(key))).toHaveLength(2);
  });

  it("accepts an ambiguous write only after reading the committed bytes without retrying", async () => {
    const files = new FakeFiles();
    files.behavior = "committed-error";
    const repository = new LibraryRepository(files, "易记题库", "device-A");
    const initial = state().state;
    expect(await repository.save(initial)).toEqual(initial);
    expect(files.writes).toEqual([repository.shardPath]);
  });

  it("rejects a failed or mismatched write and does not blindly write again", async () => {
    for (const behavior of ["before-error", "mismatch"] as const) {
      const files = new FakeFiles();
      files.behavior = behavior;
      const repository = new LibraryRepository(files, "易记题库", "device-A");
      await expect(repository.save(state().state)).rejects.toThrow();
      expect(files.writes).toHaveLength(1);
    }
  });

  it("recovers previous-only snapshots instead of creating an empty library", async () => {
    const files = new FakeFiles();
    const repository = new LibraryRepository(files, "易记题库", "device-A");
    const initial = state().state;
    files.files.set(repository.shardPath.replace(".json", ".previous.json"), JSON.stringify(initial));
    const loaded = await repository.load();
    expect(loaded.state).toEqual(initial);
    expect(loaded.warnings).toHaveLength(1);
  });

  it("preserves damaged bytes before repairing from a validated previous snapshot", async () => {
    const files = new FakeFiles();
    const repository = new LibraryRepository(files, "易记题库", "device-A");
    const initial = state();
    files.files.set(repository.shardPath, "{interrupted");
    files.files.set(repository.shardPath.replace(".json", ".previous.json"), JSON.stringify(initial.state));
    await repository.save(recordAnswerEvent(initial.state, initial.id, true, { id: "event", now: NOW }));
    expect([...files.files.entries()].find(([path]) => path.includes(".corrupt-"))?.[1]).toBe("{interrupted");
    expect(getBankStudyData((await repository.load()).state!).questions[initial.id]?.attempts).toBe(1);
  });

  it("stops on unrecoverable data and prevents hidden/parent storage roots", async () => {
    const files = new FakeFiles();
    const repository = new LibraryRepository(files, "易记题库", "device-A");
    files.files.set(repository.shardPath, "broken");
    await expect(repository.save(state().state)).rejects.toThrow("原文件未被覆盖");
    expect(files.writes).toEqual([]);
    for (const path of ["../notes", ".obsidian", "root/../other", "root//other"]) expect(() => safeLibraryRoot(path)).toThrow();
  });
});

describe("external managed Markdown edits", () => {
  it("recognizes untouched notes and stages edited text without changing the active question", () => {
    const initial = state();
    const record = getBank(initial.state).questions[initial.id]!;
    const revision = record.revisions[record.activeRevisionId]!;
    const markdown = renderQuestionNote(revision);
    expect(inspectQuestionNote(markdown, record).unchanged).toBe(true);
    const changed = inspectQuestionNote(markdown.replace("参考答案：A", "参考答案：B").replace("原解释", "核对后的解释"), record);
    expect(changed.issues).toEqual([]);
    expect(changed.input.answers).toEqual(["B"]);
    let next = stageCandidates(initial.state, [changed.input], { batchId: "note-change", targetQuestionIds: [initial.id], issues: [changed.issues] });
    expect(getActiveQuestions(next)[0]?.answers).toEqual(["A"]);
    const candidateId = Object.keys(getBank(next).candidates)[0]!;
    expect(acceptCandidate(next, candidateId).status).toBe("invalid");
    next = acceptCandidate(next, candidateId, { reason: "核对后纠正答案", now: NOW }).state;
    expect(getActiveQuestions(next)[0]?.answers).toEqual(["B"]);
    expect(Object.keys(getBank(next).questions)).toHaveLength(1);
  });

  it("leaves malformed edits in the review queue and does not accept altered identity metadata", () => {
    const initial = state();
    const record = getBank(initial.state).questions[initial.id]!;
    const markdown = renderQuestionNote(record.revisions[record.activeRevisionId]!);
    expect(inspectQuestionNote(markdown.replace("> 参考答案：A", "> 参考答案："), record).issues).toContain("缺少答案");
    const modifiedId = markdown.replace(`"questionId": "${initial.id}"`, '"questionId": "other"');
    expect(inspectQuestionNote(modifiedId, record).issues.some((issue) => issue.includes("身份"))).toBe(true);
  });
});

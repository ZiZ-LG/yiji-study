import { describe, expect, it } from "vitest";
import { createEmptyStudyData, recordAnswer, saveCursor, toggleBookmark } from "../src/state/study-state";
import { startExam } from "../src/state/exam-state";
import {
  acceptCandidate, commitQuestion, composePaper, contentDigest, createBackup, createBank, createLibrary, deleteBank,
  freezeOriginalPaper, getActiveQuestions, getBank, getBankStudyData, getPaperQuestions, getReviewQueue, getReviewSchedules,
  getLearningEvidence, gradePaper, markReviewAgain, mergeLibrary, migrateLegacy, parseLibrary, recordAnswerEvent, recordStudyTransition,
  resolveLibraryConflict, restoreBackup, restoreBankAsCopy, selectBank, setReviewEnabled, stageCandidates, submitPaperAttempt,
  toExamPaper, updateCandidate, validateLibrary,
} from "../src/library";
import type { LibraryState, QuestionInput } from "../src/library";

const T0 = "2026-11-04T12:00:00.000Z";
const day = (n: number) => new Date(Date.parse(T0) + n * 86_400_000).toISOString();
const question = (stem = "下列哪项正确？"): QuestionInput => ({ type: "single", stem,
  options: [{ key: "A", text: "第一项" }, { key: "B", text: "第二项" }], answers: ["A"], domain: "第一章",
  sources: [{ file: "试卷.pdf", page: 1, ordinal: "1" }], answerOrigin: "source" });
function library(): LibraryState { return createBank(createLibrary("device-A"), "甲考试", { id: "bank-A", now: T0 }); }
function withQuestion(input = question()): { state: LibraryState; id: string; revisionId: string } {
  const result = commitQuestion(library(), input, { now: T0 });
  expect(result.status).toBe("created");
  return { state: result.state, id: result.questionId!, revisionId: result.revisionId! };
}

describe("library question lifecycle", () => {
  it("isolates banks with identical domain names, bookmarks and attempts", () => {
    const first = withQuestion();
    let state = recordAnswerEvent(first.state, first.id, false, { id: "event-a", now: T0 });
    state = createBank(state, "乙考试", { id: "bank-B", now: T0 });
    const second = commitQuestion(state, question(), { now: T0 });
    state = second.state;
    expect(getBankStudyData(state).questions).toEqual({});
    expect(getActiveQuestions(state).map((q) => q.id)).toEqual([second.questionId]);
    expect(getBankStudyData(selectBank(state, "bank-A")).questions[first.id]?.wrongCount).toBe(1);
  });

  it("retains missing-answer candidates, accepts corrections once, and merges exact duplicate sources", () => {
    let state = stageCandidates(library(), [{ ...question(), answers: [] }], { batchId: "batch-1" });
    const id = Object.keys(getBank(state).candidates)[0]!;
    expect(acceptCandidate(state, id).status).toBe("invalid");
    expect(Object.keys(getBank(state).questions)).toHaveLength(0);
    state = updateCandidate(state, id, question());
    const accepted = acceptCandidate(state, id, { now: T0 });
    expect(accepted.status).toBe("created");
    expect(acceptCandidate(accepted.state, id).state).toEqual(accepted.state);
    const duplicated = commitQuestion(accepted.state, { ...question(), sources: [{ file: "另一试卷.pdf", page: 2 }] }, { now: day(1) });
    expect(duplicated.status).toBe("duplicate");
    expect(duplicated.questionId).toBe(accepted.questionId);
    expect(getActiveQuestions(duplicated.state)[0]?.sources).toHaveLength(2);
    expect(Object.keys(getBank(duplicated.state).questions)).toHaveLength(1);
    expect(stageCandidates(duplicated.state, [question()], { batchId: "batch-1" })).toEqual(duplicated.state);
  });

  it("requires a decision for answer conflicts and preserves stable identity across revisions", () => {
    const first = withQuestion();
    const changed = { ...question(), answers: ["B"] };
    expect(commitQuestion(first.state, changed).status).toBe("conflict");
    expect(commitQuestion(first.state, changed, { questionId: first.id }).issues).toContain("修改答案时请填写理由");
    const revised = commitQuestion(first.state, changed, { questionId: first.id, reason: "核对原答案表", now: day(1) });
    expect(revised.status).toBe("revised");
    expect(revised.questionId).toBe(first.id);
    expect(getBank(revised.state).questions[first.id]?.revisions[first.revisionId]?.answers).toEqual(["A"]);
    expect(getActiveQuestions(revised.state)[0]?.answers).toEqual(["B"]);
  });

  it("prevents missing required images from entering the scoring pool", () => {
    const input = { ...question(), attachmentIds: ["diagram"] };
    expect(commitQuestion(library(), input).issues).toContain("缺少题图：diagram");
    let state = library();
    getBank(state).attachments.diagram = { id: "diagram", path: "易记题库/图.png", mimeType: "image/png", dataBase64: "aGk=" };
    state = commitQuestion(state, input, { now: T0 }).state;
    delete getBank(state).attachments.diagram;
    expect(getActiveQuestions(state)).toHaveLength(0);
    expect(() => createBackup(state)).toThrow("缺少必需附件");
  });
});

describe("frozen papers and score rules", () => {
  it("varies composed papers by stable paper seed without changing options or frozen previews", () => {
    let state = library();
    for (let index = 0; index < 18; index += 1) state = commitQuestion(state, question(`候选题 ${index}`), { now: T0 }).state;
    const settings = { title: "随机练习", counts: { single: 5 }, durationMinutes: 30, now: T0 };
    const preview = composePaper(state, { ...settings, id: "paper-seed-A" }).paper!;
    const repeat = composePaper(state, { ...settings, id: "paper-seed-A" }).paper!;
    const another = composePaper(state, { ...settings, id: "paper-seed-B" }).paper!;
    expect(repeat).toEqual(preview);
    expect(another.items.map((item) => item.questionId)).not.toEqual(preview.items.map((item) => item.questionId));
    expect(new Set(preview.items.map((item) => item.questionId)).size).toBe(5);
    expect(preview.items.every((item) => item.snapshot.options.map((option) => option.key).join() === "A,B")).toBe(true);
    const frozen = composePaper(state, { ...settings, id: "paper-seed-A" });
    expect(getBank(frozen.state).papers[preview.id]).toEqual(preview);
  });
  it("never exposes an answer explanation through the pre-answer source note", () => {
    const first = withQuestion({ ...question(), explanation: "正确答案为 A，因为……" });
    expect(getActiveQuestions(first.state)[0]?.sourceNote).toBeUndefined();
  });

  it("rejects a partial original paper and requires explicit source completeness confirmation", () => {
    let state = stageCandidates(library(), [question("第一题"), question("第二题")], { batchId: "original-batch" });
    const ids = Object.keys(getBank(state).candidates);
    state = acceptCandidate(state, ids[0]!, { now: T0 }).state;
    const options = { title: "原卷", sourceFile: "卷.pdf", durationMinutes: 30, completenessConfirmed: true,
      declaredQuestionCount: 2, items: [{ candidateId: ids[0]!, ordinal: 1, points: 2 }] };
    expect(freezeOriginalPaper(state, options).paper).toBeUndefined();
    state = acceptCandidate(state, ids[1]!, { now: T0 }).state;
    options.items.push({ candidateId: ids[1]!, ordinal: 2, points: 3 });
    expect(freezeOriginalPaper(state, { ...options, completenessConfirmed: false }).paper).toBeUndefined();
    const completed = freezeOriginalPaper(state, { ...options, declaredTotalScore: 10, now: T0 });
    expect(completed.paper).toMatchObject({ totalScore: 5, declaredTotalScore: 10, kind: "original" });
  });
  it("reports shortages without changing state, then grades frozen revisions by the selected rule", () => {
    const multi: QuestionInput = { ...question(), type: "multiple", options: [
      { key: "A", text: "甲" }, { key: "B", text: "乙" }, { key: "C", text: "丙" }], answers: ["A", "B"] };
    const first = withQuestion(multi);
    const shortage = composePaper(first.state, { title: "不足", counts: { multiple: 2 }, durationMinutes: 30 });
    expect(shortage.shortages.multiple).toBe(1);
    expect(shortage.state).toBe(first.state);
    const composed = composePaper(first.state, { title: "部分分", counts: { multiple: 1 }, points: { multiple: 4 }, scoreMode: "proportional", durationMinutes: 30, now: T0 });
    const paper = composed.paper!;
    expect(gradePaper(paper, { "1": ["A"] }).score).toBe(2);
    expect(gradePaper(paper, { "1": ["A", "C"] }).score).toBe(0);
    expect(gradePaper(paper, {}).answeredCount).toBe(0);
    expect(gradePaper({ ...paper, scoreMode: "exact" }, { "1": ["A"] }).score).toBe(0);
    const revised = commitQuestion(composed.state, { ...multi, answers: ["C"] }, { questionId: first.id, reason: "修正", now: day(1) });
    expect(getActiveQuestions(revised.state)[0]?.answers).toEqual(["C"]);
    expect(getPaperQuestions(getBank(revised.state).papers[paper.id]! ).get(first.id)?.answers).toEqual(["A", "B"]);
    expect(toExamPaper(paper).scoreMode).toBe("proportional");
  });

  it("supports 200 questions and 150 points without old exam limits", () => {
    let state = library();
    for (let index = 0; index < 200; index += 1) state = commitQuestion(state, question(`第 ${index + 1} 道自制题`), { now: T0 }).state;
    const result = composePaper(state, { title: "大卷", durationMinutes: 120, counts: { single: 200 }, points: { single: 0.75 }, now: T0 });
    expect(result.paper?.items).toHaveLength(200);
    expect(result.paper?.totalScore).toBe(150);
    expect(parseLibrary(JSON.stringify(result.state))).not.toBeNull();
  });

  it("archives each attempt and records the frozen revision once when submitted", () => {
    const first = withQuestion();
    const composed = composePaper(first.state, { title: "测验", counts: { single: 1 }, durationMinutes: 30, now: T0 });
    const paper = composed.paper!;
    let state = composed.state;
    getBank(state).examSessions[paper.id] = { ...startExam(toExamPaper(paper), Date.parse(T0)), answers: { "1": ["A"] } };
    state = commitQuestion(state, { ...question(), answers: ["B"] }, { questionId: first.id, reason: "更新", now: day(1) }).state;
    state = submitPaperAttempt(state, paper.id, day(2));
    expect(getBankStudyData(state).questions[first.id]?.correctCount).toBe(1);
    expect(Object.values(state.events)[0]?.revisionId).toBe(first.revisionId);
    expect(submitPaperAttempt(state, paper.id, day(3))).toBe(state);
    const previous = getBankStudyData(state);
    const next = { ...previous, exams: { [paper.id]: startExam(toExamPaper(paper), Date.parse(day(3))) } };
    state = recordStudyTransition(state, previous, next);
    expect(Object.keys(getBank(state).examHistory)).toHaveLength(2);
  });
});

describe("review scheduling", () => {
  it("resets uncertainty without counting a second answer", () => {
    const first = withQuestion();
    let state = setReviewEnabled(first.state, true, undefined, T0);
    state = recordAnswerEvent(state, first.id, true, { now: T0, id: "answer" });
    state = recordAnswerEvent(state, first.id, true, { now: day(1), id: "answer-next" });
    state = markReviewAgain(state, first.id, { now: day(1.1), id: "uncertain" });
    expect(getBankStudyData(state).questions[first.id]?.attempts).toBe(2);
    expect(getReviewSchedules(state)[0]).toMatchObject({ stage: 0, dueAt: day(2.1) });
    expect(validateLibrary(state).valid).toBe(true);
  });
  it("keeps early answers due, advances overdue answers one stage, resets guesses and wrong answers", () => {
    const first = withQuestion();
    let state = setReviewEnabled(first.state, true, undefined, T0);
    state = recordAnswerEvent(state, first.id, true, { now: T0, id: "answer-0" });
    expect(getReviewSchedules(state)[0]).toMatchObject({ stage: 0, dueAt: day(1) });
    state = recordAnswerEvent(state, first.id, true, { now: day(0.5), id: "answer-early" });
    expect(getReviewSchedules(state)[0]).toMatchObject({ stage: 0, dueAt: day(1) });
    state = recordAnswerEvent(state, first.id, true, { now: day(10), id: "answer-overdue" });
    expect(getReviewSchedules(state)[0]).toMatchObject({ stage: 1, dueAt: day(13) });
    state = recordAnswerEvent(state, first.id, true, { now: day(10.1), id: "answer-guessed", guessed: true });
    expect(getReviewSchedules(state)[0]).toMatchObject({ stage: 0, dueAt: day(11.1) });
    state = recordAnswerEvent(state, first.id, false, { now: day(11), id: "answer-wrong" });
    expect(getReviewSchedules(state)[0]?.dueAt).toBe(day(12));
    expect(getReviewQueue(state, day(12))).toHaveLength(1);
    expect(getReviewQueue(setReviewEnabled(state, false), day(12))).toHaveLength(0);
  });

  it("caps at 30 days and starts a fresh interval for a substantive revision", () => {
    const first = withQuestion();
    let state = setReviewEnabled(first.state, true, undefined, T0);
    for (const [index, at] of [0, 1, 4, 11, 25, 55].entries()) state = recordAnswerEvent(state, first.id, true, { now: day(at), id: `answer-${index}` });
    expect(getReviewSchedules(state)[0]).toMatchObject({ stage: 4, dueAt: day(85) });
    const cosmetic = commitQuestion(state, { ...question(), domain: "第二章" }, { questionId: first.id, now: day(56) });
    expect(getReviewSchedules(cosmetic.state)[0]).toMatchObject({ stage: 4, dueAt: day(85) });
    const revised = commitQuestion(cosmetic.state, { ...question(), answers: ["B"] }, { questionId: first.id, reason: "修正答案", now: day(57) });
    expect(getReviewSchedules(revised.state)[0]).toMatchObject({ stage: 0, dueAt: day(58) });
  });
});

describe("merge, legacy migration and backup integrity", () => {
  it("recognizes edited-and-accepted candidates as descendants of older pending drafts", () => {
    const old = stageCandidates(library(), [{ ...question(), answers: [] }], { batchId: "batch" });
    const id = Object.keys(getBank(old).candidates)[0]!;
    const edited = updateCandidate(old, id, question());
    const accepted = acceptCandidate(edited, id, { now: T0 }).state;
    const merged = mergeLibrary(accepted, old);
    expect(merged.conflicts).toEqual([]);
    expect(getBank(merged).candidates[id]?.status).toBe("accepted");
    expect(mergeLibrary(old, accepted).conflicts).toEqual([]);
  });

  it("does not revert a review setting when another device edits unrelated question content", () => {
    const first = withQuestion();
    const enabled = setReviewEnabled(first.state, true, undefined, day(1));
    const edited = commitQuestion(first.state, { ...question(), domain: "第二章" }, { questionId: first.id, now: day(2) }).state;
    expect(getBank(mergeLibrary(enabled, edited)).reviewEnabled).toBe(true);
  });

  it("keeps deletion tombstones through stale sync and restores a backup under a fresh bank identity", () => {
    const first = withQuestion();
    const source = recordAnswerEvent(first.state, first.id, true, { id: "answer", now: T0 });
    const backup = createBackup(source, T0);
    expect(() => deleteBank(source, "bank-A", { confirmName: "别的名字" })).toThrow("名称不匹配");
    const deleted = deleteBank(source, "bank-A", { confirmName: "甲考试", now: day(1) });
    expect(deleted.activeBankId).toBeNull();
    expect(getActiveQuestions(deleted)).toEqual([]);
    expect(getBankStudyData(deleted).questions).toEqual({});
    expect(mergeLibrary(source, deleted).activeBankId).toBeNull();
    const restored = restoreBankAsCopy(deleted, restoreBackup(backup), "bank-A", { id: "bank-restored", now: day(2) });
    expect(restored.banks["bank-A"]?.deletedAt).toBe(day(1));
    expect(getBankStudyData(restored).questions[first.id]?.attempts).toBe(1);
    expect(mergeLibrary(restored, source).activeBankId).toBe("bank-restored");
    expect(validateLibrary(restored).valid).toBe(true);
  });
  it("does not mistake a corrected exam answer for a conflict with a stale device", () => {
    const first = withQuestion();
    const composed = composePaper(first.state, { title: "测验", counts: { single: 1 }, durationMinutes: 30, now: T0 });
    const paper = composed.paper!;
    let state = composed.state;
    let before = getBankStudyData(state);
    const started = startExam(toExamPaper(paper), Date.parse(T0));
    state = recordStudyTransition(state, before, { ...before, exams: { [paper.id]: { ...started, answers: { "1": ["A"] } } } }, { now: T0 });
    const stale = state;
    before = getBankStudyData(state);
    state = recordStudyTransition(state, before, { ...before, exams: { [paper.id]: { ...started, answers: { "1": ["B"] } } } }, { now: day(0.01) });
    const merged = mergeLibrary(state, stale);
    expect(merged.conflicts).toEqual([]);
    expect(getBankStudyData(merged).exams?.[paper.id]?.answers).toEqual({ "1": ["B"] });
    expect(mergeLibrary(stale, state).conflicts).toEqual([]);
  });

  it("keeps both concurrently changed exam answers and joins their ancestry on resolution", () => {
    const first = withQuestion();
    const composed = composePaper(first.state, { title: "测验", counts: { single: 1 }, durationMinutes: 30, now: T0 });
    const paper = composed.paper!;
    const started = startExam(toExamPaper(paper), Date.parse(T0));
    const initial = getBankStudyData(composed.state);
    const base = recordStudyTransition(composed.state, initial, { ...initial, exams: { [paper.id]: started } }, { now: T0 });
    const snapshot = getBankStudyData(base);
    const left = recordStudyTransition(base, snapshot, { ...snapshot, exams: { [paper.id]: { ...started, answers: { "1": ["A"] } } } }, { now: day(0.01) });
    const right = recordStudyTransition({ ...base, deviceId: "device-B" }, snapshot, { ...snapshot, exams: { [paper.id]: { ...started, answers: { "1": ["B"] } } } }, { now: day(0.02) });
    const merged = mergeLibrary(left, right);
    const conflict = merged.conflicts.find((item) => item.kind === "exam")!;
    expect(conflict).toBeDefined();
    const resolved = resolveLibraryConflict(merged, conflict.id, "remote");
    expect(getBankStudyData(resolved).exams?.[paper.id]?.answers).toEqual({ "1": ["B"] });
    expect(mergeLibrary(resolved, left).conflicts.filter((item) => !item.resolved)).toEqual([]);
    expect(validateLibrary(resolved).valid).toBe(true);
  });
  it("merges independent device events once and recognizes an ancestor head", () => {
    const first = withQuestion();
    const other = { ...first.state, deviceId: "device-B" };
    const left = recordAnswerEvent(first.state, first.id, false, { id: "left-answer", now: T0 });
    let right = recordAnswerEvent(other, first.id, true, { id: "right-answer", now: day(1) });
    right = commitQuestion(right, { ...question(), domain: "第二章" }, { questionId: first.id, now: day(2) }).state;
    const merged = mergeLibrary(left, right);
    expect(merged.conflicts).toEqual([]);
    expect(getBankStudyData(merged).questions[first.id]).toMatchObject({ attempts: 2, correctCount: 1, wrongCount: 1, isWrong: false });
    expect(getActiveQuestions(merged)[0]?.domain).toBe("第二章");
    expect(mergeLibrary(merged, left)).toEqual(merged);
    expect(mergeLibrary(merged, right)).toEqual(merged);
  });

  it("preserves divergent revision branches and withholds conflicted questions from scoring", () => {
    const first = withQuestion();
    const left = commitQuestion(first.state, { ...question(), stem: "左修订" }, { questionId: first.id, now: day(1) }).state;
    const right = commitQuestion(first.state, { ...question(), stem: "右修订" }, { questionId: first.id, now: day(1) }).state;
    const merged = mergeLibrary(left, right);
    expect(Object.keys(getBank(merged).questions[first.id]!.revisions)).toHaveLength(3);
    expect(getActiveQuestions(merged)).toHaveLength(0);
    const conflict = merged.conflicts.find((item) => item.kind === "question-head")!;
    const resolved = resolveLibraryConflict(merged, conflict.id, "remote");
    expect(getActiveQuestions(resolved)[0]?.stem).toBe("右修订");
    expect(getActiveQuestions(mergeLibrary(resolved, left))[0]?.stem).toBe("右修订");
  });

  it("quarantines conflicting identical event IDs instead of choosing one silently", () => {
    const first = withQuestion();
    const left = recordAnswerEvent(first.state, first.id, true, { id: "same-event", now: T0 });
    const right = recordAnswerEvent(first.state, first.id, false, { id: "same-event", now: T0 });
    const merged = mergeLibrary(left, right);
    expect(merged.conflicts[0]?.kind).toBe("event");
    expect(getBankStudyData(merged).questions[first.id]).toBeUndefined();
    const resolved = resolveLibraryConflict(merged, merged.conflicts[0]!.id, "local");
    expect(getBankStudyData(resolved).questions[first.id]?.correctCount).toBe(1);
  });

  it("adapts existing UI transitions idempotently and retains bookmarks and cursors", () => {
    const first = withQuestion();
    const previous = getBankStudyData(first.state);
    const next = saveCursor(toggleBookmark(recordAnswer(previous, first.id, false, T0).data, first.id), "type:single", first.id, T0);
    const updated = recordStudyTransition(first.state, previous, next, { now: T0 });
    expect(getBankStudyData(updated)).toEqual(next);
    expect(recordStudyTransition(updated, previous, next, { now: T0 })).toEqual(updated);
  });

  it("preserves legacy totals without replaying the retained 500 history entries", () => {
    const first = withQuestion();
    const legacyQuestion = getActiveQuestions(first.state)[0]!;
    let legacy = createEmptyStudyData();
    for (let index = 0; index < 510; index += 1) legacy = recordAnswer(legacy, legacyQuestion.id, index % 2 === 0, T0).data;
    legacy = toggleBookmark(saveCursor(legacy, "type:single", legacyQuestion.id, T0), legacyQuestion.id);
    const migrated = migrateLegacy(legacy, [legacyQuestion], [], { deviceId: "device-A", now: T0 });
    expect(getBankStudyData(migrated).questions[legacyQuestion.id]?.attempts).toBe(510);
    expect(getBankStudyData(migrated).history).toHaveLength(500);
    expect(getReviewSchedules(migrated)).toEqual([]);
    const other = migrateLegacy(legacy, [legacyQuestion], [], { deviceId: "device-B", now: day(1) });
    const merged = mergeLibrary(migrated, other);
    expect(merged.conflicts).toEqual([]);
    expect(getBankStudyData(merged).questions[legacyQuestion.id]?.attempts).toBe(510);
    const next = recordAnswerEvent(merged, legacyQuestion.id, true, { now: day(2), id: "new-answer" });
    expect(getBankStudyData(next).questions[legacyQuestion.id]?.attempts).toBe(511);
  });

  it("round-trips complete backups and rejects checksum tampering and invalid data", () => {
    const first = withQuestion();
    const backup = createBackup(first.state, T0);
    expect(restoreBackup(JSON.stringify(backup))).toEqual(first.state);
    const damaged = JSON.parse(JSON.stringify(backup));
    damaged.library.banks["bank-A"].questions[first.id].revisions[first.revisionId].answers = ["B"];
    expect(() => restoreBackup(damaged)).toThrow("校验和");
    damaged.checksum = contentDigest(damaged.library);
    expect(() => restoreBackup(damaged)).toThrow("内容无效");
    expect(parseLibrary({ version: 2, banks: {} })).toBeNull();
    expect(validateLibrary(first.state).valid).toBe(true);
  });

  it("refuses to silently sanitize damaged legacy counters during migration", () => {
    const first = withQuestion();
    const legacy = recordAnswer(createEmptyStudyData(), first.id, true, T0).data;
    legacy.questions[first.id]!.attempts = -1;
    expect(() => migrateLegacy(legacy, getActiveQuestions(first.state))).toThrow("迁移已停止");
  });
});

describe("observed learning evidence", () => {
  it("separates first answers, delayed checks and immediate repeats by learning content", () => {
    const first = withQuestion();
    let state = recordAnswerEvent(first.state, first.id, true, { id: "first", now: T0 });
    state = recordAnswerEvent(state, first.id, false, { id: "immediate", now: day(0.5) });
    expect(getLearningEvidence(state).delayedAnswers.sampleCount).toBe(0);
    state = recordAnswerEvent(state, first.id, false, { id: "delayed", now: day(2) });
    const evidence = getLearningEvidence(state);
    expect(evidence.firstAnswers).toEqual({ sampleCount: 1, correctCount: 1, accuracy: 100 });
    expect(evidence.delayedAnswers).toEqual({ sampleCount: 1, correctCount: 0, accuracy: 0 });
    expect(evidence.repeatedWrongQuestionIds).toEqual([first.id]);
    expect(evidence.unretestedQuestionIds).toEqual([]);
    const revised = commitQuestion(state, { ...question(), answers: ["B"] }, { questionId: first.id, reason: "修订", now: day(3) });
    state = recordAnswerEvent(revised.state, first.id, true, { id: "new-version", now: day(3) });
    expect(getLearningEvidence(state).firstAnswers.sampleCount).toBe(2);
    expect(getLearningEvidence(state).unretestedQuestionIds).toEqual([first.id]);
  });

  it("does not invent first-attempt or delayed outcomes from incomplete legacy totals", () => {
    const first = withQuestion();
    let old = createEmptyStudyData();
    for (let index = 0; index < 510; index += 1) old = recordAnswer(old, first.id, true, T0).data;
    let state = migrateLegacy(old, getActiveQuestions(first.state), [], { now: T0 });
    state = recordAnswerEvent(state, first.id, true, { id: "new-1", now: day(1) });
    expect(getLearningEvidence(state)).toMatchObject({ firstAnswers: { sampleCount: 0 }, delayedAnswers: { sampleCount: 0 },
      legacyAttemptCount: 510, legacyHistoryCount: 500, legacyHistoryIncomplete: true, legacyExcludedFromFirstAndDelayed: true });
    state = recordAnswerEvent(state, first.id, true, { id: "new-2", now: day(2) });
    expect(getLearningEvidence(state).delayedAnswers.sampleCount).toBe(1);
  });
});

import type { ExamPaper } from "../content/exam-paper";
import type { Question, QuestionType } from "../domain/question";
import { createEmptyStudyData, parseStudyData, recordAnswer } from "../state/study-state";
import type { QuestionProgress, StudyDataV1 } from "../state/study-state";
import type {
  AnswerEvidence, CommitOptions, CommitResult, ComposeOptions, ComposeResult, DomainLearningEvidence, FrozenPaper, ImportCandidate, LearningEvidence,
  LibraryBackup, LibraryBank, LibraryConflict, LibraryQuestion, LibraryState, LibraryStudyEvent,
  OriginalPaperOptions, PaperGrade, QuestionInput, QuestionRevision, RecordAnswerOptions, ReviewSchedule, ValidationResult,
} from "./types";

export * from "./types";

const DAY = 86_400_000;
export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;
export const LEGACY_BANK_ID = "electricity-trader-level-4";
export const MAX_PAPER_QUESTIONS = 2000;
const TYPES: QuestionType[] = ["single", "multiple", "judge"];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const timestamp = (now?: string): string => {
  const value = now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(value))) throw new Error("日期无效");
  return new Date(value).toISOString();
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const safeId = (value: unknown): value is string => typeof value === "string" && value.length > 0
  && value.length <= 256 && !["__proto__", "constructor", "prototype"].includes(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const normalize = (text: string): string => text.normalize("NFKC").replace(/\s+/g, "").trim();

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Integrity checksum, not an authentication signature. */
export function contentDigest(value: unknown): string {
  const text = typeof value === "string" ? value : stableStringify(value);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

export function newLibraryId(prefix = "id"): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

export function createLibrary(deviceId = newLibraryId("device")): LibraryState {
  if (!safeId(deviceId)) throw new Error("设备标识无效");
  return { version: 2, deviceId, activeBankId: null, banks: {}, events: {}, conflicts: [] };
}

export function createBank(state: LibraryState, name: string, options: { id?: string; now?: string } = {}): LibraryState {
  const title = name.trim();
  if (!title) throw new Error("请填写题库名称");
  const id = options.id ?? newLibraryId("bank");
  if (!safeId(id) || state.banks[id]) throw new Error("题库标识已存在或无效");
  const now = timestamp(options.now);
  const baseline = createEmptyStudyData();
  const bank: LibraryBank = { id, name: title, createdAt: now, updatedAt: now, nameUpdatedAt: now, reviewUpdatedAt: now, reviewEnabled: false,
    questions: {}, candidates: {}, papers: {}, attachments: {}, baseline,
    baselineId: contentDigest(baseline), examSessions: {}, examHistory: {}, examWrites: {}, examHeads: {} };
  return { ...state, activeBankId: id, banks: { ...state.banks, [id]: bank } };
}

export function getActiveBank(state: LibraryState): LibraryBank | null {
  const bank = state.activeBankId ? state.banks[state.activeBankId] : undefined;
  return bank && !bank.deletedAt ? bank : null;
}

export function getBank(state: LibraryState, bankId = state.activeBankId): LibraryBank {
  const bank = bankId ? state.banks[bankId] : undefined;
  if (!bank || bank.deletedAt) throw new Error("请先选择可用题库");
  return bank;
}

function updateBank(state: LibraryState, bank: LibraryBank): LibraryState {
  return { ...state, banks: { ...state.banks, [bank.id]: bank } };
}

export function selectBank(state: LibraryState, bankId: string): LibraryState {
  getBank(state, bankId);
  return { ...state, activeBankId: bankId };
}

export function renameBank(state: LibraryState, bankId: string, name: string, now?: string): LibraryState {
  if (!name.trim()) throw new Error("请填写题库名称");
  return updateBank(state, { ...getBank(state, bankId), name: name.trim(), updatedAt: timestamp(now), nameUpdatedAt: timestamp(now) });
}

export function deleteBank(state: LibraryState, bankId: string, options: { confirmName: string; now?: string }): LibraryState {
  const bank = getBank(state, bankId);
  if (options.confirmName !== bank.name) throw new Error("题库名称不匹配，未删除");
  const next = updateBank(state, { ...bank, deletedAt: timestamp(options.now) });
  if (next.activeBankId === bankId) next.activeBankId = Object.values(next.banks).find((entry) => !entry.deletedAt)?.id ?? null;
  return next;
}

/** Restore a bank under a new identity so an old deletion tombstone cannot resurrect it. */
export function restoreBankAsCopy(state: LibraryState, source: LibraryState, sourceBankId: string,
  options: { id?: string; name?: string; now?: string } = {}): LibraryState {
  const checked = validateLibrary(source);
  if (!checked.valid) throw new Error(`恢复源无效：${checked.issues.join("；")}`);
  const original = source.banks[sourceBankId];
  if (!original) throw new Error("备份中没有该题库");
  const id = options.id ?? newLibraryId("bank");
  if (!safeId(id) || state.banks[id]) throw new Error("恢复目标题库标识已存在或无效");
  const now = timestamp(options.now);
  const { deletedAt: _deleted, ...content } = clone(original);
  const bank: LibraryBank = { ...content, id, name: options.name?.trim() || `${original.name}（恢复）`,
    createdAt: now, updatedAt: now, nameUpdatedAt: now, reviewUpdatedAt: now };
  const digestMap = new Map<string, string>();
  for (const paper of Object.values(bank.papers)) {
    const oldDigest = paper.digest;
    paper.bankId = id;
    paper.digest = paperDigest(paper);
    digestMap.set(oldDigest, paper.digest);
  }
  const adjustAttempt = (attempt: LibraryBank["examSessions"][string]) => ({ ...attempt, paperDigest: digestMap.get(attempt.paperDigest) ?? attempt.paperDigest });
  bank.examSessions = Object.fromEntries(Object.entries(bank.examSessions).map(([key, attempt]) => [key, adjustAttempt(attempt)]));
  bank.examHistory = Object.fromEntries(Object.entries(bank.examHistory).map(([key, attempt]) => [key, adjustAttempt(attempt)]));
  bank.examWrites = Object.fromEntries(Object.entries(bank.examWrites).map(([key, write]) => [key, { ...write, attempt: adjustAttempt(write.attempt) }]));
  const events = { ...state.events };
  const eventIds = new Map<string, string>();
  for (const event of Object.values(source.events)) if (event.bankId === sourceBankId) {
    const eventId = `restored_event_${contentDigest({ bankId: id, eventId: event.id })}`;
    eventIds.set(event.id, eventId);
    events[eventId] = { ...clone(event), id: eventId, bankId: id };
  }
  const conflicts = source.conflicts.filter((entry) => entry.bankId === sourceBankId).map((entry): LibraryConflict => {
    const adjust = (value: unknown): unknown => {
      if (!isRecord(value)) return value;
      if (entry.kind === "event") return { ...value, id: eventIds.get(String(value.id)) ?? value.id, bankId: id };
      if (entry.kind === "paper") {
        const paper = { ...value, bankId: id } as unknown as FrozenPaper;
        return { ...paper, digest: paperDigest(paper) };
      }
      if (entry.kind === "exam" || entry.kind === "exam-write") return { ...value, attempt: adjustAttempt(value.attempt as LibraryBank["examSessions"][string]) };
      return value;
    };
    return { ...clone(entry), id: `restored_conflict_${contentDigest({ bankId: id, id: entry.id })}`, bankId: id,
      entityId: entry.kind === "event" ? eventIds.get(entry.entityId) ?? entry.entityId : entry.kind === "baseline" ? id : entry.entityId,
      local: adjust(entry.local), remote: adjust(entry.remote) };
  });
  const next: LibraryState = { ...state, activeBankId: id, banks: { ...state.banks, [id]: bank }, events, conflicts: [...state.conflicts, ...conflicts] };
  const validated = validateLibrary(next);
  if (!validated.valid) throw new Error(`恢复后校验失败：${validated.issues.join("；")}`);
  return next;
}

export function questionFingerprint(input: QuestionInput): string {
  return contentDigest({ type: input.type, stem: normalize(input.stem),
    options: input.options.map((option) => ({ key: option.key, text: normalize(option.text) })),
    answers: [...input.answers].sort(), attachmentIds: [...(input.attachmentIds ?? [])].sort(),
    ruleVersion: input.ruleVersion ?? "" });
}

export function validateQuestion(input: QuestionInput, bank?: LibraryBank): string[] {
  if (!isQuestionInput(input)) return ["题目字段不完整或类型无效"];
  const issues: string[] = [];
  if (!TYPES.includes(input.type)) issues.push("暂不支持此题型");
  if (typeof input.stem !== "string" || !input.stem.trim()) issues.push("题干为空");
  if (typeof input.domain !== "string" || !input.domain.trim()) issues.push("请填写知识点");
  if (!Array.isArray(input.options) || input.options.length < 2) issues.push("至少需要两个选项");
  const keys = new Set<string>();
  for (const option of input.options ?? []) {
    if (!option || typeof option.key !== "string" || !option.key.trim() || typeof option.text !== "string" || !option.text.trim()) issues.push("选项编号或内容为空");
    if (keys.has(option.key)) issues.push(`选项 ${option.key} 重复`);
    keys.add(option.key);
  }
  if (!Array.isArray(input.answers) || !input.answers.length) issues.push("缺少答案");
  if (new Set(input.answers).size !== input.answers.length) issues.push("答案重复");
  if (input.answers.some((answer) => !keys.has(answer))) issues.push("答案不在选项中");
  if ((input.type === "single" || input.type === "judge") && input.answers.length !== 1) issues.push("单选或判断只能有一个答案");
  if (input.type === "judge" && (input.options.length !== 2 || !keys.has("对") || !keys.has("错"))) issues.push("判断题选项必须为对、错");
  for (const id of input.attachmentIds ?? []) if (bank && !bank.attachments[id]) issues.push(`缺少题图：${id}`);
  return [...new Set(issues)];
}

function activeRevision(question: LibraryQuestion): QuestionRevision {
  const revision = question.revisions[question.activeRevisionId];
  if (!revision) throw new Error("题目修订版不存在");
  return revision;
}

export function hasQuestionConflict(state: LibraryState, bankId: string, questionId: string): boolean {
  return state.conflicts.some((conflict) => !conflict.resolved && conflict.bankId === bankId
    && ((conflict.kind === "question-head" && conflict.entityId === questionId)
      || (conflict.kind === "revision" && getBank(state, bankId).questions[questionId]?.revisions[conflict.entityId])));
}

export function toQuestion(revision: QuestionRevision): Question {
  const first = revision.sources?.[0];
  return { id: revision.questionId, type: revision.type, stem: revision.stem, options: clone(revision.options),
    answers: [...revision.answers], domain: revision.domain,
    sources: (revision.sources ?? []).map((source) => source.label ?? `${source.file}${source.page ? ` · 第 ${source.page} 页` : ""}${source.ordinal ? ` · 第 ${source.ordinal} 题` : ""}`),
    repeatCount: Math.max(1, revision.sources?.length ?? 0), sourceFile: first?.file ?? "",
    sourceOrdinal: Number(first?.ordinal) || 0, sourceNote: revision.sourceNote };
}

export function getActiveQuestions(state: LibraryState, bankId = state.activeBankId): Question[] {
  if (bankId === null) return [];
  const bank = getBank(state, bankId);
  return Object.values(bank.questions).filter((question) => !question.inactive
    && !hasQuestionConflict(state, bank.id, question.id)
    && validateQuestion(activeRevision(question), bank).length === 0).map((question) => toQuestion(activeRevision(question)));
}

export function commitQuestion(state: LibraryState, input: QuestionInput, options: CommitOptions = {}): CommitResult {
  const bank = getBank(state, options.bankId);
  const issues = validateQuestion(input, bank);
  if (issues.length) return { state, status: "invalid", issues };
  const fingerprint = questionFingerprint(input);
  const existing = options.questionId ? bank.questions[options.questionId] : undefined;
  if (options.questionId && !existing) return { state, status: "invalid", issues: ["待修改题目不存在"] };
  const identical = Object.values(bank.questions).find((question) => activeRevision(question).fingerprint === fingerprint);
  const now = timestamp(options.now);
  if (identical && (!existing || identical.id === existing.id)) {
    const old = activeRevision(identical);
    const sources = [...new Map([...(old.sources ?? []), ...(input.sources ?? [])].map((source) => [stableStringify(source), source])).values()];
    if (stableStringify(sources) === stableStringify(old.sources ?? []) && !existing) {
      return { state, status: "duplicate", questionId: identical.id, revisionId: old.id, issues: [] };
    }
    if (!existing) {
      const result = commitQuestion(state, { ...old, sources }, { ...options, questionId: identical.id, reason: "合并题目来源" });
      return { ...result, status: "duplicate" };
    }
  }
  const similar = Object.values(bank.questions).filter((question) => question.id !== existing?.id
    && normalize(activeRevision(question).stem) === normalize(input.stem)
    && activeRevision(question).fingerprint !== fingerprint);
  if (similar.length && !options.allowSeparate && !options.resolveConflict) {
    return { state, status: "conflict", issues: ["同题干存在不同选项、答案或适用版本，请比较后明确处理"], conflictingQuestionIds: similar.map((question) => question.id) };
  }
  if (existing && stableStringify([...activeRevision(existing).answers].sort()) !== stableStringify([...input.answers].sort()) && !options.reason?.trim()) {
    return { state, status: "invalid", issues: ["修改答案时请填写理由"] };
  }
  const id = existing?.id ?? newLibraryId("q");
  const revisionId = options.revisionId ?? newLibraryId("rev");
  if (!safeId(revisionId) || existing?.revisions[revisionId]) return { state, status: "invalid", issues: ["修订标识已存在或无效"] };
  const revision: QuestionRevision = { ...clone(input), id: revisionId, questionId: id, createdAt: now,
    reason: options.reason?.trim() || (existing ? "更新题目" : "用户确认入库"), fingerprint, learningKey: fingerprint,
    ...(existing ? { parentRevisionId: existing.activeRevisionId } : {}) };
  const question: LibraryQuestion = { id, activeRevisionId: revisionId,
    revisions: { ...(existing?.revisions ?? {}), [revisionId]: revision }, inactive: existing?.inactive ?? false, updatedAt: now };
  return { state: updateBank(state, { ...bank, updatedAt: now, questions: { ...bank.questions, [id]: question } }),
    status: existing ? "revised" : "created", questionId: id, revisionId, issues: [] };
}

export function setQuestionInactive(state: LibraryState, questionId: string, inactive: boolean, bankId?: string, now?: string): LibraryState {
  const bank = getBank(state, bankId);
  const question = bank.questions[questionId];
  if (!question) throw new Error("题目不存在");
  return updateBank(state, { ...bank, questions: { ...bank.questions, [questionId]: { ...question, inactive, updatedAt: timestamp(now) } } });
}

export function stageCandidates(state: LibraryState, inputs: QuestionInput[], options: { batchId: string; bankId?: string; issues?: string[][]; targetQuestionIds?: string[] }): LibraryState {
  const bank = getBank(state, options.bankId);
  const candidates = { ...bank.candidates };
  inputs.forEach((input, index) => {
    const id = `candidate_${contentDigest(`${options.batchId}:${index}`)}`;
    if (!candidates[id]) candidates[id] = { id, batchId: options.batchId, input: clone(input),
      issues: [...(options.issues?.[index] ?? [])], status: "pending",
      ...(options.targetQuestionIds?.[index] ? { targetQuestionId: options.targetQuestionIds[index] } : {}) };
  });
  return updateBank(state, { ...bank, candidates });
}

export function updateCandidate(state: LibraryState, candidateId: string, input: QuestionInput, issues: string[] = [], bankId?: string): LibraryState {
  const bank = getBank(state, bankId);
  const candidate = bank.candidates[candidateId];
  if (!candidate || candidate.status !== "pending") throw new Error("待核对题不存在或已入库");
  return updateBank(state, { ...bank, candidates: { ...bank.candidates, [candidateId]: reviseCandidate(candidate, input, issues) } });
}

function candidateDigest(candidate: ImportCandidate): string {
  const { ancestorDigests: _ignored, ...content } = candidate;
  return contentDigest(content);
}

export function reviseCandidate(candidate: ImportCandidate, input: QuestionInput, issues: string[] = []): ImportCandidate {
  if (candidate.status !== "pending") throw new Error("已入库候选不能被识别结果覆盖");
  const next = { ...candidate, input: clone(input), issues: [...issues] };
  return candidateDigest(next) === candidateDigest(candidate) ? candidate : {
    ...next, ancestorDigests: [...new Set([...(candidate.ancestorDigests ?? []), candidateDigest(candidate)])] };
}

export function acceptCandidate(state: LibraryState, candidateId: string, options: CommitOptions = {}): CommitResult {
  const bank = getBank(state, options.bankId);
  const candidate = bank.candidates[candidateId];
  if (!candidate) return { state, status: "invalid", issues: ["待核对题不存在"] };
  if (candidate.status !== "pending") return { state, status: "duplicate", questionId: candidate.questionId, issues: [] };
  if (candidate.issues.length) return { state, status: "invalid", issues: [...candidate.issues] };
  const result = commitQuestion(state, candidate.input, { ...options, questionId: options.questionId ?? candidate.targetQuestionId });
  if (!result.questionId || !["created", "revised", "duplicate"].includes(result.status)) return result;
  const updated = getBank(result.state, bank.id);
  return { ...result, state: updateBank(result.state, { ...updated, candidates: { ...updated.candidates,
    [candidateId]: { ...candidate, status: result.status === "duplicate" ? "duplicate" : "accepted", questionId: result.questionId,
      ancestorDigests: [...new Set([...(candidate.ancestorDigests ?? []), candidateDigest(candidate)])] } } }) };
}

function sortedEvents(state: LibraryState, bankId: string): LibraryStudyEvent[] {
  const blocked = new Set(state.conflicts.filter((conflict) => !conflict.resolved && conflict.kind === "event").map((conflict) => conflict.entityId));
  return Object.values(state.events).filter((event) => event.bankId === bankId && !blocked.has(event.id))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
}

export function getBankStudyData(state: LibraryState, bankId = state.activeBankId): StudyDataV1 {
  if (bankId === null) return createEmptyStudyData();
  const bank = getBank(state, bankId);
  let data = clone(bank.baseline);
  for (const event of sortedEvents(state, bank.id)) {
    if (event.kind === "answer") data = recordAnswer(data, event.questionId, event.correct, event.at).data;
    else if (event.kind === "bookmark") {
      const previous = data.questions[event.questionId] ?? emptyProgress();
      data.questions[event.questionId] = { ...previous, bookmarked: event.value };
    } else if (event.kind === "cursor") data.cursors[event.key] = { questionId: event.questionId, updatedAt: event.at };
  }
  return { ...data, exams: clone(bank.examSessions) };
}

function emptyProgress(): QuestionProgress {
  return { attempts: 0, correctCount: 0, wrongCount: 0, isWrong: false, bookmarked: false, lastCorrect: null, lastAnsweredAt: null };
}

function appendEvent(state: LibraryState, event: LibraryStudyEvent): LibraryState {
  const existing = state.events[event.id];
  if (existing) {
    if (stableStringify(existing) !== stableStringify(event)) throw new Error("事件标识冲突，原记录未被覆盖");
    return state;
  }
  return { ...state, events: { ...state.events, [event.id]: event } };
}

export function recordAnswerEvent(state: LibraryState, questionId: string, correct: boolean, options: RecordAnswerOptions = {}): LibraryState {
  const bank = getBank(state, options.bankId);
  const question = bank.questions[questionId];
  const revisionId = options.revisionId ?? question?.activeRevisionId;
  if (!question || !revisionId || !question.revisions[revisionId]) throw new Error("题目修订版不存在");
  const id = options.id ?? newLibraryId("event");
  const event: LibraryStudyEvent = { id, deviceId: state.deviceId, bankId: bank.id,
    questionId, revisionId, at: state.events[id]?.at ?? timestamp(options.now), kind: "answer", correct, guessed: options.guessed ?? false,
    reviewEligible: bank.reviewEnabled, context: options.context ?? "practice",
    ...(options.selected ? { selected: [...options.selected] } : {}) };
  return appendEvent(state, event);
}

export function setBookmark(state: LibraryState, questionId: string, value: boolean, options: RecordAnswerOptions = {}): LibraryState {
  const bank = getBank(state, options.bankId);
  const question = bank.questions[questionId];
  if (!question) throw new Error("题目不存在");
  const id = options.id ?? newLibraryId("event");
  return appendEvent(state, { kind: "bookmark", value, id, deviceId: state.deviceId,
    bankId: bank.id, questionId, revisionId: question.activeRevisionId, at: state.events[id]?.at ?? timestamp(options.now) });
}

/** Adapter for existing UI; callers pass the exact previous snapshot they rendered. */
export function recordStudyTransition(state: LibraryState, previous: StudyDataV1, next: StudyDataV1,
  options: { bankId?: string; now?: string; operationId?: string } = {}): LibraryState {
  const bank = getBank(state, options.bankId);
  let result = state;
  const operationId = options.operationId ?? `transition_${contentDigest({ bankId: bank.id, deviceId: state.deviceId, previous, next })}`;
  for (const [paperId, attempt] of Object.entries(next.exams ?? {})) {
    const before = previous.exams?.[paperId];
    if (stableStringify(attempt) === stableStringify(before)) continue;
    const current = bank.examSessions[paperId];
    // A queued write must descend from the attempt the caller actually read.
    // Identical committed output remains safe to retry after an uncertain response.
    if (stableStringify(current) !== stableStringify(before) && stableStringify(current) !== stableStringify(attempt)) {
      throw new Error("试卷已在另一个视图更新，请返回试卷重新打开后再作答。原有答案未被覆盖。");
    }
  }
  const submitted = Object.entries(next.exams ?? {}).find(([paperId, attempt]) => attempt.submittedAt !== undefined
    && previous.exams?.[paperId]?.submittedAt === undefined);
  const submittedPaper = submitted ? bank.papers[submitted[0]] : undefined;
  const submittedGrade = submittedPaper && submitted ? gradePaper(submittedPaper, submitted[1].answers) : undefined;
  let ordinal = 0;
  for (const [id, progress] of Object.entries(next.questions)) {
    const before = previous.questions[id] ?? emptyProgress();
    const delta = progress.attempts - before.attempts;
    if (delta < 0 || delta > 2000 || progress.correctCount < before.correctCount || progress.wrongCount < before.wrongCount) throw new Error("学习记录不能通过界面转换减少或重写");
    if (!bank.questions[id]) continue;
    const examItems = submittedPaper?.items.filter((entry) => entry.questionId === id && (submitted?.[1].answers[String(entry.ordinal)]?.length ?? 0) > 0) ?? [];
    if (submitted && submittedPaper && examItems.length === delta && delta > 0) {
      for (const frozenItem of examItems) {
        const graded = submittedGrade!.results.find((entry) => entry.ordinal === frozenItem.ordinal)!;
        result = recordAnswerEvent(result, id, graded.correct, { bankId: bank.id,
          id: `${bank.id}:${examSessionId(submitted[1])}:answer:${frozenItem.ordinal}`, revisionId: frozenItem.revisionId,
          context: "exam", selected: submitted[1].answers[String(frozenItem.ordinal)],
          now: new Date(Math.min(submitted[1].submittedAt!, submitted[1].deadlineAt)).toISOString() });
      }
    } else {
    const newHistory = next.history.filter((entry) => entry.questionId === id).slice(-delta);
    for (let index = 0; index < delta; index += 1) {
      const item = delta > 0 ? newHistory[index] : undefined;
      const frozenItem = submittedPaper?.items.find((entry) => entry.questionId === id);
      result = recordAnswerEvent(result, id, item?.correct ?? progress.lastCorrect === true,
        { bankId: bank.id, id: `${operationId}:answer:${ordinal++}`, now: item?.answeredAt ?? progress.lastAnsweredAt ?? options.now,
          ...(frozenItem ? { revisionId: frozenItem.revisionId, context: "exam" as const,
            selected: submitted?.[1].answers[String(frozenItem.ordinal)] ?? [] } : {}) });
    }
    }
    if (progress.bookmarked !== before.bookmarked) result = setBookmark(result, id, progress.bookmarked,
      { bankId: bank.id, id: `${operationId}:bookmark:${id}`, now: options.now });
  }
  for (const [key, cursor] of Object.entries(next.cursors)) {
    if (stableStringify(cursor) === stableStringify(previous.cursors[key])) continue;
    const question = bank.questions[cursor.questionId];
    if (!question) continue;
    result = appendEvent(result, { id: `${operationId}:cursor:${contentDigest(key)}`, kind: "cursor", key,
      deviceId: state.deviceId, bankId: bank.id, questionId: question.id, revisionId: question.activeRevisionId, at: timestamp(cursor.updatedAt) });
  }
  if (stableStringify(next.exams ?? {}) !== stableStringify(previous.exams ?? {})) {
    let current = getBank(result, bank.id);
    for (const attempt of Object.values(next.exams ?? {})) {
      if (stableStringify(attempt) !== stableStringify(previous.exams?.[attempt.paperId])) current = storeExamAttempt(current, attempt,
        `${operationId}:exam:${examSessionId(attempt)}`, options.now);
    }
    result = updateBank(result, current);
  }
  return result;
}

export function setReviewEnabled(state: LibraryState, enabled: boolean, bankId?: string, now?: string): LibraryState {
  return updateBank(state, { ...getBank(state, bankId), reviewEnabled: enabled, updatedAt: timestamp(now), reviewUpdatedAt: timestamp(now) });
}

export function enrollReview(state: LibraryState, questionIds: string[], options: { bankId?: string; now?: string } = {}): LibraryState {
  const bank = getBank(state, options.bankId);
  let next = state;
  for (const id of [...new Set(questionIds)]) {
    const question = bank.questions[id];
    if (!question) continue;
    next = appendEvent(next, { id: newLibraryId("event"), kind: "review-enroll", deviceId: state.deviceId,
      bankId: bank.id, questionId: id, revisionId: question.activeRevisionId, at: timestamp(options.now) });
  }
  return next;
}

/** Records uncertainty without inventing a second answer or changing correctness statistics. */
export function markReviewAgain(state: LibraryState, questionId: string, options: RecordAnswerOptions = {}): LibraryState {
  const bank = getBank(state, options.bankId);
  const question = bank.questions[questionId];
  const revisionId = options.revisionId ?? question?.activeRevisionId;
  if (!question || !revisionId || !question.revisions[revisionId]) throw new Error("题目修订版不存在");
  return appendEvent(state, { id: options.id ?? newLibraryId("event"), kind: "review-reset", deviceId: state.deviceId,
    bankId: bank.id, questionId, revisionId, at: timestamp(options.now) });
}

export function getReviewSchedules(state: LibraryState, bankId = state.activeBankId): ReviewSchedule[] {
  if (bankId === null) return [];
  const bank = getBank(state, bankId);
  const schedules = new Map<string, ReviewSchedule>();
  const learningKeys = new Map<string, string>();
  for (const event of sortedEvents(state, bank.id)) {
    if (event.kind !== "answer" && event.kind !== "review-enroll" && event.kind !== "review-reset") continue;
    if (event.kind === "answer" && !event.reviewEligible) continue;
    const question = bank.questions[event.questionId];
    const revision = question?.revisions[event.revisionId];
    if (!question || !revision) continue;
    const key = `${question.id}:${revision.learningKey}`;
    const previous = schedules.get(key);
    const at = Date.parse(event.at);
    let stage = previous?.stage ?? 0;
    let dueAt = previous?.dueAt ?? new Date(at + DAY).toISOString();
    if (event.kind === "review-enroll" && previous) continue;
    if (event.kind === "review-reset" || event.kind === "answer" && (!event.correct || event.guessed)) {
      stage = 0;
      dueAt = new Date(at + DAY).toISOString();
    } else if (previous && at >= Date.parse(previous.dueAt)) {
      stage = Math.min(previous.stage + 1, REVIEW_INTERVAL_DAYS.length - 1);
      dueAt = new Date(at + REVIEW_INTERVAL_DAYS[stage]! * DAY).toISOString();
    }
    schedules.set(key, { questionId: question.id, revisionId: revision.id, stage, dueAt, lastReviewedAt: event.at });
    learningKeys.set(question.id, key);
  }
  const results: ReviewSchedule[] = [];
  for (const question of Object.values(bank.questions)) {
    const revision = activeRevision(question);
    const current = schedules.get(`${question.id}:${revision.learningKey}`);
    if (current) results.push({ ...current, revisionId: revision.id });
    else if (learningKeys.has(question.id)) {
      // A substantive revision starts a fresh interval without rewriting prior attempts.
      results.push({ questionId: question.id, revisionId: revision.id, stage: 0,
        dueAt: new Date(Date.parse(revision.createdAt) + DAY).toISOString(), lastReviewedAt: revision.createdAt });
    }
  }
  return results;
}

export function getReviewQueue(state: LibraryState, now = new Date().toISOString(), bankId = state.activeBankId): ReviewSchedule[] {
  if (bankId === null) return [];
  const bank = getBank(state, bankId);
  if (!bank.reviewEnabled) return [];
  const available = new Set(getActiveQuestions(state, bank.id).map((question) => question.id));
  const progress = getBankStudyData(state, bank.id).questions;
  return getReviewSchedules(state, bank.id).filter((schedule) => available.has(schedule.questionId) && Date.parse(schedule.dueAt) <= Date.parse(timestamp(now)))
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt)
      || Number(progress[b.questionId]?.isWrong ?? false) - Number(progress[a.questionId]?.isWrong ?? false)
      || (progress[b.questionId]?.wrongCount ?? 0) - (progress[a.questionId]?.wrongCount ?? 0));
}

export function getLearningEvidence(state: LibraryState, bankId = state.activeBankId): LearningEvidence {
  const emptyEvidence = (): AnswerEvidence => ({ sampleCount: 0, correctCount: 0, accuracy: null });
  if (bankId === null) return { firstAnswers: emptyEvidence(), delayedAnswers: emptyEvidence(), answerCount: 0, observedQuestions: 0,
    repeatedWrongQuestionIds: [], unretestedQuestionIds: [], domains: [], legacyAttemptCount: 0, legacyHistoryCount: 0,
    legacyHistoryIncomplete: false, legacyExcludedFromFirstAndDelayed: false, note: "开始作答后显示观察结果。" };
  const bank = getBank(state, bankId);
  const firstAnswers = emptyEvidence();
  const delayedAnswers = emptyEvidence();
  const domains = new Map<string, DomainLearningEvidence>();
  const observed = new Set<string>();
  const observedByDomain = new Map<string, Set<string>>();
  const lastAt = new Map<string, number>();
  const delayedGroups = new Set<string>();
  const groupQuestions = new Map<string, string>();
  const baselineKeys = new Set<string>();
  const wrongCounts = new Map<string, number>();
  const bucket = (domain: string): DomainLearningEvidence => {
    let entry = domains.get(domain);
    if (!entry) {
      entry = { domain, observedQuestions: 0, answerCount: 0, firstAnswers: emptyEvidence(), delayedAnswers: emptyEvidence(), repeatedWrongQuestions: 0, unretestedQuestions: 0 };
      domains.set(domain, entry);
      observedByDomain.set(domain, new Set());
    }
    return entry;
  };
  for (const [id, progress] of Object.entries(bank.baseline.questions)) {
    const question = bank.questions[id];
    wrongCounts.set(id, progress.wrongCount);
    if (!question || !progress.attempts) continue;
    const earliest = Object.values(question.revisions).find((revision) => !revision.parentRevisionId) ?? activeRevision(question);
    const key = `${id}:${earliest.learningKey}`;
    baselineKeys.add(key);
    groupQuestions.set(key, id);
  }
  let answerCount = 0;
  const add = (evidence: AnswerEvidence, correct: boolean): void => {
    evidence.sampleCount += 1;
    if (correct) evidence.correctCount += 1;
    evidence.accuracy = Math.round(100 * evidence.correctCount / evidence.sampleCount);
  };
  for (const event of sortedEvents(state, bank.id)) {
    if (event.kind !== "answer") continue;
    const question = bank.questions[event.questionId];
    const revision = question?.revisions[event.revisionId];
    if (!question || !revision) continue;
    const domain = activeRevision(question).domain;
    const entry = bucket(domain);
    const key = `${question.id}:${revision.learningKey}`;
    const previous = lastAt.get(key);
    const at = Date.parse(event.at);
    answerCount += 1;
    entry.answerCount += 1;
    observed.add(question.id);
    observedByDomain.get(domain)!.add(question.id);
    groupQuestions.set(key, question.id);
    if (previous === undefined && !baselineKeys.has(key)) { add(firstAnswers, event.correct); add(entry.firstAnswers, event.correct); }
    if (previous !== undefined && at - previous >= DAY) {
      add(delayedAnswers, event.correct);
      add(entry.delayedAnswers, event.correct);
      delayedGroups.add(key);
    }
    lastAt.set(key, at);
    if (!event.correct) wrongCounts.set(question.id, (wrongCounts.get(question.id) ?? 0) + 1);
  }
  const repeatedWrongQuestionIds = [...wrongCounts].filter(([, count]) => count >= 2).map(([id]) => id);
  const unretestedQuestionIds = [...new Set(groupQuestions.values())].filter((id) => {
    const question = bank.questions[id];
    return question && !delayedGroups.has(`${id}:${activeRevision(question).learningKey}`);
  });
  for (const id of repeatedWrongQuestionIds) {
    const question = bank.questions[id];
    if (question) bucket(activeRevision(question).domain).repeatedWrongQuestions += 1;
  }
  for (const id of unretestedQuestionIds) {
    const question = bank.questions[id];
    if (question) bucket(activeRevision(question).domain).unretestedQuestions += 1;
  }
  for (const [domain, entry] of domains) entry.observedQuestions = observedByDomain.get(domain)?.size ?? 0;
  const legacyAttemptCount = Object.values(bank.baseline.questions).reduce((sum, item) => sum + item.attempts, 0);
  return { firstAnswers, delayedAnswers, answerCount, observedQuestions: observed.size,
    repeatedWrongQuestionIds, unretestedQuestionIds, domains: [...domains.values()].sort((a, b) => a.domain.localeCompare(b.domain)),
    legacyAttemptCount, legacyHistoryCount: bank.baseline.history.length,
    legacyHistoryIncomplete: legacyAttemptCount > bank.baseline.history.length,
    legacyExcludedFromFirstAndDelayed: legacyAttemptCount > 0,
    note: "首次样本按题目与知识内容版本计算；延迟样本要求距同版本上次作答至少 24 小时。旧累计数据不用于补推首次或间隔结果；知识点按当前分类汇总。" };
}

function paperDigest(paper: Omit<FrozenPaper, "digest"> | FrozenPaper): string {
  const { digest: _ignored, ...content } = paper as FrozenPaper;
  return contentDigest(content);
}

export function composePaper(state: LibraryState, options: ComposeOptions): ComposeResult {
  const bank = getBank(state, options.bankId);
  const issues: string[] = [];
  if (typeof options.title !== "string" || !options.title.trim()) issues.push("请填写试卷名称");
  if (!isRecord(options.counts)) return { state, shortages: {}, issues: [...issues, "题型数量格式无效"] };
  if (Object.keys(options.counts).some((type) => !TYPES.includes(type as QuestionType))) issues.push("组卷条件包含未支持的题型");
  if (options.scoreMode !== undefined && !["exact", "proportional"].includes(options.scoreMode)) issues.push("多选计分规则无效");
  if (options.filter !== undefined && !["all", "wrong", "unanswered", "bookmarked"].includes(options.filter)) issues.push("练习筛选条件无效");
  if (options.domains !== undefined && (!Array.isArray(options.domains) || !options.domains.every((entry) => typeof entry === "string"))) issues.push("知识点条件格式无效");
  if (options.sources !== undefined && (!Array.isArray(options.sources) || !options.sources.every((entry) => typeof entry === "string"))) issues.push("来源条件格式无效");
  if (!finite(options.durationMinutes) || options.durationMinutes <= 0 || options.durationMinutes > 1440) issues.push("练习限时需为 0 至 1440 分钟之间");
  const count = TYPES.reduce((total, type) => total + (options.counts[type] ?? 0), 0);
  if (count < 1 || count > MAX_PAPER_QUESTIONS) issues.push(`每卷应为 1 至 ${MAX_PAPER_QUESTIONS} 题`);
  for (const type of TYPES) {
    const requested = options.counts[type] ?? 0;
    if (!Number.isInteger(requested) || requested < 0) issues.push("题量必须为非负整数");
    const points = options.points?.[type] ?? 1;
    if (!finite(points) || points < 0 || points > 10000) issues.push("每题分值无效");
  }
  if (issues.length) return { state, shortages: {}, issues };
  const id = options.id ?? newLibraryId("paper");
  if (!safeId(id) || bank.papers[id]) return { state, shortages: {}, issues: ["试卷标识已存在或无效"] };
  const seededOrder = (left: Question, right: Question): number => contentDigest(`${id}:${left.id}`)
    .localeCompare(contentDigest(`${id}:${right.id}`)) || left.id.localeCompare(right.id);
  const progress = getBankStudyData(state, bank.id).questions;
  const pool = getActiveQuestions(state, bank.id).filter((question) => {
    const revision = activeRevision(bank.questions[question.id]!);
    if (options.domains?.length && !options.domains.some((domain) => domain === question.domain || revision.tags?.includes(domain))) return false;
    if (options.sources?.length && !options.sources.some((source) => revision.sources?.some((ref) => ref.file.includes(source) || ref.label?.includes(source)))) return false;
    const item = progress[question.id];
    return options.filter === "wrong" ? item?.isWrong === true
      : options.filter === "bookmarked" ? item?.bookmarked === true
        : options.filter === "unanswered" ? !item?.attempts : true;
  });
  const shortages: ComposeResult["shortages"] = {};
  const selected: { question: Question; points: number }[] = [];
  for (const type of TYPES) {
    const requested = options.counts[type] ?? 0;
    const matches = pool.filter((question) => question.type === type).sort(seededOrder);
    if (matches.length < requested) shortages[type] = requested - matches.length;
    selected.push(...matches.slice(0, requested).map((question) => ({ question, points: options.points?.[type] ?? 1 })));
  }
  if (Object.keys(shortages).length) return { state, shortages, issues: ["可用题目不足，请调整题量或筛选条件"] };
  selected.sort((left, right) => seededOrder(left.question, right.question));
  const content: Omit<FrozenPaper, "digest"> = { id, bankId: bank.id, title: options.title.trim(), createdAt: timestamp(options.now),
    durationMinutes: options.durationMinutes, scoreMode: options.scoreMode ?? "exact", kind: "composed",
    items: selected.map(({ question, points }, index) => ({ ordinal: index + 1, questionId: question.id,
      revisionId: bank.questions[question.id]!.activeRevisionId, points, snapshot: clone(activeRevision(bank.questions[question.id]!)) })),
    totalScore: selected.reduce((total, item) => total + item.points, 0) };
  const paper: FrozenPaper = { ...content, digest: paperDigest(content) };
  return { state: updateBank(state, { ...bank, papers: { ...bank.papers, [id]: paper } }), paper, shortages: {}, issues: [] };
}

export function gradePaper(paper: FrozenPaper, answers: Record<string, readonly string[]>): PaperGrade {
  const results = paper.items.map((item) => {
    const selected = answers[String(item.ordinal)] ?? [];
    const expected = item.snapshot.answers;
    const answered = selected.length > 0;
    const unique = new Set(selected).size === selected.length;
    const noWrong = unique && selected.every((key) => expected.includes(key));
    const correct = noWrong && selected.length === expected.length;
    const points = correct ? item.points : paper.scoreMode === "proportional" && item.snapshot.type === "multiple" && noWrong && answered
      ? item.points * selected.length / expected.length : 0;
    return { ordinal: item.ordinal, correct, answered, points };
  });
  return { score: results.reduce((sum, item) => sum + item.points, 0), totalScore: paper.totalScore,
    correctCount: results.filter((item) => item.correct).length, answeredCount: results.filter((item) => item.answered).length, results };
}

export function freezeOriginalPaper(state: LibraryState, options: OriginalPaperOptions): ComposeResult {
  const bank = getBank(state, options.bankId);
  const issues: string[] = [];
  if (!options.completenessConfirmed) issues.push("请对照原卷确认题号、页面、答案与计分规则完整");
  if (!options.title.trim() || !options.sourceFile.trim()) issues.push("请填写原卷名称与来源");
  if (!finite(options.durationMinutes) || options.durationMinutes <= 0 || options.durationMinutes > 1440) issues.push("练习限时无效");
  if (!options.items.length || options.items.length > MAX_PAPER_QUESTIONS) issues.push("原卷题量超出支持范围");
  if (options.declaredQuestionCount !== undefined && options.declaredQuestionCount !== options.items.length) issues.push("原卷声明题量与整理题量不一致");
  if (options.declaredTotalScore !== undefined && (!finite(options.declaredTotalScore) || options.declaredTotalScore < 0)) issues.push("卷头总分无效");
  const candidateIds = new Set(options.items.map((item) => item.candidateId));
  if (candidateIds.size !== options.items.length) issues.push("同一个原卷位置重复使用");
  const batches = new Set<string>(options.batchId ? [options.batchId] : []);
  const sorted = [...options.items].sort((a, b) => a.ordinal - b.ordinal);
  const items: FrozenPaper["items"] = [];
  for (const [index, item] of sorted.entries()) {
    if (item.ordinal !== index + 1) issues.push("原卷题号必须连续且唯一");
    if (!finite(item.points) || item.points < 0 || item.points > 10000) issues.push(`第 ${item.ordinal} 题分值无效`);
    const candidate = bank.candidates[item.candidateId];
    if (!candidate || candidate.status === "pending" || !candidate.questionId || candidate.issues.length) {
      issues.push(`第 ${item.ordinal} 题尚未核对入库`); continue;
    }
    batches.add(candidate.batchId);
    const question = bank.questions[candidate.questionId];
    if (!question || question.inactive || hasQuestionConflict(state, bank.id, question.id)) {
      issues.push(`第 ${item.ordinal} 题不可用于计分`); continue;
    }
    const revision = activeRevision(question);
    if (revision.fingerprint !== questionFingerprint(candidate.input)) issues.push(`第 ${item.ordinal} 题入库后已修订，不能冒充原题版本`);
    for (const issue of validateQuestion(revision, bank)) issues.push(`第 ${item.ordinal} 题：${issue}`);
    items.push({ ordinal: item.ordinal, questionId: question.id, revisionId: revision.id, points: item.points, snapshot: clone(revision) });
  }
  for (const candidate of Object.values(bank.candidates)) if (batches.has(candidate.batchId)
    && (!candidateIds.has(candidate.id) || candidate.status === "pending")) issues.push("该原卷批次仍有未纳入或未确认的题目，不能建立完整原卷");
  if (issues.length) return { state, shortages: {}, issues: [...new Set(issues)] };
  const id = options.id ?? newLibraryId("original");
  if (!safeId(id) || bank.papers[id]) return { state, shortages: {}, issues: ["试卷标识已存在或无效"] };
  const content: Omit<FrozenPaper, "digest"> = { id, bankId: bank.id, title: options.title.trim(), sourceFile: options.sourceFile,
    createdAt: timestamp(options.now), durationMinutes: options.durationMinutes, scoreMode: options.scoreMode ?? "exact", kind: "original",
    items, totalScore: items.reduce((total, item) => total + item.points, 0),
    ...(options.declaredTotalScore !== undefined ? { declaredTotalScore: options.declaredTotalScore } : {}),
    ...(options.ruleNote ? { ruleNote: options.ruleNote } : {}) };
  const paper: FrozenPaper = { ...content, digest: paperDigest(content) };
  return { state: updateBank(state, { ...bank, papers: { ...bank.papers, [id]: paper } }), paper, shortages: {}, issues: [] };
}

export function toExamPaper(paper: FrozenPaper): ExamPaper {
  const counts: Record<QuestionType, number> = { single: 0, multiple: 0, judge: 0 };
  paper.items.forEach((item) => { counts[item.snapshot.type] += 1; });
  return { id: paper.id, title: paper.title, sourcePdf: paper.sourceFile ?? "", sourceSha256: paper.digest,
    durationMinutes: paper.durationMinutes, scoreMode: paper.scoreMode,
    ruleNote: paper.ruleNote ?? (paper.scoreMode === "exact" ? "多选全部选对才得分" : "多选无错选时按正确项比例计分"),
    declaredTotalScore: paper.declaredTotalScore ?? paper.totalScore, totalScore: paper.totalScore, counts,
    items: paper.items.map(({ ordinal, questionId, points }) => ({ ordinal, questionId, points })) };
}

export function getPaperQuestions(paper: FrozenPaper): Map<string, Question> {
  return new Map(paper.items.map((item) => [item.questionId, toQuestion(item.snapshot)]));
}

export function examSessionId(attempt: { paperId: string; startedAt: number }): string {
  return `attempt_${contentDigest(`${attempt.paperId}:${attempt.startedAt}`)}`;
}

function storeExamAttempt(bank: LibraryBank, attempt: LibraryBank["examSessions"][string], writeId: string, now?: string,
  parentIds?: string[]): LibraryBank {
  const sessionId = examSessionId(attempt);
  const parents = parentIds ?? (bank.examHeads[sessionId] ? [bank.examHeads[sessionId]] : []);
  if (bank.examWrites[writeId]) {
    if (stableStringify(bank.examWrites[writeId].attempt) !== stableStringify(attempt)) throw new Error("考试写入标识冲突");
    return bank;
  }
  const latest = bank.examSessions[attempt.paperId];
  return { ...bank,
    examWrites: { ...bank.examWrites, [writeId]: { id: writeId, sessionId, parentIds: parents, at: timestamp(now), attempt: clone(attempt) } },
    examHeads: { ...bank.examHeads, [sessionId]: writeId },
    examHistory: { ...bank.examHistory, [sessionId]: clone(attempt) },
    examSessions: !latest || latest.startedAt <= attempt.startedAt ? { ...bank.examSessions, [attempt.paperId]: clone(attempt) } : bank.examSessions };
}

function examWriteAncestor(bank: LibraryBank, ancestor: string, descendant: string): boolean {
  const pending = [descendant];
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === ancestor) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(bank.examWrites[id]?.parentIds ?? []));
  }
  return false;
}

export function submitPaperAttempt(state: LibraryState, paperId: string, now = new Date().toISOString(), bankId?: string): LibraryState {
  const bank = getBank(state, bankId);
  const paper = bank.papers[paperId];
  const attempt = bank.examSessions[paperId];
  if (!paper || !attempt || attempt.paperDigest !== paper.digest) throw new Error("试卷版本不一致或未开始");
  if (attempt.submittedAt !== undefined) return state;
  const at = new Date(Math.min(Date.parse(timestamp(now)), attempt.deadlineAt)).toISOString();
  if (Date.parse(at) < attempt.startedAt) throw new Error("交卷时间早于开考时间");
  const grade = gradePaper(paper, attempt.answers);
  let next = state;
  for (const result of grade.results) {
    if (!result.answered) continue;
    const item = paper.items.find((entry) => entry.ordinal === result.ordinal)!;
    next = recordAnswerEvent(next, item.questionId, result.correct, { id: `${bank.id}:${examSessionId(attempt)}:answer:${item.ordinal}`,
      bankId: bank.id, revisionId: item.revisionId, now: at, context: "exam", selected: attempt.answers[String(item.ordinal)] });
  }
  const completed = { ...attempt, submittedAt: Date.parse(at), score: grade.score, correctCount: grade.correctCount, answeredCount: grade.answeredCount };
  const updated = getBank(next, bank.id);
  return updateBank(next, storeExamAttempt(updated, completed, `${examSessionId(attempt)}:submit`, at));
}

function makeConflict(kind: LibraryConflict["kind"], bankId: string, entityId: string, local: unknown, remote: unknown): LibraryConflict {
  const ordered = [stableStringify(local), stableStringify(remote)].sort();
  return { id: `conflict_${contentDigest({ kind, bankId, entityId, ordered })}`, kind, bankId, entityId,
    local: clone(local), remote: clone(remote) };
}

/** True when walking immutable revision parents reaches the requested ancestor. */
export function isRevisionAncestor(question: LibraryQuestion, ancestor: string, descendant: string): boolean {
  const seen = new Set<string>();
  let current: string | undefined = descendant;
  while (current && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = question.revisions[current]?.parentRevisionId;
  }
  return false;
}

function examExtends(older: LibraryBank["examSessions"][string], newer: LibraryBank["examSessions"][string]): boolean {
  if (older.paperId !== newer.paperId || older.startedAt !== newer.startedAt || older.paperDigest !== newer.paperDigest) return false;
  if (older.submittedAt !== undefined) return stableStringify(older) === stableStringify(newer);
  return Object.entries(older.answers).every(([key, value]) => stableStringify(value) === stableStringify(newer.answers[key]));
}

export function mergeLibrary(local: LibraryState, remote: LibraryState): LibraryState {
  const checked = validateLibrary(remote);
  if (!checked.valid) throw new Error(`无法合并无效题库：${checked.issues.join("；")}`);
  const merged = clone(local);
  const conflicts = new Map([...local.conflicts, ...remote.conflicts].map((item) => [item.id, clone(item)]));
  for (const conflict of local.conflicts) if (conflict.resolved) conflicts.set(conflict.id, clone(conflict));
  const conflict = (kind: LibraryConflict["kind"], bankId: string, id: string, left: unknown, right: unknown): void => {
    if (stableStringify(left) === stableStringify(right)) return;
    const next = makeConflict(kind, bankId, id, left, right);
    if (!conflicts.has(next.id)) conflicts.set(next.id, next);
  };
  for (const [bankId, right] of Object.entries(remote.banks)) {
    const left = merged.banks[bankId];
    if (!left) { merged.banks[bankId] = clone(right); continue; }
    if (right.deletedAt && (!left.deletedAt || Date.parse(right.deletedAt) < Date.parse(left.deletedAt))) left.deletedAt = right.deletedAt;
    if (Date.parse(right.nameUpdatedAt) > Date.parse(left.nameUpdatedAt)) { left.name = right.name; left.nameUpdatedAt = right.nameUpdatedAt; }
    if (Date.parse(right.reviewUpdatedAt) > Date.parse(left.reviewUpdatedAt)) { left.reviewEnabled = right.reviewEnabled; left.reviewUpdatedAt = right.reviewUpdatedAt; }
    if (Date.parse(right.updatedAt) > Date.parse(left.updatedAt)) left.updatedAt = right.updatedAt;
    if (left.baselineId !== right.baselineId) conflict("baseline", bankId, bankId,
      { baseline: left.baseline, baselineId: left.baselineId }, { baseline: right.baseline, baselineId: right.baselineId });
    for (const [id, rightQuestion] of Object.entries(right.questions)) {
      const leftQuestion = left.questions[id];
      if (!leftQuestion) { left.questions[id] = clone(rightQuestion); continue; }
      for (const [revisionId, revision] of Object.entries(rightQuestion.revisions)) {
        if (!leftQuestion.revisions[revisionId]) leftQuestion.revisions[revisionId] = clone(revision);
        else conflict("revision", bankId, revisionId, leftQuestion.revisions[revisionId], revision);
      }
      if (leftQuestion.activeRevisionId !== rightQuestion.activeRevisionId) {
        if (isRevisionAncestor(leftQuestion, leftQuestion.activeRevisionId, rightQuestion.activeRevisionId)) leftQuestion.activeRevisionId = rightQuestion.activeRevisionId;
        else if (!isRevisionAncestor(leftQuestion, rightQuestion.activeRevisionId, leftQuestion.activeRevisionId)) {
          conflict("question-head", bankId, id, leftQuestion.activeRevisionId, rightQuestion.activeRevisionId);
        }
      }
      if (Date.parse(rightQuestion.updatedAt) > Date.parse(leftQuestion.updatedAt)) {
        leftQuestion.inactive = rightQuestion.inactive;
        leftQuestion.updatedAt = rightQuestion.updatedAt;
      }
    }
    for (const [id, candidate] of Object.entries(right.candidates)) {
      const previous = left.candidates[id];
      if (!previous) left.candidates[id] = clone(candidate);
      else if (candidateDigest(previous) === candidateDigest(candidate)) {
        previous.ancestorDigests = [...new Set([...(previous.ancestorDigests ?? []), ...(candidate.ancestorDigests ?? [])])];
      } else if (candidate.ancestorDigests?.includes(candidateDigest(previous))) left.candidates[id] = clone(candidate);
      else if (!previous.ancestorDigests?.includes(candidateDigest(candidate))) conflict("candidate", bankId, id, previous, candidate);
    }
    for (const [id, paper] of Object.entries(right.papers)) {
      if (!left.papers[id]) left.papers[id] = clone(paper);
      else conflict("paper", bankId, id, left.papers[id], paper);
    }
    for (const [id, attachment] of Object.entries(right.attachments)) {
      if (!left.attachments[id]) left.attachments[id] = clone(attachment);
      else {
        const previous = left.attachments[id];
        if (previous.path === attachment.path && previous.mimeType === attachment.mimeType
          && (!previous.dataBase64 || !attachment.dataBase64)) left.attachments[id] = { ...previous, dataBase64: previous.dataBase64 ?? attachment.dataBase64 };
        else conflict("attachment", bankId, id, previous, attachment);
      }
    }
    for (const [id, write] of Object.entries(right.examWrites)) {
      if (!left.examWrites[id]) left.examWrites[id] = clone(write);
      else conflict("exam-write", bankId, id, left.examWrites[id], write);
    }
    for (const [id, head] of Object.entries(right.examHeads)) {
      const localHead = left.examHeads[id];
      if (!localHead || examWriteAncestor(left, localHead, head)) left.examHeads[id] = head;
      else if (!examWriteAncestor(left, head, localHead)) conflict("exam", bankId, id,
        { headId: localHead, attempt: left.examWrites[localHead]!.attempt }, { headId: head, attempt: left.examWrites[head]!.attempt });
    }
    for (const [id, attempt] of Object.entries(right.examHistory)) {
      if (left.examHeads[id]) continue;
      const previous = left.examHistory[id];
      if (!previous || examExtends(previous, attempt)) left.examHistory[id] = clone(attempt);
      else if (!examExtends(attempt, previous)) conflict("exam", bankId, id, { attempt: previous }, { attempt });
    }
    for (const [id, head] of Object.entries(left.examHeads)) left.examHistory[id] = clone(left.examWrites[head]!.attempt);
    // Rebuild the compatibility view from independent attempts, never using a stale shard head.
    left.examSessions = {};
    for (const attempt of Object.values(left.examHistory)) {
      const paperId = attempt.paperId;
      const previous = left.examSessions[paperId];
      if (!previous || previous.startedAt < attempt.startedAt) left.examSessions[paperId] = clone(attempt);
    }
  }
  for (const [id, event] of Object.entries(remote.events)) {
    if (!merged.events[id]) merged.events[id] = clone(event);
    else conflict("event", event.bankId, id, merged.events[id], event);
  }
  merged.conflicts = [...conflicts.values()];
  if (!merged.activeBankId || !merged.banks[merged.activeBankId] || merged.banks[merged.activeBankId]?.deletedAt) {
    merged.activeBankId = Object.values(merged.banks).find((bank) => !bank.deletedAt)?.id ?? null;
  }
  return merged;
}

export function resolveLibraryConflict(state: LibraryState, conflictId: string, choice: "local" | "remote"): LibraryState {
  const next = clone(state);
  const conflict = next.conflicts.find((item) => item.id === conflictId);
  if (!conflict) throw new Error("冲突不存在");
  const bank = getBank(next, conflict.bankId);
  const value = clone(choice === "local" ? conflict.local : conflict.remote);
  if (conflict.kind === "question-head") {
    const question = bank.questions[conflict.entityId];
    if (!question || typeof value !== "string" || !question.revisions[value]) throw new Error("冲突修订版不存在");
    question.activeRevisionId = value;
  } else if (conflict.kind === "revision") {
    const revision = value as QuestionRevision;
    const question = bank.questions[revision.questionId];
    if (!question) throw new Error("冲突题目不存在");
    question.revisions[conflict.entityId] = revision;
  } else if (conflict.kind === "event") next.events[conflict.entityId] = value as LibraryStudyEvent;
  else if (conflict.kind === "paper") bank.papers[conflict.entityId] = value as FrozenPaper;
  else if (conflict.kind === "candidate") {
    const picked = value as ImportCandidate;
    const left = conflict.local as ImportCandidate;
    const right = conflict.remote as ImportCandidate;
    bank.candidates[conflict.entityId] = { ...picked, ancestorDigests: [...new Set([...(left.ancestorDigests ?? []), ...(right.ancestorDigests ?? []), candidateDigest(left), candidateDigest(right)])] };
  }
  else if (conflict.kind === "attachment") bank.attachments[conflict.entityId] = value as LibraryBank["attachments"][string];
  else if (conflict.kind === "baseline") {
    const baseline = value as { baseline: StudyDataV1; baselineId: string };
    bank.baseline = baseline.baseline;
    bank.baselineId = baseline.baselineId;
  } else if (conflict.kind === "exam-write") bank.examWrites[conflict.entityId] = value as LibraryBank["examWrites"][string];
  else if (conflict.kind === "exam") {
    const picked = value as { headId?: string; attempt: LibraryBank["examSessions"][string] };
    const local = conflict.local as { headId?: string };
    const remote = conflict.remote as { headId?: string };
    const parents = [local.headId, remote.headId].filter((id): id is string => Boolean(id));
    const updated = storeExamAttempt(bank, picked.attempt, `resolved_${conflict.id}`, undefined, parents);
    next.banks[bank.id] = updated;
  }
  conflict.resolved = true;
  const checked = validateLibrary(next);
  if (!checked.valid) throw new Error(checked.issues.join("；"));
  return next;
}

export function migrateLegacy(raw: unknown, questions: readonly Question[], papers: readonly ExamPaper[] = [],
  options: { deviceId?: string; now?: string; name?: string } = {}): LibraryState {
  if (!isRecord(raw) || raw.version !== 1) throw new Error("只能迁移版本 1 学习数据，原数据未修改");
  const legacyIssues = validateLegacyBaseline(raw);
  if (legacyIssues.length) throw new Error(`旧学习记录不完整，迁移已停止：${legacyIssues.join("；")}`);
  const baseline = parseStudyData(raw);
  let state = createBank(createLibrary(options.deviceId), options.name ?? "电力交易员四级", { id: LEGACY_BANK_ID, now: "1970-01-01T00:00:00.000Z" });
  const bank = getBank(state);
  for (const question of questions) {
    const id = question.id;
    const revisionId = `legacy_${id}`;
    const input: QuestionInput = { type: question.type, stem: question.stem, options: clone(question.options), answers: [...question.answers],
      domain: question.domain, answerOrigin: "source", sources: question.sources.map((label) => ({ file: question.sourceFile, label, ordinal: String(question.sourceOrdinal) })),
      ...(question.sourceNote ? { sourceNote: question.sourceNote } : {}) };
    const fingerprint = questionFingerprint(input);
    const revision: QuestionRevision = { ...input, id: revisionId, questionId: id, createdAt: bank.createdAt,
      reason: "保留旧题库身份", fingerprint, learningKey: fingerprint };
    bank.questions[id] = { id, activeRevisionId: revisionId, revisions: { [revisionId]: revision }, inactive: false, updatedAt: bank.createdAt };
  }
  bank.baseline = clone(baseline);
  bank.baselineId = contentDigest(baseline);
  bank.examSessions = clone(baseline.exams ?? {});
  bank.examHistory = Object.fromEntries(Object.values(bank.examSessions).map((attempt) => [examSessionId(attempt), clone(attempt)]));
  bank.legacy = { migratedAt: timestamp(options.now), sourceVersion: 1,
    unknownQuestionIds: Object.keys(baseline.questions).filter((id) => !bank.questions[id]) };
  for (const paper of papers) {
    if (paper.items.some((item) => !bank.questions[item.questionId])) continue;
    const content: Omit<FrozenPaper, "digest"> = { id: paper.id, bankId: bank.id, title: paper.title, createdAt: bank.createdAt,
      durationMinutes: paper.durationMinutes, scoreMode: "exact", kind: "original", totalScore: paper.totalScore,
      declaredTotalScore: paper.declaredTotalScore, sourceFile: paper.sourcePdf, ruleNote: paper.ruleNote,
      items: paper.items.map((item) => ({ ...item, revisionId: bank.questions[item.questionId]!.activeRevisionId,
        snapshot: clone(activeRevision(bank.questions[item.questionId]!)) })) };
    bank.papers[paper.id] = { ...content, digest: paperDigest(content) };
    const attempt = bank.examSessions[paper.id];
    if (attempt?.paperDigest === paper.sourceSha256) {
      const compatible = { ...attempt, paperDigest: bank.papers[paper.id]!.digest };
      bank.examSessions[paper.id] = compatible;
      bank.examHistory[examSessionId(compatible)] = clone(compatible);
    }
  }
  let withHistory = bank;
  for (const attempt of Object.values(bank.examHistory)) withHistory = storeExamAttempt(withHistory, attempt,
    `legacy_exam_${contentDigest(attempt)}`, "1970-01-01T00:00:00.000Z");
  state = updateBank(state, withHistory);
  const checked = validateLibrary(state);
  if (!checked.valid) throw new Error(`迁移校验失败：${checked.issues.join("；")}`);
  return state;
}

function isQuestionInput(value: unknown): value is QuestionInput {
  return isRecord(value) && typeof value.type === "string" && TYPES.includes(value.type as QuestionType)
    && typeof value.stem === "string" && typeof value.domain === "string"
    && Array.isArray(value.options) && value.options.every((option) => isRecord(option) && typeof option.key === "string" && typeof option.text === "string")
    && Array.isArray(value.answers) && value.answers.every((answer) => typeof answer === "string")
    && (value.attachmentIds === undefined || Array.isArray(value.attachmentIds) && value.attachmentIds.every(safeId))
    && (value.sources === undefined || Array.isArray(value.sources) && value.sources.every((source) => isRecord(source) && typeof source.file === "string"));
}

function validAttempt(value: unknown): boolean {
  if (!isRecord(value) || !safeId(value.paperId) || typeof value.paperDigest !== "string"
    || !finite(value.startedAt) || !finite(value.deadlineAt) || value.deadlineAt <= value.startedAt
    || !Number.isInteger(value.index) || (value.index as number) < 0 || !isRecord(value.answers)) return false;
  if (!Object.entries(value.answers).every(([key, selected]) => /^\d+$/.test(key) && Number(key) >= 1
    && Array.isArray(selected) && selected.every((answer) => typeof answer === "string"))) return false;
  if (value.submittedAt !== undefined && (!finite(value.submittedAt) || value.submittedAt < value.startedAt
    || !finite(value.score) || value.score < 0 || !Number.isInteger(value.correctCount) || (value.correctCount as number) < 0
    || !Number.isInteger(value.answeredCount) || (value.answeredCount as number) < (value.correctCount as number))) return false;
  return true;
}

function validateLegacyBaseline(raw: unknown): string[] {
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.questions) || !isRecord(raw.cursors) || !Array.isArray(raw.history)) return ["旧学习记录结构无效"];
  const issues: string[] = [];
  for (const [id, value] of Object.entries(raw.questions)) {
    if (!safeId(id) || !isRecord(value) || ![value.attempts, value.correctCount, value.wrongCount].every((count) => finite(count) && Number.isInteger(count) && count >= 0)
      || value.attempts !== (value.correctCount as number) + (value.wrongCount as number)
      || typeof value.isWrong !== "boolean" || typeof value.bookmarked !== "boolean"
      || value.lastCorrect !== null && typeof value.lastCorrect !== "boolean"
      || value.lastAnsweredAt !== null && (typeof value.lastAnsweredAt !== "string" || !Number.isFinite(Date.parse(value.lastAnsweredAt)))) issues.push(`旧题目 ${id} 统计无效`);
  }
  for (const [key, cursor] of Object.entries(raw.cursors)) if (!safeId(key) || !isRecord(cursor) || !safeId(cursor.questionId)
    || !Number.isFinite(Date.parse(String(cursor.updatedAt)))) issues.push(`旧断点 ${key} 无效`);
  if (raw.history.length > 500) issues.push("旧活动明细超过原版本上限，请先核对，不能截断迁移");
  for (const entry of raw.history) if (!isRecord(entry) || !safeId(entry.questionId) || typeof entry.correct !== "boolean"
    || !Number.isFinite(Date.parse(String(entry.answeredAt)))) issues.push("旧活动明细无效");
  if (raw.exams !== undefined && (!isRecord(raw.exams) || !Object.entries(raw.exams).every(([id, attempt]) => safeId(id) && validAttempt(attempt)))) issues.push("旧考试记录无效");
  return issues;
}

/** Strict validation: corrupted persisted data must never become an empty successful load. */
function validateLibraryInternal(raw: unknown): ValidationResult {
  const issues: string[] = [];
  if (!isRecord(raw) || raw.version !== 2 || !safeId(raw.deviceId) || !isRecord(raw.banks)
    || !isRecord(raw.events) || !Array.isArray(raw.conflicts)) return { valid: false, issues: ["题库格式或版本无效"] };
  if (raw.activeBankId !== null && (!safeId(raw.activeBankId) || !raw.banks[raw.activeBankId])) issues.push("当前题库不存在");
  const selectedBank = typeof raw.activeBankId === "string" ? raw.banks[raw.activeBankId] : undefined;
  if (isRecord(selectedBank) && selectedBank.deletedAt) issues.push("当前题库已删除");
  for (const [id, value] of Object.entries(raw.banks)) {
    if (!safeId(id) || !isRecord(value) || value.id !== id || typeof value.name !== "string" || !value.name.trim()
      || typeof value.reviewEnabled !== "boolean" || !isRecord(value.questions) || !isRecord(value.candidates)
      || !isRecord(value.papers) || !isRecord(value.attachments) || !isRecord(value.baseline)
      || !isRecord(value.examSessions) || !isRecord(value.examHistory) || !isRecord(value.examWrites) || !isRecord(value.examHeads)
      || !Number.isFinite(Date.parse(String(value.createdAt))) || !Number.isFinite(Date.parse(String(value.updatedAt)))
      || !Number.isFinite(Date.parse(String(value.nameUpdatedAt))) || !Number.isFinite(Date.parse(String(value.reviewUpdatedAt)))) {
      issues.push(`题库 ${id} 结构无效`); continue;
    }
    if (value.deletedAt !== undefined && (typeof value.deletedAt !== "string" || !Number.isFinite(Date.parse(value.deletedAt)))) issues.push(`题库 ${id} 删除标记无效`);
    if (value.baseline.version !== 1 || !isRecord(value.baseline.questions) || !isRecord(value.baseline.cursors)
      || !Array.isArray(value.baseline.history) || value.baselineId !== contentDigest(value.baseline)) issues.push(`题库 ${id} 旧数据基线校验失败`);
    issues.push(...validateLegacyBaseline(value.baseline));
    for (const [questionId, candidate] of Object.entries(value.questions)) {
      if (!safeId(questionId) || !isRecord(candidate) || candidate.id !== questionId || !isRecord(candidate.revisions)
        || !safeId(candidate.activeRevisionId) || !candidate.revisions[candidate.activeRevisionId] || typeof candidate.inactive !== "boolean"
        || !Number.isFinite(Date.parse(String(candidate.updatedAt)))) { issues.push(`题目 ${questionId} 结构无效`); continue; }
      for (const [revisionId, revision] of Object.entries(candidate.revisions)) {
        if (!safeId(revisionId) || !isQuestionInput(revision) || !isRecord(revision) || revision.id !== revisionId
          || revision.questionId !== questionId || !Number.isFinite(Date.parse(String(revision.createdAt)))
          || typeof revision.reason !== "string" || revision.fingerprint !== questionFingerprint(revision)
          || revision.learningKey !== revision.fingerprint
          || (revision.parentRevisionId !== undefined && (!safeId(revision.parentRevisionId) || !candidate.revisions[revision.parentRevisionId]))) {
          issues.push(`题目 ${questionId} 修订 ${revisionId} 校验失败`); continue;
        }
        const invalid = validateQuestion(revision);
        if (invalid.length) issues.push(`题目 ${questionId}：${invalid.join("、")}`);
      }
      const question = candidate as unknown as LibraryQuestion;
      for (const revision of Object.values(question.revisions)) {
        const seen = new Set<string>();
        let cursor: string | undefined = revision.id;
        while (cursor) {
          if (seen.has(cursor)) { issues.push(`题目 ${questionId} 修订链形成循环`); break; }
          seen.add(cursor);
          cursor = question.revisions[cursor]?.parentRevisionId;
        }
      }
    }
    for (const [candidateId, candidate] of Object.entries(value.candidates)) {
      if (!safeId(candidateId) || !isRecord(candidate) || candidate.id !== candidateId || !isQuestionInput(candidate.input)
        || !Array.isArray(candidate.issues) || !candidate.issues.every((issue) => typeof issue === "string")
        || candidate.ancestorDigests !== undefined && (!Array.isArray(candidate.ancestorDigests) || !candidate.ancestorDigests.every((digest) => typeof digest === "string"))
        || !["pending", "accepted", "duplicate"].includes(String(candidate.status))
        || candidate.status !== "pending" && (!safeId(candidate.questionId) || !value.questions[candidate.questionId])) issues.push(`候选题 ${candidateId} 无效`);
    }
    for (const [attachmentId, attachment] of Object.entries(value.attachments)) {
      if (!safeId(attachmentId) || !isRecord(attachment) || attachment.id !== attachmentId || typeof attachment.path !== "string"
        || attachment.path.startsWith("/") || attachment.path.split(/[\\/]/).includes("..") || typeof attachment.mimeType !== "string"
        || (attachment.dataBase64 !== undefined && (typeof attachment.dataBase64 !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(attachment.dataBase64)))) issues.push(`附件 ${attachmentId} 无效`);
    }
    for (const [paperId, paper] of Object.entries(value.papers)) {
      if (!safeId(paperId) || !isRecord(paper) || paper.id !== paperId || paper.bankId !== id
        || !Array.isArray(paper.items) || paper.items.length === 0 || paper.items.length > MAX_PAPER_QUESTIONS
        || !finite(paper.durationMinutes) || paper.durationMinutes <= 0 || !["exact", "proportional"].includes(String(paper.scoreMode))
        || paper.digest !== paperDigest(paper as unknown as FrozenPaper)) { issues.push(`试卷 ${paperId} 校验失败`); continue; }
      let total = 0;
      const ordinals = new Set<number>();
      for (const item of paper.items) {
        if (!isRecord(item) || !Number.isInteger(item.ordinal) || (item.ordinal as number) < 1 || ordinals.has(item.ordinal as number)
          || !finite(item.points) || item.points < 0 || !isQuestionInput(item.snapshot)
          || !isRecord(item.snapshot) || item.snapshot.id !== item.revisionId || item.snapshot.questionId !== item.questionId
          || item.snapshot.fingerprint !== questionFingerprint(item.snapshot) || validateQuestion(item.snapshot).length) {
          issues.push(`试卷 ${paperId} 题目快照无效`); continue;
        }
        ordinals.add(item.ordinal as number);
        total += item.points;
      }
      if (!finite(paper.totalScore) || Math.abs(total - paper.totalScore) > 1e-8) issues.push(`试卷 ${paperId} 总分不一致`);
    }
    for (const [attemptId, attempt] of Object.entries(value.examSessions)) if (!safeId(attemptId) || !validAttempt(attempt)) issues.push(`考试 ${attemptId} 记录无效`);
    for (const [attemptId, attempt] of Object.entries(value.examHistory)) if (!safeId(attemptId) || !validAttempt(attempt)
      || attemptId !== examSessionId(attempt as { paperId: string; startedAt: number })) issues.push(`历史考试 ${attemptId} 记录无效`);
    for (const [writeId, write] of Object.entries(value.examWrites)) {
      if (!safeId(writeId) || !isRecord(write) || write.id !== writeId || !safeId(write.sessionId)
        || !validAttempt(write.attempt) || !Number.isFinite(Date.parse(String(write.at)))
        || !Array.isArray(write.parentIds) || !write.parentIds.every((id) => safeId(id) && Boolean((value.examWrites as Record<string, unknown>)[id]))
        || write.sessionId !== examSessionId(write.attempt as { paperId: string; startedAt: number })) issues.push(`考试修订 ${writeId} 无效`);
    }
    for (const [sessionId, head] of Object.entries(value.examHeads)) {
      const write = typeof head === "string" ? value.examWrites[head] : undefined;
      if (!safeId(sessionId) || !isRecord(write) || write.sessionId !== sessionId) issues.push(`考试断点 ${sessionId} 无效`);
    }
  }
  for (const [id, event] of Object.entries(raw.events)) {
    if (!safeId(id) || !isRecord(event) || event.id !== id || !safeId(event.deviceId) || !safeId(event.bankId)
      || !safeId(event.questionId) || !safeId(event.revisionId) || !Number.isFinite(Date.parse(String(event.at)))) { issues.push(`学习事件 ${id} 无效`); continue; }
    const bank = raw.banks[event.bankId];
    const question = isRecord(bank) && isRecord(bank.questions) ? bank.questions[event.questionId] : undefined;
    if (!isRecord(question) || !isRecord(question.revisions) || !question.revisions[event.revisionId]) issues.push(`学习事件 ${id} 缺少题目修订版`);
    if (event.kind === "answer") {
      if (typeof event.correct !== "boolean" || typeof event.guessed !== "boolean" || typeof event.reviewEligible !== "boolean"
        || !["practice", "exam", "review"].includes(String(event.context))) issues.push(`作答事件 ${id} 无效`);
    } else if (event.kind === "bookmark") {
      if (typeof event.value !== "boolean") issues.push(`收藏事件 ${id} 无效`);
    } else if (event.kind === "cursor") {
      if (typeof event.key !== "string" || !event.key) issues.push(`断点事件 ${id} 无效`);
    } else if (event.kind !== "review-enroll" && event.kind !== "review-reset") issues.push(`未知事件类型 ${id}`);
  }
  for (const conflict of raw.conflicts) if (!isRecord(conflict) || !safeId(conflict.id) || !safeId(conflict.bankId)
    || !safeId(conflict.entityId) || !["revision", "question-head", "event", "baseline", "paper", "exam", "exam-write", "attachment", "candidate", "bank"].includes(String(conflict.kind))) issues.push("冲突记录无效");
  return { valid: issues.length === 0, issues };
}

export function validateLibrary(raw: unknown): ValidationResult {
  try { return validateLibraryInternal(raw); }
  catch { return { valid: false, issues: ["题库包含无法读取的嵌套字段，原记录未被修改"] }; }
}

export function parseLibrary(raw: unknown): LibraryState | null {
  try {
    const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    return validateLibrary(value).valid ? clone(value as LibraryState) : null;
  } catch { return null; }
}

function missingBackupAttachments(state: LibraryState): string[] {
  const missing: string[] = [];
  for (const bank of Object.values(state.banks)) {
    const required = new Set(Object.values(bank.questions).flatMap((question) => Object.values(question.revisions).flatMap((revision) => revision.attachmentIds ?? [])));
    for (const paper of Object.values(bank.papers)) for (const item of paper.items) for (const id of item.snapshot.attachmentIds ?? []) required.add(id);
    for (const id of required) if (!bank.attachments[id]?.dataBase64) missing.push(`${bank.name}/${id}`);
  }
  return missing;
}

export function createBackup(state: LibraryState, now?: string): LibraryBackup {
  const checked = validateLibrary(state);
  if (!checked.valid) throw new Error(`备份校验失败：${checked.issues.join("；")}`);
  const missing = missingBackupAttachments(state);
  if (missing.length) throw new Error(`完整备份缺少必需附件内容：${missing.join("、")}`);
  const library = clone(state);
  return { format: "yiji-library-backup", version: 1, createdAt: timestamp(now), checksum: contentDigest(library), library };
}

export function restoreBackup(raw: unknown, deviceId?: string): LibraryState {
  let value: unknown;
  try { value = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { throw new Error("备份不是有效 JSON"); }
  if (!isRecord(value) || value.format !== "yiji-library-backup" || value.version !== 1
    || typeof value.checksum !== "string" || value.checksum !== contentDigest(value.library)) throw new Error("备份格式或校验和不一致");
  const state = parseLibrary(value.library);
  if (!state) throw new Error(`备份内容无效：${validateLibrary(value.library).issues.join("；")}`);
  const missing = missingBackupAttachments(state);
  if (missing.length) throw new Error(`备份缺少必需附件：${missing.join("、")}`);
  if (deviceId) {
    if (!safeId(deviceId)) throw new Error("设备标识无效");
    state.deviceId = deviceId;
  }
  return state;
}

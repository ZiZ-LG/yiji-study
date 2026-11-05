import { Notice, requireApiVersion } from "obsidian";
import type { App } from "obsidian";
import {
  createBank, createLibrary, getActiveBank, getActiveQuestions, getBankStudyData,
  getPaperQuestions, getReviewQueue, migrateLegacy, newLibraryId,
  contentDigest, examSessionId, getLearningEvidence, markReviewAgain, mergeLibrary, recordAnswerEvent, recordStudyTransition, selectBank, stageCandidates, toExamPaper,
} from "../library";
import type { LibraryState, QuestionRevision } from "../library";
import type { StudyDataV1, WrongAction } from "../state/study-state";
import type { Question } from "../domain/question";
import type { ExamPaper } from "../content/exam-paper";
import { buildQuestionBankFromQuestions, loadQuestionBank } from "../data/question-bank";
import { ACTIVE_CONTENT_PACKAGE } from "../content/content-package";
import type { StudyContentPackage } from "../content/content-package";
import { EMBEDDED_EXAM_PAPERS, EMBEDDED_QUESTIONS } from "../generated/electricity-trader-pack";
import { LibraryRepository } from "../storage/library-repository";
import { ObsidianFiles } from "../storage/obsidian-files";
import { inspectQuestionNote, renderQuestionNote } from "../storage/question-notes";

export interface YijiSettings {
  version: 2;
  root: string;
  activeBankId: string | null;
  ai: { mode: "codex" | "api"; endpoint: string; model: string; supportsImages: boolean };
}

export const defaultSettings = (): YijiSettings => ({ version: 2, root: "易记题库", activeBankId: null,
  ai: { mode: "codex", endpoint: "https://api.openai.com/v1/chat/completions", model: "", supportsImages: false } });

export interface ExamHistorySummary {
  id: string;
  paperId: string;
  title: string;
  startedAt: number;
  submittedAt?: number;
  score?: number;
  totalScore?: number;
  answeredCount?: number;
  unknownContentVersion: boolean;
  conflicted: boolean;
}

export class LibraryController {
  readonly files: ObsidianFiles;
  readonly repository: LibraryRepository;
  readonly deviceId: string;
  settings: YijiSettings;
  state: LibraryState;
  private mutationQueue: Promise<unknown> = Promise.resolve();
  private sessionKey = "";
  private historySelection: { bankId: string; attemptId: string } | null = null;
  private missingAttachments = new Set<string>();

  constructor(readonly app: App, private readonly saveSettings: (settings: YijiSettings) => Promise<void>, raw: unknown) {
    this.files = new ObsidianFiles(app.vault);
    const id = window.localStorage.getItem("yiji-study-device-id") || newLibraryId("device");
    window.localStorage.setItem("yiji-study-device-id", id);
    this.deviceId = id;
    this.settings = defaultSettings();
    if (raw && typeof raw === "object" && "version" in raw && raw.version === 2) {
      const value = raw as Partial<YijiSettings>;
      if (typeof value.root === "string") this.settings.root = value.root;
      if (typeof value.activeBankId === "string") this.settings.activeBankId = value.activeBankId;
      if (value.ai && typeof value.ai === "object") {
        this.settings.ai = { mode: value.ai.mode === "api" ? "api" : "codex",
          endpoint: typeof value.ai.endpoint === "string" ? value.ai.endpoint : "",
          model: typeof value.ai.model === "string" ? value.ai.model : "", supportsImages: value.ai.supportsImages === true };
      }
    }
    this.repository = new LibraryRepository(this.files, this.settings.root, id);
    this.settings.root = this.repository.root;
    this.state = createLibrary(id);
  }

  async initialize(raw: unknown): Promise<void> {
    const loaded = await this.repository.load();
    let migrated: LibraryState | undefined;
    // A second device may still have unsynced v1 totals even when another device already wrote v2.
    // Back up and retain that baseline instead of replacing it with settings-only v2 data.
    if (raw && typeof raw === "object" && "version" in raw && raw.version === 1) {
      const backupPath = `${this.settings.root}/备份/旧版学习记录-${this.deviceId}.json`;
      const text = JSON.stringify(raw);
      if (!await this.files.exists(backupPath)) await this.files.write(backupPath, text);
      if (await this.files.read(backupPath) !== text) throw new Error("旧版备份与当前记录不同，迁移已停止。");
      const oldBank = await loadQuestionBank(this.app.vault);
      migrated = migrateLegacy(raw, oldBank.questions, EMBEDDED_EXAM_PAPERS, { deviceId: this.deviceId });
    }
    if (loaded.state) {
      this.state = migrated ? await this.repository.save(mergeLibrary(loaded.state, migrated)) : loaded.state;
      if (this.settings.activeBankId && this.state.banks[this.settings.activeBankId] && !this.state.banks[this.settings.activeBankId]?.deletedAt) {
        this.state = selectBank(this.state, this.settings.activeBankId);
      }
    } else if (migrated) {
      this.state = await this.repository.save(migrated);
    } else {
      if (raw && typeof raw === "object" && "version" in raw && raw.version === 2) {
        throw new Error("已有题库记录尚未读取到，请等待资料同步完成后重新打开易记。已停止初始化，原记录和设置未被覆盖。");
      }
      if (raw !== null && raw !== undefined && (typeof raw !== "object" || !("version" in raw) || raw.version !== 2)) {
        throw new Error("无法识别旧数据格式，已停止初始化；原数据未被覆盖。");
      }
      this.state = createBank(this.state, "我的题库");
      this.state = await this.repository.save(this.state);
    }
    this.settings.activeBankId = this.state.activeBankId;
    await this.saveSettings(this.settings);
    await this.scanExternalQuestionNotes();
    await this.checkRequiredAttachments();
    for (const warning of loaded.warnings) new Notice(warning, 10000);
  }

  refresh(): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      const loaded = await this.repository.load();
      if (loaded.state) {
        const selected = this.state.activeBankId;
        this.state = loaded.state;
        if (selected && this.state.banks[selected] && !this.state.banks[selected]?.deletedAt) this.state = selectBank(this.state, selected);
      }
      await this.scanQuestionNotesNow();
      await this.checkRequiredAttachments();
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  mutate(transform: (state: LibraryState) => LibraryState | Promise<LibraryState>): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      const before = this.state;
      const proposed = await transform(before);
      this.state = await this.repository.save(proposed);
      if (this.historySelection?.bankId !== this.state.activeBankId) this.historySelection = null;
      this.settings.activeBankId = this.state.activeBankId;
      try {
        await this.saveSettings(this.settings);
        await this.checkRequiredAttachments();
        await this.writeQuestionNotes(before, this.state);
      } catch {
        new Notice("学习记录已保存。设置或可读题目副本未完成更新，请重新打开易记检查。", 10000);
      }
    });
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  getStudyData(): StudyDataV1 {
    const data = getBankStudyData(this.state);
    const selected = this.historySelection;
    if (selected && selected.bankId === this.state.activeBankId) {
      const attempt = this.state.banks[selected.bankId]?.examHistory[selected.attemptId];
      if (attempt) return { ...data, exams: { ...data.exams, [attempt.paperId]: attempt } };
    }
    return data;
  }

  async persistStudyData(next: StudyDataV1): Promise<void> {
    if (this.historySelection) throw new Error("历史考试为只读，请返回当前试卷后再作答。");
    const previous = this.getStudyData();
    const bankId = this.state.activeBankId ?? undefined;
    await this.mutate((state) => recordStudyTransition(state, previous, next, { bankId }));
  }

  async submitPracticeAnswer(questionId: string, expectedRevisionId: string, selected: readonly string[], context: "practice" | "review"): Promise<WrongAction> {
    if (this.historySelection) throw new Error("请退出历史考试回顾后再练习。");
    const bankId = this.state.activeBankId;
    let wrongAction: WrongAction = "correct";
    await this.mutate(async (state) => {
      const bank = bankId ? state.banks[bankId] : undefined;
      const question = bank?.questions[questionId];
      if (!bank || bank.deletedAt || !question || question.inactive) throw new Error("这道题已停用或题库不可用，请重新选择练习。");
      if (question.activeRevisionId !== expectedRevisionId) throw new Error("题目版本已变化，请重新读取这道题后再提交。");
      const revision = question.revisions[expectedRevisionId]!;
      if (!getActiveQuestions(state, bank.id).some((entry) => entry.id === questionId)) throw new Error("这道题存在未解决问题，请先核对。");
      if (!selected.length || new Set(selected).size !== selected.length || selected.some((key) => !revision.options.some((option) => option.key === key))
        || revision.type !== "multiple" && selected.length !== 1) throw new Error("所选答案无效，请重新选择。");
      for (const id of revision.attachmentIds ?? []) {
        const attachment = bank.attachments[id];
        if (!attachment || !await this.files.exists(attachment.path)) throw new Error("答题必需图片缺失，请恢复后再提交。");
      }
      const progress = getBankStudyData(state, bank.id).questions[questionId];
      const correct = selected.length === revision.answers.length && selected.every((key) => revision.answers.includes(key));
      wrongAction = correct ? progress?.isWrong ? "removed" : "correct" : progress?.isWrong ? "kept" : "added";
      return recordAnswerEvent(state, questionId, correct, { bankId: bank.id, revisionId: expectedRevisionId,
        id: `practice_${contentDigest({ bankId: bank.id, deviceId: state.deviceId, questionId, revisionId: expectedRevisionId,
          priorAttempts: progress?.attempts ?? 0, selected: [...selected].sort(), context })}`,
        selected: [...selected], context });
    });
    return wrongAction;
  }

  getQuestionBank() {
    const bank = getActiveBank(this.state);
    const questions = getActiveQuestions(this.state).filter((question) => {
      const revision = bank?.questions[question.id]?.revisions[bank.questions[question.id]!.activeRevisionId];
      return !revision?.attachmentIds?.some((id) => this.missingAttachments.has(`${bank?.id}:${id}`));
    });
    return buildQuestionBankFromQuestions(questions, bank?.legacy ? ACTIVE_CONTENT_PACKAGE.domains : []);
  }

  getContentPackage(): StudyContentPackage {
    const bank = getActiveBank(this.state);
    if (bank?.legacy) return { ...ACTIVE_CONTENT_PACKAGE, name: bank.name };
    const questions = getActiveQuestions(this.state);
    return { ...ACTIVE_CONTENT_PACKAGE, id: bank?.id ?? "empty", name: bank?.name ?? "我的题库",
      domains: [...new Set(questions.map((question) => question.domain))], knowledgeRoot: "", questionBankRoot: this.settings.root,
      exam: { ...ACTIVE_CONTENT_PACKAGE.exam, papers: [] } };
  }

  getExamPapers(): ExamPaper[] {
    return Object.values(getActiveBank(this.state)?.papers ?? {}).map(toExamPaper);
  }

  getExamQuestions(paper: ExamPaper): Map<string, Question> {
    const frozen = getActiveBank(this.state)?.papers[paper.id];
    if (!frozen || frozen.digest !== paper.sourceSha256) throw new Error("试卷快照不存在或版本不一致。");
    if (frozen.items.some((item) => item.snapshot.attachmentIds?.some((id) => this.missingAttachments.has(`${frozen.bankId}:${id}`)))) {
      throw new Error("试卷必需题图缺失，请恢复附件后再开始或回顾。");
    }
    const attempt = this.getStudyData().exams?.[paper.id];
    if (this.state.conflicts.some((conflict) => !conflict.resolved && conflict.bankId === this.state.activeBankId
      && (conflict.kind === "paper" && conflict.entityId === paper.id || conflict.kind === "exam" && attempt && conflict.entityId === examSessionId(attempt)))) {
      throw new Error("该试卷或作答存在同步冲突，请先在管理页解决。");
    }
    return getPaperQuestions(frozen);
  }

  getReviewIds(): string[] {
    const usable = new Set(this.getQuestionBank().questions.map((question) => question.id));
    return getReviewQueue(this.state).filter((entry) => usable.has(entry.questionId)).map((entry) => entry.questionId);
  }
  getReviewCount(): number { return this.getReviewIds().length; }
  getLearningEvidence() { return getLearningEvidence(this.state); }
  reloadFromDisk(): Promise<void> { return this.refresh(); }
  reviewEnabled(): boolean { return getActiveBank(this.state)?.reviewEnabled === true; }

  async markGuessed(questionId: string): Promise<void> {
    await this.mutate((state) => markReviewAgain(state, questionId));
  }

  getExamHistory(): ExamHistorySummary[] {
    const bank = getActiveBank(this.state);
    if (!bank) return [];
    return Object.entries(bank.examHistory).map(([id, attempt]) => {
      const paper = bank.papers[attempt.paperId];
      return { id, paperId: attempt.paperId, title: paper?.title ?? attempt.paperId, startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt, score: attempt.score, totalScore: paper?.totalScore, answeredCount: attempt.answeredCount,
        unknownContentVersion: !paper || attempt.paperDigest !== paper.digest,
        conflicted: this.state.conflicts.some((item) => !item.resolved && item.bankId === bank.id && item.kind === "exam" && item.entityId === id) };
    }).sort((a, b) => b.startedAt - a.startedAt);
  }

  selectExamHistory(attemptId: string): string {
    const bank = getActiveBank(this.state);
    const attempt = bank?.examHistory[attemptId];
    if (!bank || !attempt) throw new Error("历史考试不存在");
    if (attempt.submittedAt === undefined) throw new Error("该次考试尚未交卷，请从模考入口继续。");
    if (bank.papers[attempt.paperId]?.digest !== attempt.paperDigest) throw new Error("历史内容版本不明，仅保留已有成绩，无法补造答案回顾。");
    if (this.getExamHistory().find((item) => item.id === attemptId)?.conflicted) throw new Error("该次考试存在同步冲突，请先在管理页解决。");
    this.historySelection = { bankId: bank.id, attemptId };
    return attempt.paperId;
  }

  clearExamHistorySelection(): void { this.historySelection = null; }

  getRevision(questionId: string): QuestionRevision | undefined {
    const question = getActiveBank(this.state)?.questions[questionId];
    return question?.revisions[question.activeRevisionId];
  }

  async installLegacy(): Promise<void> {
    await this.mutate((state) => {
      const legacyId = ACTIVE_CONTENT_PACKAGE.id;
      if (state.banks[legacyId]) return selectBank(state, legacyId);
      const legacy = migrateLegacy({ version: 1, questions: {}, cursors: {}, history: [] }, EMBEDDED_QUESTIONS, EMBEDDED_EXAM_PAPERS,
        { deviceId: state.deviceId });
      return { ...state, activeBankId: legacyId, banks: { ...state.banks, ...legacy.banks } };
    });
  }

  getApiKey(): string {
    if (requireApiVersion("1.11.4")) return this.app.secretStorage?.getSecret("yiji-study-api-key") ?? this.sessionKey;
    return this.sessionKey;
  }

  setApiKey(key: string): void {
    if (requireApiVersion("1.11.4") && this.app.secretStorage) this.app.secretStorage.setSecret("yiji-study-api-key", key);
    else this.sessionKey = key;
  }

  private async checkRequiredAttachments(): Promise<void> {
    const missing = new Set<string>();
    const bank = getActiveBank(this.state);
    if (bank) {
      const required = new Set(Object.values(bank.questions).flatMap((question) =>
        Object.values(question.revisions).flatMap((revision) => revision.attachmentIds ?? [])));
      for (const paper of Object.values(bank.papers)) for (const item of paper.items) for (const id of item.snapshot.attachmentIds ?? []) required.add(id);
      for (const id of required) {
        const attachment = bank.attachments[id];
        if (!attachment || !await this.files.exists(attachment.path)) missing.add(`${bank.id}:${id}`);
      }
    }
    const newlyMissing = [...missing].filter((id) => !this.missingAttachments.has(id));
    this.missingAttachments = missing;
    if (newlyMissing.length) new Notice(`缺少 ${newlyMissing.length} 个答题必需附件，相关题目已暂停计分。请恢复附件后重新读取。`, 10000);
  }

  /** Only inspect generated notes in the active bank's own folder. Never apply a text edit silently. */
  scanExternalQuestionNotes(): Promise<number> {
    const operation = this.mutationQueue.then(() => this.scanQuestionNotesNow());
    this.mutationQueue = operation.catch(() => undefined);
    return operation;
  }

  private async scanQuestionNotesNow(): Promise<number> {
    const bank = getActiveBank(this.state);
    if (!bank || bank.legacy) return 0;
    let proposed = this.state;
    let count = 0;
    const directory = `${this.settings.root}/题目/${bank.id}`;
    for (const path of await this.files.list(directory)) {
      if (!path.endsWith(".md")) continue;
      const name = path.slice(directory.length + 1);
      const question = Object.values(bank.questions).find((item) => name === `${item.id}.md` || name.startsWith(`${item.id}-`));
      if (!question) continue;
      const content = await this.files.read(path);
      const inspected = inspectQuestionNote(content, question);
      if (inspected.unchanged) continue;
      const batchId = `note-edit:${contentDigest({ path, content })}`;
      if (Object.values(proposed.banks[bank.id]!.candidates).some((item) => item.batchId === batchId)) continue;
      proposed = stageCandidates(proposed, [{ ...inspected.input, notePath: path }],
        { bankId: bank.id, batchId, issues: [inspected.issues], targetQuestionIds: [question.id] });
      count += 1;
    }
    if (count) {
      this.state = await this.repository.save(proposed);
      new Notice(`发现 ${count} 份题目笔记改动，已保存到待核对区；正式题库保持原样。`, 10000);
    }
    return count;
  }

  private async writeQuestionNotes(before: LibraryState, after: LibraryState): Promise<void> {
    for (const bank of Object.values(after.banks)) {
      if (bank.legacy) continue;
      for (const question of Object.values(bank.questions)) {
        if (before.banks[bank.id]?.questions[question.id]?.activeRevisionId === question.activeRevisionId) continue;
        const revision = question.revisions[question.activeRevisionId]!;
        const path = `${this.settings.root}/题目/${bank.id}/${question.id}.md`;
        const content = renderQuestionNote(revision);
        // Never overwrite an externally edited note; keep a separate revision for comparison.
        if (await this.files.exists(path)) {
          const current = await this.files.read(path);
          if (current === content) continue;
          const inspection = inspectQuestionNote(current, question);
          const destination = inspection.unchanged ? path : path.replace(/\.md$/, `-${revision.id}.md`);
          await this.files.write(destination, content);
          if (await this.files.read(destination) !== content) throw new Error("题目笔记保存后回读不一致");
        } else {
          await this.files.write(path, content);
          if (await this.files.read(path) !== content) throw new Error("题目笔记保存后回读不一致");
        }
      }
    }
  }
}

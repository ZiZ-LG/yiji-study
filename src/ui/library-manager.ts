import { App, Modal } from "obsidian";
import type {
  CommitOptions, ComposeOptions, FrozenPaper, ImportCandidate, LibraryBank,
  LibraryState, QuestionInput, SourceReference,
} from "../library/types";
import type { QuestionType } from "../domain/question";
import { getBankStudyData, getLearningEvidence } from "../library";
import { append, element } from "./dom";

export interface ManagerAiSettings {
  mode: "codex" | "api";
  endpoint: string;
  model: string;
  keyConfigured: boolean;
  supportsImages: boolean;
}

export interface ManagerImportSource {
  id: string;
  name: string;
  path: string;
  kind: string;
  pageCount: number;
  textPreview: string;
  issues: string[];
  batchId?: string;
  role?: "questions" | "answers" | "reference";
  paperTitle?: string;
  units?: { id: string; locator: string; page?: number; textPreview?: string; needsRecognition?: boolean; imageDataUrl?: string }[];
}

export interface ManagerAiScope {
  bankId: string;
  sourceIds: string[];
  unitIds: string[];
  pageFrom: number;
  pageTo: number;
  includeExplanations: boolean;
  confirmed: true;
}

export interface LibraryManagerSnapshot {
  library: LibraryState;
  ai: ManagerAiSettings;
  importSources?: ManagerImportSource[];
  candidateEvidence?: Record<string, { originalText: string; sourceLabel: string; reference?: SourceReference; imageDataUrl?: string }>;
}

export type LibraryManagerCommand =
  | { type: "install-legacy" }
  | { type: "create-bank"; name: string }
  | { type: "rename-bank"; bankId: string; name: string }
  | { type: "delete-bank"; bankId: string; confirmName: string }
  | { type: "review-external-notes"; bankId: string }
  | { type: "rename-domain"; bankId: string; from: string; to: string }
  | { type: "reset-review"; bankId: string; questionIds: string[] }
  | { type: "select-bank"; bankId: string }
  | { type: "save-question"; input: QuestionInput; options: CommitOptions; expectedRevisionId?: string }
  | { type: "set-inactive"; bankId: string; questionId: string; inactive: boolean }
  | { type: "preview-import"; bankId: string; files: { name: string; mimeType: string; bytes: ArrayBuffer; role: "questions" | "answers" | "reference"; paperTitle: string; pageFrom?: number; pageTo?: number }[] }
  | { type: "stage-text"; bankId: string; text: string; format: "markdown" | "csv" | "json" }
  | { type: "commit-candidate"; bankId: string; candidateId: string; input: QuestionInput; resolveConflict: boolean; reason: string }
  | { type: "commit-normal-candidates"; bankId: string; candidateIds: string[] }
  | { type: "configure-ai"; settings: Omit<ManagerAiSettings, "keyConfigured">; apiKey?: string }
  | { type: "run-ai"; scope: ManagerAiScope }
  | { type: "export-codex"; scope: ManagerAiScope }
  | { type: "import-codex"; bankId: string; text: string }
  | { type: "parse-compose"; bankId: string; prompt: string }
  | { type: "compose-paper"; options: ComposeOptions; freeze: boolean; preview?: FrozenPaper }
  | { type: "freeze-original"; options: {
    bankId: string; batchId: string; title: string; sourceFile: string; durationMinutes: number;
    scoreMode: "exact" | "proportional"; declaredTotalScore?: number; declaredQuestionCount: number;
    points: Record<QuestionType, number>; ruleNote: string; completenessConfirmed: true;
  } }
  | { type: "set-review"; bankId: string; enabled: boolean }
  | { type: "enroll-review"; bankId: string; questionIds: string[] }
  | { type: "export-backup"; includeSources: boolean; includeHistory: boolean }
  | { type: "restore-backup"; text: string; confirmed: boolean }
  | { type: "open-source"; reference: SourceReference }
  | { type: "resolve-conflict"; conflictId: string; choice: "local" | "remote" };

export interface LibraryManagerResult {
  message?: string;
  snapshot?: LibraryManagerSnapshot;
  text?: string;
  path?: string;
  paper?: FrozenPaper;
  composeOptions?: ComposeOptions;
  issues?: string[];
  shortages?: Partial<Record<QuestionType, number>>;
  restoreSummary?: string;
}

export interface LibraryManagerHost {
  getSnapshot(): Promise<LibraryManagerSnapshot>;
  execute(command: LibraryManagerCommand): Promise<LibraryManagerResult>;
}

type ManagerTab = "questions" | "import" | "compose" | "review" | "settings";
const TYPE_NAMES: Record<QuestionType, string> = { single: "单选", multiple: "多选", judge: "判断" };

interface QuestionForm {
  key: string;
  questionId?: string;
  baseRevisionId?: string;
  candidateId?: string;
  original?: QuestionInput;
  type: QuestionType;
  stem: string;
  optionsText: string;
  answersText: string;
  domain: string;
  tags: string;
  explanation: string;
  notePath: string;
  ruleVersion: string;
  sourceFile: string;
  sourcePage: string;
  sourceOrdinal: string;
  reason: string;
  checkedRisks: boolean;
  allowSeparate: boolean;
  dirty: boolean;
}

interface ManagerSession {
  tab: ManagerTab;
  search: string;
  showInactive: boolean;
  forms: Record<string, QuestionForm>;
  editingKey: string | null;
  libraryName: string;
  importRole: "questions" | "answers" | "reference";
  paperTitle: string;
  importText: string;
  importFormat: "markdown" | "csv" | "json";
  codexText: string;
  selectedUnits: Set<string>;
  selectedCandidates: Set<string>;
  scopeConfirmed: boolean;
  explanations: boolean;
  pageFrom: string;
  pageTo: string;
  composePrompt: string;
  composeTaskText: string;
  composeTitle: string;
  composeCounts: Record<QuestionType, string>;
  composePoints: Record<QuestionType, string>;
  composeMinutes: string;
  composeDomains: string;
  composeSources: string;
  composeFilter: "all" | "wrong" | "unanswered" | "bookmarked";
  scoreMode: "exact" | "proportional";
  composePreview?: FrozenPaper;
  composeSignature?: string;
  reviewIds: Set<string>;
  backupSources: boolean;
  backupHistory: boolean;
  restoreText: string;
  restoreFileName: string;
  restoreSummary: string;
  restoreChecked: boolean;
  resultText: string;
  expanded: Record<string, boolean>;
  originalBatchId: string;
  originalTitle: string;
  originalQuestionCount: string;
  originalScore: string;
  originalMinutes: string;
  originalPoints: Record<QuestionType, string>;
  originalRule: string;
  originalComplete: boolean;
  originalScoreMode: "exact" | "proportional";
  renameNames: Record<string, string>;
  deleteName: string;
  deleteAcknowledged: boolean;
  domainFrom: string;
  domainTo: string;
  domainConfirmed: boolean;
  resetReviewConfirmed: boolean;
  importPdfFrom: string;
  importPdfTo: string;
}

function initialSession(): ManagerSession {
  return {
    tab: "questions", search: "", showInactive: false, forms: {}, editingKey: null,
    libraryName: "", importRole: "questions", paperTitle: "", importText: "", importFormat: "markdown",
    codexText: "", selectedUnits: new Set(), selectedCandidates: new Set(), scopeConfirmed: false,
    explanations: false, pageFrom: "1", pageTo: "1", composePrompt: "", composeTaskText: "", composeTitle: "我的练习卷",
    composeCounts: { single: "10", multiple: "0", judge: "0" },
    composePoints: { single: "1", multiple: "1", judge: "1" }, composeMinutes: "30",
    composeDomains: "", composeSources: "", composeFilter: "all", scoreMode: "exact",
    reviewIds: new Set(), backupSources: true, backupHistory: true, restoreText: "", restoreFileName: "",
    restoreSummary: "", restoreChecked: false, resultText: "", expanded: {},
    originalBatchId: "", originalTitle: "", originalQuestionCount: "", originalScore: "", originalMinutes: "120",
    originalPoints: { single: "1", multiple: "1", judge: "1" }, originalRule: "", originalComplete: false, originalScoreMode: "exact",
    renameNames: {}, deleteName: "", deleteAcknowledged: false,
    domainFrom: "", domainTo: "", domainConfirmed: false, resetReviewConfirmed: false,
    importPdfFrom: "1", importPdfTo: "50",
  };
}

/** Accept explicit option keys; never infer an answer from option order. */
export function parseManagerOptions(text: string): { key: string; text: string }[] {
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const match = /^\s*([A-Za-z0-9对错]+)\s*[.．、:：)）\]\t]\s*(.+)$/.exec(line);
    if (!match?.[1] || !match[2]) throw new Error("每个选项请单独一行，格式为 A. 选项内容。");
    return { key: match[1].toUpperCase(), text: match[2].trim() };
  });
}

export function parseManagerAnswers(text: string): string[] {
  return [...new Set(text.trim().toUpperCase().split(/[\s,，、;；]+/).filter(Boolean))];
}

function asQuestionForm(key: string, input?: QuestionInput): QuestionForm {
  const source = input?.sources?.[0];
  return {
    key, original: input, type: input?.type ?? "single", stem: input?.stem ?? "",
    optionsText: input?.options.map((option) => `${option.key}. ${option.text}`).join("\n") ?? "A. \nB. ",
    answersText: input?.answers.join(", ") ?? "", domain: input?.domain ?? "",
    tags: input?.tags?.join("、") ?? "", explanation: input?.explanation ?? "",
    notePath: input?.notePath ?? "", ruleVersion: input?.ruleVersion ?? "", sourceFile: source?.file ?? "",
    sourcePage: source?.page?.toString() ?? "", sourceOrdinal: source?.ordinal ?? "",
    reason: "", checkedRisks: false, allowSeparate: false, dirty: false,
  };
}

export class LibraryManager extends Modal {
  private static readonly sessions = new WeakMap<App, ManagerSession>();
  private readonly session: ManagerSession;
  private snapshot: LibraryManagerSnapshot | null = null;
  private busy = false;
  private closed = false;
  private status = "正在读取题库…";
  private problems: string[] = [];
  private apiKey = "";
  private aiDraft: Omit<ManagerAiSettings, "keyConfigured"> | null = null;

  constructor(app: App, private readonly host: LibraryManagerHost) {
    super(app);
    this.session = LibraryManager.sessions.get(app) ?? initialSession();
    LibraryManager.sessions.set(app, this.session);
  }

  override onOpen(): void {
    this.closed = false;
    this.modalEl.classList.add("yiji-manager-modal");
    this.titleEl.textContent = "易记 · 我的题库";
    this.render();
    void this.reload();
  }

  override onClose(): void {
    this.closed = true;
    this.apiKey = "";
    this.contentEl.empty();
  }

  private async reload(): Promise<void> {
    try {
      this.snapshot = await this.host.getSnapshot();
      this.aiDraft ??= {
        mode: this.snapshot.ai.mode, endpoint: this.snapshot.ai.endpoint, model: this.snapshot.ai.model, supportsImages: this.snapshot.ai.supportsImages,
      };
      this.status = "题库已读取。修改内容后请保存；未提交的编辑在本次会话内保留。";
    } catch (error) {
      this.problems = [this.errorText(error)];
      this.status = "未能读取题库。";
    }
    this.render();
  }

  private bank(): LibraryBank | null {
    const state = this.snapshot?.library;
    const bank = state?.activeBankId ? state.banks[state.activeBankId] : undefined;
    return bank && !bank.deletedAt ? bank : null;
  }

  private async perform(
    command: LibraryManagerCommand,
    after?: (result: LibraryManagerResult) => void,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.problems = [];
    this.status = "正在处理，请稍候…";
    this.render();
    try {
      const result = await this.host.execute(command);
      this.snapshot = result.snapshot ?? await this.host.getSnapshot();
      this.status = result.message ?? "操作已完成。";
      this.problems = result.issues ?? [];
      if (result.shortages) {
        for (const type of ["single", "multiple", "judge"] as const) {
          const missing = result.shortages[type];
          if (missing && missing > 0) this.problems.push(`${TYPE_NAMES[type]}题还缺 ${missing} 道，请调整条件。`);
        }
      }
      if (result.text !== undefined) this.session.resultText = result.text;
      if (result.path) this.status += ` 已保存到 ${result.path}。`;
      after?.(result);
    } catch (error) {
      this.problems = [this.errorText(error)];
      this.status = "本次操作未完成，输入内容已保留。";
      try { this.snapshot = await this.host.getSnapshot(); } catch { /* Preserve the original failure and the unsaved form. */ }
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private render(): void {
    if (this.closed) return;
    this.titleEl.textContent = `易记 · ${this.bank()?.name ?? "题库管理"}`;
    const scrollTop = this.contentEl.scrollTop;
    this.contentEl.empty();
    this.contentEl.classList.add("yiji-manager");
    const status = element("div", { className: "yiji-manager-status", text: this.status, attrs: { role: "status", "aria-live": "polite" } });
    append(this.contentEl, status);
    if (this.problems.length) {
      const list = element("ul", { className: "yiji-manager-errors", attrs: { role: "alert" } });
      for (const problem of this.problems) append(list, element("li", { text: problem }));
      append(this.contentEl, list);
    }
    if (!this.snapshot) {
      append(this.contentEl, this.action("重新读取", () => { void this.reload(); }));
      return;
    }
    const activeForm = this.session.editingKey ? this.session.forms[this.session.editingKey] : undefined;
    const activeBank = this.bank();
    const editing = Boolean(activeForm && activeBank && activeForm.key.startsWith(`${activeBank.id}:`)
      && (this.session.tab === "questions" && !activeForm.candidateId
        || this.session.tab === "import" && activeForm.candidateId && activeBank.candidates[activeForm.candidateId]?.status === "pending"));
    this.contentEl.classList.toggle("is-editing", editing);
    this.renderBankBar();
    const nav = element("nav", { className: "yiji-manager-tabs", attrs: { "aria-label": "题库管理" } });
    const tabs: [ManagerTab, string][] = [["questions", "题目"], ["import", "导入核对"], ["compose", "组卷"], ["review", "巩固"], ["settings", "设置备份"]];
    for (const [id, name] of tabs) {
      const tab = this.action(name, () => { this.session.tab = id; this.contentEl.scrollTop = 0; this.render(); });
      tab.setAttribute("aria-current", this.session.tab === id ? "page" : "false");
      append(nav, tab);
    }
    append(this.contentEl, nav);
    const main = element("div", { className: "yiji-manager-main" });
    append(this.contentEl, main);
    if (!this.bank() && this.session.tab !== "settings") {
      append(main, this.empty("先建立一个题库", "填写上方名称并新建，随后可以导入资料或手工添加第一道题。"));
      return;
    }
    switch (this.session.tab) {
      case "questions": this.renderQuestions(main); break;
      case "import": this.renderImport(main); break;
      case "compose": this.renderCompose(main); break;
      case "review": this.renderReview(main); break;
      case "settings": this.renderSettings(main); break;
    }
    this.contentEl.scrollTop = scrollTop;
  }

  private renderBankBar(): void {
    const bar = element("div", { className: "yiji-manager-bankbar" });
    const banks = Object.values(this.snapshot?.library.banks ?? {}).filter((bank) => !bank.deletedAt);
    const select = this.select("当前题库", this.snapshot?.library.activeBankId ?? "", banks.map((bank) => [bank.id, bank.name]), (bankId) => {
      this.session.editingKey = null;
      this.session.composePreview = undefined;
      this.session.selectedCandidates.clear();
      this.session.selectedUnits.clear();
      this.session.scopeConfirmed = false;
      this.session.deleteName = "";
      this.session.deleteAcknowledged = false;
      this.session.domainFrom = ""; this.session.domainTo = ""; this.session.domainConfirmed = false;
      this.session.resetReviewConfirmed = false;
      void this.perform({ type: "select-bank", bankId });
    });
    append(bar, select, this.action("刷新题库", () => { void this.reload(); }, "quiet"), this.action("返回刷题", () => { this.close(); }, "quiet"));
    const management = this.details("bank-management", "yiji-manager-bank-management");
    if (!banks.length) management.open = true;
    const controls = element("div", { className: "yiji-manager-fields" });
    append(management, element("summary", { text: "新建或添加题库" }), controls);
    append(controls, this.textField("新题库名称", this.session.libraryName, (value) => { this.session.libraryName = value; }, { placeholder: "例如：职业资格 · 科目一" }));
    append(controls, this.action("新建题库", () => {
      const name = this.session.libraryName.trim();
      if (!name) { this.showProblem("请填写题库名称。"); return; }
      void this.perform({ type: "create-bank", name }, (result) => {
        if (!result.issues?.length) {
          this.session.libraryName = "";
          this.session.editingKey = null;
          this.session.tab = "questions";
          this.session.expanded["bank-management"] = false;
        }
      });
    }), this.action("添加内置电力题库", () => { void this.perform({ type: "install-legacy" }); }, "quiet"));
    append(bar, management);
    append(this.contentEl, bar);
  }

  private renderQuestions(parent: HTMLElement): void {
    const bank = this.bank();
    if (!bank) return;
    const layout = element("div", { className: "yiji-manager-columns" });
    const list = element("section", { className: "yiji-manager-panel" });
    const editor = element("section", { className: "yiji-manager-panel yiji-manager-editor" });
    append(layout, list, editor);
    append(parent, layout);
    append(list, this.heading("题目目录"), this.textField("搜索题干、知识点或来源", this.session.search, (value) => { this.session.search = value; }, { placeholder: "输入关键词后点击搜索" }));
    const controls = element("div", { className: "yiji-manager-actions" });
    append(controls, this.action("搜索", () => { this.render(); }), this.action("手工新增", () => {
      const key = `${bank.id}:new`;
      this.session.forms[key] ??= asQuestionForm(key);
      this.session.editingKey = key;
      this.render();
      this.scrollToEditor();
    }, "primary"));
    append(list, controls, this.check("包括已停用的题目", this.session.showInactive, (checked) => { this.session.showInactive = checked; this.render(); }));
    append(list, this.action("检查题目笔记的外部修改", () => {
      void this.perform({ type: "review-external-notes", bankId: bank.id }, () => { this.session.tab = "import"; this.session.editingKey = null; });
    }, "quiet"));
    const query = this.session.search.trim().toLocaleLowerCase();
    const questions = Object.values(bank.questions).filter((question) => {
      const revision = question.revisions[question.activeRevisionId];
      return revision && (this.session.showInactive || !question.inactive)
        && (!query || [revision.stem, revision.domain, ...revision.sources?.map((source) => source.file) ?? []].join(" ").toLocaleLowerCase().includes(query));
    });
    append(list, this.note(`共 ${questions.length} 道；每次显示前 60 道，可通过关键词缩小范围。`));
    for (const question of questions.slice(0, 60)) {
      const revision = question.revisions[question.activeRevisionId];
      if (!revision) continue;
      const row = this.action("", () => {
        const key = `${bank.id}:question:${question.id}`;
        if (!this.session.forms[key]?.dirty) {
          this.session.forms[key] = { ...asQuestionForm(key, revision), questionId: question.id, baseRevisionId: revision.id };
        }
        this.session.editingKey = key;
        this.render();
        this.scrollToEditor();
      }, "row");
      append(row, element("strong", { text: revision.stem }), element("span", { className: "yiji-manager-muted", text: `${TYPE_NAMES[revision.type]} · ${revision.domain || "未归类"} · ${question.inactive ? "已停用" : "可练习"} · ${Object.keys(question.revisions).length} 个版本` }));
      append(list, row);
    }
    if (!questions.length) append(list, this.empty("暂无符合条件的题目", "可以手工新增，或切换到“导入与核对”整理自己的资料。"));
    const form = this.session.editingKey ? this.session.forms[this.session.editingKey] : undefined;
    if (form && form.key.startsWith(`${bank.id}:`) && !form.candidateId) { layout.classList.add("has-editor"); this.renderQuestionEditor(editor, form); }
    else append(editor, this.empty("选择一道题查看和修改", "修改会保留修订记录。已有考试继续按当时保存的题目与答案回顾。"));
  }

  private renderQuestionEditor(parent: HTMLElement, form: QuestionForm, candidate?: ImportCandidate): void {
    const bank = this.bank();
    if (!bank) return;
    append(parent, this.action(candidate ? "返回待核对列表" : "返回题目目录", () => { this.session.editingKey = null; this.render(); }, "quiet"));
    append(parent, this.heading(candidate ? "核对题目" : form.questionId ? "修改题目" : "新增题目"));
    if (form.dirty) append(parent, this.note("有未保存的修改。切换页面会保留本次输入。"));
    const existingQuestionId = form.questionId ?? candidate?.targetQuestionId;
    const currentQuestion = existingQuestionId ? bank.questions[existingQuestionId] : undefined;
    const currentRevision = currentQuestion?.revisions[currentQuestion.activeRevisionId];
    if (currentRevision && form.baseRevisionId && currentRevision.id !== form.baseRevisionId) {
      const changed = element("details", { className: "yiji-manager-risk", attrs: { open: true } });
      append(changed, element("summary", { text: "这道题已有更新，请先比较最新版本" }), element("pre", { text: this.describeConflict(currentRevision) }), this.note("下方保留了你的编辑。比较后，可以继续修订；历史版本仍然保留。"), this.action("已比较，保留草稿并继续修订最新版本", () => {
        form.baseRevisionId = currentRevision.id;
        form.original = currentRevision;
        form.dirty = true;
        this.render();
      }));
      append(parent, changed);
    }
    if (candidate?.targetQuestionId && currentRevision) {
      const before = element("details", { attrs: { open: true } });
      append(before, element("summary", { text: "笔记修改前的已保存版本" }), element("pre", { text: this.describeConflict(currentRevision) }), this.note("下方是从题目笔记中读取的修改。采用后生成修订版，现有作答与试卷继续保留原版本。"));
      if (candidate.input.notePath) append(before, this.action("打开已修改的题目笔记", () => { void this.perform({ type: "open-source", reference: { file: candidate.input.notePath! } }); }, "quiet"));
      append(parent, before);
    }
    if (candidate?.issues.length) {
      const risks = element("div", { className: "yiji-manager-risk" });
      append(risks, element("strong", { text: "以下问题需要逐项核对" }));
      const list = element("ul");
      for (const issue of candidate.issues) append(list, element("li", { text: issue }));
      append(risks, list);
      append(parent, risks);
    }
    const evidence = candidate ? this.snapshot?.candidateEvidence?.[candidate.id] : undefined;
    if (evidence) {
      const original = element("details", { className: "yiji-manager-original", attrs: { open: true } });
      append(original, element("summary", { text: `原文 · ${evidence.sourceLabel}` }), element("pre", { text: evidence.originalText }));
      if (evidence.imageDataUrl) this.appendSourceImage(original, evidence.imageDataUrl);
      if (evidence.reference) append(original, this.action("打开来源原件", () => { void this.perform({ type: "open-source", reference: evidence.reference! }); }, "quiet"));
      append(parent, original);
    } else if (form.original) {
      const original = element("details", { className: "yiji-manager-original" });
      append(original, element("summary", { text: candidate ? "查看导入草稿与来源" : "查看保存前的版本" }), element("pre", { text: `${form.original.stem}\n\n${form.original.options.map((option) => `${option.key}. ${option.text}`).join("\n")}\n\n参考答案：${form.original.answers.join("、") || "缺失"}` }));
      for (const source of form.original.sources ?? []) append(original, this.action(`打开来源：${source.label ?? source.file}`, () => { void this.perform({ type: "open-source", reference: source }); }, "quiet"));
      if (candidate) append(original, this.note("此处是结构化草稿；请打开来源核对原始内容。"));
      append(parent, original);
    }
    const answerBasis = element("p", { className: "yiji-manager-muted", attrs: { "data-answer-origin": "" } });
    const explanationBasis = element("p", { className: "yiji-manager-muted", attrs: { "data-explanation-origin": "" } });
    const updateOrigins = (): void => {
      const answersChanged = parseManagerAnswers(form.answersText).join(",") !== (form.original?.answers.join(",") ?? "");
      const answerOrigin = answersChanged || !form.original ? "user" : form.original.answerOrigin;
      answerBasis.textContent = `答案依据：${answerOrigin === "source" ? "原资料提供" : answerOrigin === "ai-adopted" ? candidate ? "AI 建议，待用户核对采用" : "AI 建议，经用户采用" : answerOrigin === "user" ? "用户修订" : "来源未记录"}`;
      const changed = form.original?.explanation !== form.explanation.trim();
      const origin = changed ? "user" : form.original?.explanationOrigin;
      explanationBasis.textContent = `解析来源：${!form.explanation.trim() ? "暂未提供解析" : origin === "source" ? "原资料解析" : origin === "ai-adopted" ? candidate ? "AI 整理草稿，待核对" : "AI 整理，经用户采用" : origin === "user" ? "用户改写" : "来源未记录"}`;
    };
    updateOrigins();
    const mark = <K extends keyof QuestionForm>(key: K, value: QuestionForm[K]): void => { form[key] = value; form.dirty = true; updateOrigins(); };
    append(parent, this.select("题型", form.type, [["single", "单选"], ["multiple", "多选"], ["judge", "判断"]], (value) => {
      if (value !== "single" && value !== "multiple" && value !== "judge") return;
      mark("type", value);
      if (value === "judge" && !form.original && /^A\.\s*B\.\s*$/.test(form.optionsText.trim())) mark("optionsText", "对. 正确\n错. 错误");
      this.render();
    }));
    append(parent,
      this.textArea("题干", form.stem, (value) => { mark("stem", value); }, 5),
      this.textArea("选项（每行一个，例如 A. 选项内容）", form.optionsText, (value) => { mark("optionsText", value); }, 5),
      this.textField("采用答案（选项编号，多个用逗号分开）", form.answersText, (value) => { mark("answersText", value); }, { placeholder: form.type === "multiple" ? "A, C" : form.type === "judge" ? "对 或 错" : "A" }),
      answerBasis,
      this.textField("知识点／章节", form.domain, (value) => { mark("domain", value); }, { placeholder: "未归类" }),
      this.textField("标签（用逗号或顿号分开）", form.tags, (value) => { mark("tags", value); }),
      this.textArea("解析／记忆提示", form.explanation, (value) => { mark("explanation", value); }, 4),
      explanationBasis,
      this.textField("关联知识笔记", form.notePath, (value) => { mark("notePath", value); }, { placeholder: "仓库内的笔记路径，可留空" }),
      this.textField("适用年份／规则版本", form.ruleVersion, (value) => { mark("ruleVersion", value); }),
    );
    const sources = element("details");
    append(sources, element("summary", { text: "来源信息" }),
      this.textField("来源文件或说明", form.sourceFile, (value) => { mark("sourceFile", value); }),
      this.textField("来源页码（可留空）", form.sourcePage, (value) => { mark("sourcePage", value); }, { type: "number", min: "1" }),
      this.textField("原题号（可留空）", form.sourceOrdinal, (value) => { mark("sourceOrdinal", value); }));
    append(parent, sources, this.textField("修订／采用理由", form.reason, (value) => { mark("reason", value); }, { placeholder: form.questionId ? "说明为什么修改，尤其是答案变化" : "例如：已对照原卷第 3 页核对" }));
    if (candidate?.issues.length) append(parent, this.check("我已对照来源逐项处理上述问题，并确认采用当前答案", form.checkedRisks, (checked) => { form.checkedRisks = checked; this.render(); }));
    if (candidate?.input.answerOrigin === "ai-adopted") append(parent, this.note("这道题含 AI 建议答案。确认入库表示采用该答案，不代表已经查证为官方答案。"));
    if (!candidate && form.stem.trim()) {
      const similar = Object.values(bank.questions).filter((question) => question.id !== form.questionId
        && question.revisions[question.activeRevisionId]?.stem.replace(/\s/g, "") === form.stem.replace(/\s/g, ""));
      if (similar.length) {
        const compare = element("details", { attrs: { open: true } });
        append(compare, element("summary", { text: `已有 ${similar.length} 道相同题干，请比较版本` }));
        for (const question of similar) {
          const revision = question.revisions[question.activeRevisionId];
          if (revision) append(compare, element("pre", { text: `${TYPE_NAMES[revision.type]} · ${revision.ruleVersion || "未标版本"}\n${revision.options.map((option) => `${option.key}. ${option.text}`).join("\n")}\n答案：${revision.answers.join("、")}` }));
        }
        append(compare, this.check("我已比较差异，确认作为独立题目版本保留", form.allowSeparate, (checked) => { form.allowSeparate = checked; }));
        append(parent, compare);
      }
    }
    const actions = element("div", { className: "yiji-manager-actions yiji-manager-sticky" });
    const save = this.action(candidate ? "确认这一题入库" : "保存题目", () => { this.saveForm(form, candidate); }, "primary");
    save.disabled = this.busy || Boolean(candidate?.issues.length && !form.checkedRisks);
    append(actions, save);
    if (form.questionId) {
      const question = bank.questions[form.questionId];
      if (question) append(actions, this.action(question.inactive ? "恢复到练习" : "停用此题", () => {
        void this.perform({ type: "set-inactive", bankId: bank.id, questionId: question.id, inactive: !question.inactive });
      }, "quiet"));
      const revisions = question ? Object.values(question.revisions).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
      const history = element("details");
      append(history, element("summary", { text: `修订历史 · ${revisions.length} 个版本` }));
      for (const revision of revisions) append(history, element("p", { text: `${revision.createdAt} · ${revision.reason || "未填写理由"} · 答案 ${revision.answers.join("、")}` }));
      append(parent, history);
    }
    append(parent, actions);
  }

  private formInput(form: QuestionForm): QuestionInput {
    const options = parseManagerOptions(form.optionsText);
    const answers = parseManagerAnswers(form.answersText);
    if (!form.stem.trim()) throw new Error("请填写题干。");
    if (options.length < 2) throw new Error("至少填写两个选项。");
    if (new Set(options.map((option) => option.key)).size !== options.length) throw new Error("选项编号不能重复。");
    if (!answers.length || answers.some((answer) => !options.some((option) => option.key === answer))) throw new Error("答案必须对应已填写的选项编号。");
    if (form.type !== "multiple" && answers.length !== 1) throw new Error("单选和判断题只能有一个答案。");
    const page = form.sourcePage.trim() ? Number(form.sourcePage) : undefined;
    if (page !== undefined && (!Number.isInteger(page) || page < 1)) throw new Error("页码应为正整数。");
    const previousAnswers = form.original?.answers.join(",") ?? "";
    const answerChanged = answers.join(",") !== previousAnswers;
    if (form.questionId && answerChanged && !form.reason.trim()) throw new Error("修改答案时，请填写修订理由。");
    const sources: SourceReference[] = form.sourceFile.trim()
      ? [{ ...form.original?.sources?.[0], file: form.sourceFile.trim(), page, ordinal: form.sourceOrdinal.trim() || undefined }, ...form.original?.sources?.slice(1) ?? []]
      : [];
    return {
      ...form.original, type: form.type, stem: form.stem.trim(), options, answers,
      domain: form.domain.trim() || "未归类", tags: form.tags.split(/[,，、;；]/).map((tag) => tag.trim()).filter(Boolean),
      explanation: form.explanation.trim(), notePath: form.notePath.trim() || undefined,
      ruleVersion: form.ruleVersion.trim() || undefined, sources,
      answerOrigin: answerChanged || !form.original ? "user" : form.original.answerOrigin,
      explanationOrigin: form.original?.explanation !== form.explanation.trim() ? "user" : form.original?.explanationOrigin,
    };
  }

  private saveForm(form: QuestionForm, candidate?: ImportCandidate): void {
    const bank = this.bank();
    if (!bank) return;
    let input: QuestionInput;
    try { input = this.formInput(form); } catch (error) { this.showProblem(this.errorText(error)); return; }
    if (candidate?.targetQuestionId) {
      const target = bank.questions[candidate.targetQuestionId];
      const old = target?.revisions[target.activeRevisionId];
      if (old && [...old.answers].sort().join(",") !== [...input.answers].sort().join(",") && !form.reason.trim()) {
        this.showProblem("题目笔记修改了答案，请填写修订理由后再采用。"); return;
      }
    }
    const command: LibraryManagerCommand = candidate
      ? { type: "commit-candidate", bankId: bank.id, candidateId: candidate.id, input, resolveConflict: form.checkedRisks, reason: form.reason.trim() || "用户核对导入内容" }
      : { type: "save-question", input, options: { bankId: bank.id, questionId: form.questionId, reason: form.reason.trim() || "手工创建题目", allowSeparate: form.allowSeparate }, expectedRevisionId: form.baseRevisionId };
    void this.perform(command, (result) => {
      if (result.issues?.length) return;
      delete this.session.forms[form.key];
      this.session.editingKey = null;
      if (candidate) this.session.selectedCandidates.delete(candidate.id);
    });
  }

  private renderImport(parent: HTMLElement): void {
    const bank = this.bank();
    if (!bank) return;
    const incoming = element("section", { className: "yiji-manager-panel" });
    append(incoming, this.heading("把自己的资料变成题库"), this.note("先在本地读取资料。题卷与答案文件请选择相同卷名；选择 AI 处理范围后才会发送内容。"));
    const options = element("div", { className: "yiji-manager-fields" });
    append(options, this.textField("这套卷的名称", this.session.paperTitle, (value) => { this.session.paperTitle = value; }, { placeholder: "例如：2025 年模拟试卷一" }), this.select("本次文件角色", this.session.importRole, [["questions", "题卷／题库"], ["answers", "答案文件"], ["reference", "参考资料"]], (value) => { if (value === "questions" || value === "answers" || value === "reference") this.session.importRole = value; }));
    append(incoming, options);
    const range = element("div", { className: "yiji-manager-fields" });
    append(range, this.textField("PDF 开始页", this.session.importPdfFrom, (value) => { this.session.importPdfFrom = value; }, { type: "number", min: "1" }), this.textField("PDF 结束页", this.session.importPdfTo, (value) => { this.session.importPdfTo = value; }, { type: "number", min: "1" }));
    append(incoming, range, this.note("PDF 每批最多读取 50 页；长卷可选择后续页再次导入同一文件，已完成页会累计保留。其他格式不受这些页码字段影响。"));
    const picker = element("input", { attrs: { type: "file", multiple: true, accept: ".pdf,.docx,.txt,.md,.csv,.json,.png,.jpg,.jpeg", "aria-label": "选择需要导入的资料" } });
    picker.disabled = this.busy;
    picker.addEventListener("change", () => {
      const files = Array.from(picker.files ?? []);
      if (!files.length) return;
      void this.readFiles(files, bank.id);
    });
    append(incoming, picker, this.note("支持 PDF、DOCX、图片、Markdown、文本及标准 CSV／JSON。原始文件保留，问题题目不会直接进入计分题库。"));
    const paste = element("details");
    append(paste, element("summary", { text: "粘贴文本或结构化题库" }),
      this.select("内容格式", this.session.importFormat, [["markdown", "文本／Markdown"], ["csv", "标准 CSV"], ["json", "结构化 JSON"]], (value) => { if (value === "markdown" || value === "csv" || value === "json") this.session.importFormat = value; }),
      this.textArea("题库内容", this.session.importText, (value) => { this.session.importText = value; }, 8),
      this.action("本地解析并预览", () => {
        if (!this.session.importText.trim()) { this.showProblem("请先粘贴题目内容。"); return; }
        void this.perform({ type: "stage-text", bankId: bank.id, text: this.session.importText, format: this.session.importFormat });
      }));
    append(incoming, paste);
    append(parent, incoming);
    this.renderAiScope(parent, bank);
    this.renderCandidateQueue(parent, bank);
    this.renderOriginalPaper(parent, bank);
  }

  private async readFiles(files: File[], bankId: string): Promise<void> {
    try {
      const role = this.session.importRole;
      const paperTitle = this.session.paperTitle.trim();
      const from = Number(this.session.importPdfFrom), to = Number(this.session.importPdfTo);
      if (files.some((file) => /\.pdf$/i.test(file.name)) && (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from || to - from >= 50)) throw new Error("请选择有效的 PDF 页码范围，每批最多 50 页。");
      const inputs = await Promise.all(files.map(async (file) => ({ name: file.name, mimeType: file.type, bytes: await file.arrayBuffer(), role, paperTitle,
        ...(/\.pdf$/i.test(file.name) ? { pageFrom: from, pageTo: to } : {}) })));
      await this.perform({ type: "preview-import", bankId, files: inputs });
    } catch (error) { this.showProblem(this.errorText(error)); }
  }

  private renderAiScope(parent: HTMLElement, bank: LibraryBank): void {
    const sources = this.snapshot?.importSources ?? [];
    if (!sources.length) return;
    const panel = element("section", { className: "yiji-manager-panel" });
    append(panel, this.heading("选择 AI 整理范围"), this.note("仅处理选中的页面或段落。原题答案、识别结果和 AI 建议需要在下方核对后采用。"));
    for (const source of sources) {
      const item = this.details(`source:${source.id}`, "yiji-manager-source");
      append(item, element("summary", { text: `${source.name} · ${source.pageCount} 页／段 · ${source.role === "answers" ? "答案" : source.role === "reference" ? "参考" : "题卷"}` }));
      if (source.issues.length) for (const issue of source.issues) append(item, this.note(issue));
      const units = source.units ?? [];
      if (units.length) {
        const ranges = element("div", { className: "yiji-manager-fields" });
        append(ranges, this.textField("从第几页／段", this.session.pageFrom, (value) => { this.session.pageFrom = value; }, { type: "number", min: "1" }), this.textField("到第几页／段", this.session.pageTo, (value) => { this.session.pageTo = value; }, { type: "number", min: "1" }), this.action("选中这个范围", () => {
          const from = Number(this.session.pageFrom), to = Number(this.session.pageTo);
          if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) { this.showProblem("请填写有效的页／段范围。"); return; }
          units.forEach((unit, index) => { const position = unit.page ?? index + 1; if (position >= from && position <= to) this.session.selectedUnits.add(unit.id); });
          this.session.scopeConfirmed = false;
          this.render();
        }));
        append(item, ranges);
        for (const unit of units) {
          append(item, this.check(`${unit.locator}${unit.needsRecognition ? " · 需要图像识别" : ""}`, this.session.selectedUnits.has(unit.id), (checked) => {
            if (checked) this.session.selectedUnits.add(unit.id); else this.session.selectedUnits.delete(unit.id);
            this.session.scopeConfirmed = false;
            this.render();
          }));
          if (this.session.selectedUnits.has(unit.id) && unit.textPreview) append(item, element("pre", { className: "yiji-manager-source-preview", text: unit.textPreview.slice(0, 1500) }));
          if (this.session.selectedUnits.has(unit.id) && unit.imageDataUrl) this.appendSourceImage(item, unit.imageDataUrl);
        }
      } else append(item, this.note("此份资料尚无可选择的页面／段落，需先完成本地读取。"));
      if (source.path) append(item, this.action("打开原始资料", () => { void this.perform({ type: "open-source", reference: { file: source.path } }); }, "quiet"));
      append(panel, item);
    }
    const selected = sources.flatMap((source) => (source.units ?? []).filter((unit) => this.session.selectedUnits.has(unit.id)));
    const mode = this.snapshot?.ai.mode ?? "codex";
    append(panel, this.note(`已选 ${selected.length} 页／段。${mode === "codex" ? "将导出 Codex 整理任务，不在插件内调用付费 API。" : `将发往 ${this.snapshot?.ai.endpoint || "尚未配置的服务"}，模型 ${this.snapshot?.ai.model || "未设置"}；可能产生费用。`}`),
      this.check("同时生成解析与记忆提示草稿", this.session.explanations, (checked) => { this.session.explanations = checked; this.session.scopeConfirmed = false; this.render(); }),
      this.check(mode === "codex" ? "我确认将选中资料包含在导出的 Codex 任务中" : "我确认发送以上范围到所选 AI 服务，并承担该服务的调用费用", this.session.scopeConfirmed, (checked) => { this.session.scopeConfirmed = checked; this.render(); }));
    const process = this.action(mode === "codex" ? "导出 Codex 整理任务" : "开始 AI 整理", () => {
      const ids = selected.map((unit) => unit.id);
      const scope: ManagerAiScope = {
        bankId: bank.id, sourceIds: sources.filter((source) => source.units?.some((unit) => ids.includes(unit.id))).map((source) => source.id),
        unitIds: ids, pageFrom: Number(this.session.pageFrom) || 1, pageTo: Number(this.session.pageTo) || 1,
        includeExplanations: this.session.explanations, confirmed: true,
      };
      void this.perform({ type: mode === "codex" ? "export-codex" : "run-ai", scope }, () => { this.session.scopeConfirmed = false; });
    }, "primary");
    process.disabled = this.busy || !selected.length || !this.session.scopeConfirmed;
    append(panel, process);
    const result = this.details("codex-result");
    append(result, element("summary", { text: "导入 Codex 整理结果" }), this.note("使用导出任务要求的 JSON 结果。结果先进入待核对区，不能直接成为正式题库。"), this.textArea("Codex 返回的 JSON", this.session.codexText, (value) => { this.session.codexText = value; }, 7));
    const resultPicker = element("input", { attrs: { type: "file", accept: ".json,.txt,.md", "aria-label": "读取 Codex 结果文件" } });
    resultPicker.addEventListener("change", () => {
      const file = resultPicker.files?.[0];
      if (!file) return;
      void file.text().then((text) => { this.session.codexText = text; this.render(); }).catch((error: unknown) => { this.showProblem(this.errorText(error)); });
    });
    append(result, resultPicker, this.action("校验结果并加入待核对区", () => {
      if (!this.session.codexText.trim()) { this.showProblem("请先选择或粘贴 Codex 结果。"); return; }
      void this.perform({ type: "import-codex", bankId: bank.id, text: this.session.codexText });
    }));
    append(panel, result);
    if (this.session.resultText) {
      const exported = element("details");
      append(exported, element("summary", { text: "查看最近导出的任务内容" }), this.readOnlyText(this.session.resultText));
      append(panel, exported);
    }
    append(parent, panel);
  }

  private renderCandidateQueue(parent: HTMLElement, bank: LibraryBank): void {
    const candidates = Object.values(bank.candidates);
    const pending = candidates.filter((candidate) => candidate.status === "pending");
    const accepted = candidates.filter((candidate) => candidate.status === "accepted").length;
    const duplicates = candidates.filter((candidate) => candidate.status === "duplicate").length;
    const layout = element("div", { className: "yiji-manager-columns" });
    const queue = element("section", { className: "yiji-manager-panel" });
    const editor = element("section", { className: "yiji-manager-panel yiji-manager-editor" });
    append(layout, queue, editor);
    append(parent, layout);
    append(queue, this.heading("待核对区"), this.note(`已识别候选 ${candidates.length} 项 · 已入库 ${accepted} · 重复来源 ${duplicates} · 待处理 ${pending.length}。原文漏页和未识别题号请另行核对。`));
    const ordinary = pending.filter((candidate) => !candidate.issues.length);
    append(queue, this.check(`选中普通题（${ordinary.length} 道）`, ordinary.length > 0 && ordinary.every((candidate) => this.session.selectedCandidates.has(candidate.id)), (checked) => {
      for (const candidate of ordinary) { if (checked) this.session.selectedCandidates.add(candidate.id); else this.session.selectedCandidates.delete(candidate.id); }
      this.render();
    }));
    const accept = this.action("确认所选普通题入库", () => {
      const ids = ordinary.filter((candidate) => this.session.selectedCandidates.has(candidate.id)).map((candidate) => candidate.id);
      void this.perform({ type: "commit-normal-candidates", bankId: bank.id, candidateIds: ids }, (result) => {
        if (!result.issues?.length) this.session.selectedCandidates.clear();
      });
    }, "primary");
    accept.disabled = this.busy || !ordinary.some((candidate) => this.session.selectedCandidates.has(candidate.id));
    append(queue, accept, this.note("批量采用前请抽查普通题；带问题的题目必须逐题打开、修正并确认。"));
    for (const candidate of pending) {
      const row = element("div", { className: "yiji-manager-candidate" });
      if (!candidate.issues.length) append(row, this.check("选择此题", this.session.selectedCandidates.has(candidate.id), (checked) => {
        if (checked) this.session.selectedCandidates.add(candidate.id); else this.session.selectedCandidates.delete(candidate.id);
        this.render();
      }));
      const open = this.action("", () => {
        const key = `${bank.id}:candidate:${candidate.id}`;
        if (!this.session.forms[key]?.dirty) this.session.forms[key] = { ...asQuestionForm(key, candidate.input), candidateId: candidate.id };
        this.session.editingKey = key;
        this.render();
        this.scrollToEditor();
      }, "row");
      append(open, element("strong", { text: candidate.input.stem || "题干待补全" }), element("span", { className: candidate.issues.length ? "yiji-manager-warning" : "yiji-manager-muted", text: candidate.issues.length ? `${candidate.issues.length} 项待处理 · ${candidate.issues.join("；")}` : `${TYPE_NAMES[candidate.input.type]} · 可抽查后批量采用` }));
      append(row, open); append(queue, row);
    }
    if (!pending.length) append(queue, this.empty("当前没有待核对题目", "导入自己的资料，或粘贴标准格式的题库开始整理。"));
    const form = this.session.editingKey ? this.session.forms[this.session.editingKey] : undefined;
    const candidate = form?.candidateId ? bank.candidates[form.candidateId] : undefined;
    if (form && candidate?.status === "pending") { layout.classList.add("has-editor"); this.renderQuestionEditor(editor, form, candidate); }
    else append(editor, this.empty("选一道题开始核对", "原文、答案、选项和知识点都可以在保存前检查；未解决的问题会留在待处理区。"));
  }

  private composeOptions(): ComposeOptions {
    const bank = this.bank();
    if (!bank) throw new Error("请先选择题库。");
    const counts: ComposeOptions["counts"] = {};
    const points: NonNullable<ComposeOptions["points"]> = {};
    let total = 0;
    for (const type of ["single", "multiple", "judge"] as const) {
      const count = Number(this.session.composeCounts[type]);
      const score = Number(this.session.composePoints[type]);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${TYPE_NAMES[type]}题量必须是零或正整数。`);
      if (!Number.isFinite(score) || score <= 0) throw new Error(`${TYPE_NAMES[type]}每题分值必须大于零。`);
      counts[type] = count; points[type] = score; total += count;
    }
    if (!total) throw new Error("至少选择一道题。");
    const durationMinutes = Number(this.session.composeMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new Error("请填写大于零的考试时长。");
    if (!this.session.composeTitle.trim()) throw new Error("请填写试卷名称。");
    return {
      bankId: bank.id, title: this.session.composeTitle.trim(), durationMinutes,
      counts, points, domains: this.session.composeDomains.split(/[,，、\n]/).map((value) => value.trim()).filter(Boolean),
      sources: this.session.composeSources.split(/[,，、\n]/).map((value) => value.trim()).filter(Boolean),
      filter: this.session.composeFilter, scoreMode: this.session.scoreMode,
    };
  }

  private renderOriginalPaper(parent: HTMLElement, bank: LibraryBank): void {
    const candidates = Object.values(bank.candidates);
    if (!candidates.length) return;
    const batches = [...new Set(candidates.map((candidate) => candidate.batchId))];
    const panel = element("section", { className: "yiji-manager-panel" });
    append(parent, panel);
    append(panel, this.heading("将完整题卷保存为原卷"), this.note("只有整批题目均已核对入库，并且你对照原件确认没有漏页、漏题，才能创建完整原卷。部分已确认题可以先用于普通练习。"));
    const selectOptions: [string, string][] = [["", "选择一份完整题卷"]];
    for (const batchId of batches) {
      const items = candidates.filter((candidate) => candidate.batchId === batchId);
      const first = items[0];
      const name = this.snapshot?.importSources?.find((source) => source.batchId === batchId)?.name
        ?? first?.input.sources?.[0]?.file.split("/").pop() ?? "导入题卷";
      selectOptions.push([batchId, `${name} · ${items.length} 题 · 待处理 ${items.filter((item) => item.status === "pending").length}`]);
    }
    append(panel, this.select("题卷来源", this.session.originalBatchId, selectOptions, (value) => {
      this.session.originalBatchId = value;
      this.session.originalComplete = false;
      this.render();
    }));
    const items = candidates.filter((candidate) => candidate.batchId === this.session.originalBatchId);
    if (!items.length) return;
    append(panel, this.textField("原卷名称", this.session.originalTitle, (value) => { this.session.originalTitle = value; }),
      this.textField("对照原件确认的总题数", this.session.originalQuestionCount, (value) => { this.session.originalQuestionCount = value; this.session.originalComplete = false; }, { type: "number", min: "1" }),
      this.textField("卷头标注总分（未标注可留空）", this.session.originalScore, (value) => { this.session.originalScore = value; }, { type: "number", min: "0" }),
      this.textField("本次练习时长（分钟）", this.session.originalMinutes, (value) => { this.session.originalMinutes = value; }, { type: "number", min: "1" }));
    append(panel, this.note("原资料给出逐题分值时保留原分值；以下分值只补充原资料未明确的部分，并在试卷中说明为练习设置。"));
    const scores = element("div", { className: "yiji-manager-fields" });
    for (const type of ["single", "multiple", "judge"] as const) append(scores, this.textField(`${TYPE_NAMES[type]}每题分值`, this.session.originalPoints[type], (value) => { this.session.originalPoints[type] = value; }, { type: "number", min: "0.01", step: "0.5" }));
    append(panel, scores, this.select("多选计分规则", this.session.originalScoreMode, [["exact", "全部选对才得分"], ["proportional", "没有错选时按命中正确项比例给分"]], (value) => { if (value === "exact" || value === "proportional") this.session.originalScoreMode = value; }), this.textArea("时长与计分规则的依据／练习设置说明", this.session.originalRule, (value) => { this.session.originalRule = value; }, 3));
    const unresolved = items.filter((item) => item.status === "pending").length;
    if (unresolved) append(panel, element("p", { className: "yiji-manager-risk", text: `这批资料还有 ${unresolved} 道待处理题，请先完成核对。不能以已通过的子集冒充完整原卷。` }));
    append(panel, this.check("我已对照整份原件确认题号、图表及答案完整，以上规则可用于本次练习", this.session.originalComplete, (checked) => { this.session.originalComplete = checked; this.render(); }));
    const save = this.action("保存完整原卷", () => {
      if (!this.session.originalComplete) { this.showProblem("资料范围或题量已变化，请重新确认原卷完整性。"); return; }
      const count = Number(this.session.originalQuestionCount), minutes = Number(this.session.originalMinutes);
      const declared = this.session.originalScore.trim() ? Number(this.session.originalScore) : undefined;
      const points = { single: Number(this.session.originalPoints.single), multiple: Number(this.session.originalPoints.multiple), judge: Number(this.session.originalPoints.judge) };
      if (!this.session.originalTitle.trim()) { this.showProblem("请填写原卷名称。"); return; }
      if (!Number.isSafeInteger(count) || count < 1 || count !== items.length) { this.showProblem(`原件总题数必须与已核对批次的 ${items.length} 道对应；若不一致，请先补齐或处理重复题号。`); return; }
      if (!Number.isFinite(minutes) || minutes <= 0 || Object.values(points).some((point) => !Number.isFinite(point) || point <= 0) || (declared !== undefined && (!Number.isFinite(declared) || declared < 0))) { this.showProblem("请填写有效的时长和分值。"); return; }
      if (!this.session.originalRule.trim()) { this.showProblem("请说明计分与时长的来源，或标明这是你设置的练习规则。"); return; }
      void this.perform({ type: "freeze-original", options: {
        bankId: bank.id, batchId: this.session.originalBatchId, title: this.session.originalTitle.trim(),
        sourceFile: items[0]?.input.sources?.[0]?.file ?? "", durationMinutes: minutes,
        scoreMode: this.session.originalScoreMode, declaredTotalScore: declared, declaredQuestionCount: count,
        points, ruleNote: this.session.originalRule.trim(), completenessConfirmed: true,
      } }, (result) => { if (!result.issues?.length) this.session.originalComplete = false; });
    }, "primary");
    save.disabled = this.busy || unresolved > 0 || !this.session.originalComplete;
    append(panel, save);
  }

  private renderCompose(parent: HTMLElement): void {
    const bank = this.bank();
    if (!bank) return;
    const layout = element("div", { className: "yiji-manager-columns" });
    const form = element("section", { className: "yiji-manager-panel" });
    const preview = element("section", { className: "yiji-manager-panel" });
    append(parent, layout); append(layout, form, preview);
    append(form, this.heading("组合自己的试卷"), this.note("只从当前题库的可用题中选择。题目不足时显示缺口；保存后冻结题目、顺序、答案和计分规则。"));
    this.renderCompositionEvidence(form, bank);
    const natural = this.details("compose-natural");
    append(natural, element("summary", { text: "用一句话描述组卷要求" }), this.textArea("组卷要求或 Codex 返回的条件 JSON", this.session.composePrompt, (value) => { this.session.composePrompt = value; }, 3), this.note(this.snapshot?.ai.mode === "codex" ? "输入要求后导出 Codex 组卷任务；把返回的条件 JSON 粘贴回此处再解析。条件会填到下方表单，核对后再预览。" : "例如：第一章单选 10 题、多选 5 题，只用错题。你填写的要求和必要的题库摘要会用于所选服务的 AI 分析，可能产生费用；结果先填入表单，核对后再预览。"), this.action("梳理组卷条件", () => {
      if (!this.session.composePrompt.trim()) { this.showProblem("请先填写组卷要求。"); return; }
      void this.perform({ type: "parse-compose", bankId: bank.id, prompt: this.session.composePrompt }, (result) => {
        this.session.composeTaskText = result.text ?? "";
        const options = result.composeOptions;
        if (!options) return;
        this.session.composeTitle = options.title;
        this.session.composeMinutes = String(options.durationMinutes);
        this.session.composeFilter = options.filter ?? "all";
        this.session.scoreMode = options.scoreMode ?? "exact";
        this.session.composeDomains = options.domains?.join("、") ?? "";
        this.session.composeSources = options.sources?.join("、") ?? "";
        for (const type of ["single", "multiple", "judge"] as const) {
          this.session.composeCounts[type] = String(options.counts[type] ?? 0);
          this.session.composePoints[type] = String(options.points?.[type] ?? 1);
        }
        this.session.composePreview = undefined;
      });
    }));
    append(form, natural, this.textField("试卷名称", this.session.composeTitle, (value) => { this.session.composeTitle = value; this.session.composePreview = undefined; }));
    if (this.session.composeTaskText) {
      const task = element("details", { attrs: { open: true } });
      append(task, element("summary", { text: "导出的 Codex 组卷任务" }), this.readOnlyText(this.session.composeTaskText), this.note("处理后，将条件 JSON 粘贴到上方输入框，点击“梳理组卷条件”填入表单。"));
      append(form, task);
    }
    for (const type of ["single", "multiple", "judge"] as const) {
      const row = element("div", { className: "yiji-manager-fields" });
      append(row, this.textField(`${TYPE_NAMES[type]}题数`, this.session.composeCounts[type], (value) => { this.session.composeCounts[type] = value; this.session.composePreview = undefined; }, { type: "number", min: "0", step: "1" }), this.textField("每题分值", this.session.composePoints[type], (value) => { this.session.composePoints[type] = value; this.session.composePreview = undefined; }, { type: "number", min: "0.01", step: "0.5" }));
      append(form, row);
    }
    append(form,
      this.textField("整卷时长（分钟）", this.session.composeMinutes, (value) => { this.session.composeMinutes = value; this.session.composePreview = undefined; }, { type: "number", min: "1" }),
      this.textField("知识点／章节（留空表示全部）", this.session.composeDomains, (value) => { this.session.composeDomains = value; this.session.composePreview = undefined; }, { placeholder: "多个用顿号分开" }),
      this.textField("来源筛选（留空表示全部）", this.session.composeSources, (value) => { this.session.composeSources = value; this.session.composePreview = undefined; }),
      this.select("选题范围", this.session.composeFilter, [["all", "全部可用题"], ["wrong", "当前错题"], ["unanswered", "尚未作答"], ["bookmarked", "收藏题"]], (value) => {
        if (value === "all" || value === "wrong" || value === "unanswered" || value === "bookmarked") this.session.composeFilter = value;
        this.session.composePreview = undefined;
      }),
      this.select("多选计分规则", this.session.scoreMode, [["exact", "全对得分，少选和错选均为零分"], ["proportional", "无错选时按正确选项命中比例给分"]], (value) => { if (value === "exact" || value === "proportional") this.session.scoreMode = value; this.session.composePreview = undefined; }),
      this.action("检查条件并预览试卷", () => {
        let options: ComposeOptions;
        try { options = this.composeOptions(); } catch (error) { this.showProblem(this.errorText(error)); return; }
        void this.perform({ type: "compose-paper", options, freeze: false }, (result) => {
          this.session.composePreview = result.paper;
          this.session.composeSignature = JSON.stringify(options);
        });
      }, "primary"));
    const paper = this.session.composePreview;
    append(preview, this.heading(paper ? "预览与保存" : "试卷预览"));
    if (paper && paper.bankId === bank.id) {
      append(preview, element("h3", { text: paper.title }), this.note(`${paper.items.length} 题 · ${paper.totalScore} 分 · ${paper.durationMinutes} 分钟`));
      const counts = { single: 0, multiple: 0, judge: 0 };
      for (const item of paper.items) counts[item.snapshot.type] += 1;
      append(preview, this.note(`单选 ${counts.single} · 多选 ${counts.multiple} · 判断 ${counts.judge}`));
      this.renderPaperSources(preview, paper);
      const list = element("ol", { className: "yiji-manager-paper-list" });
      for (const item of paper.items) append(list, element("li", { text: `${item.snapshot.domain || "未归类"} · ${TYPE_NAMES[item.snapshot.type]} · ${item.points} 分` }));
      append(preview, list, this.note("预览只显示构成，不提前显示参考答案。保存后可在“模考”中开始。"), this.action("保存这份试卷", () => {
        let options: ComposeOptions;
        try { options = this.composeOptions(); } catch (error) { this.showProblem(this.errorText(error)); return; }
        if (JSON.stringify(options) !== this.session.composeSignature) { this.showProblem("条件已修改，请先重新预览。"); return; }
        void this.perform({ type: "compose-paper", options, freeze: true, preview: paper }, (result) => {
          if (!result.issues?.length) this.session.composePreview = undefined;
        });
      }, "primary"));
    } else append(preview, this.empty("填写条件后检查题量", "系统会明确报告可用题量和缺口，不自动放宽条件或生成新题凑数。"));
    const saved = Object.values(bank.papers);
    if (saved.length) {
      append(preview, this.heading(`已保存试卷 · ${saved.length}`));
      for (const savedPaper of saved.slice(-15).reverse()) append(preview, element("p", { text: `${savedPaper.title} · ${savedPaper.items.length} 题 · ${savedPaper.totalScore} 分` }));
    }
  }

  private renderCompositionEvidence(parent: HTMLElement, bank: LibraryBank): void {
    if (!this.snapshot) return;
    const study = getBankStudyData(this.snapshot.library, bank.id);
    const evidence = getLearningEvidence(this.snapshot.library, bank.id);
    const section = element("section", { attrs: { "data-compose-evidence": "" } });
    append(section, this.heading("判断薄弱的依据"), this.note("当前错题占比 = 当前错题数 ÷ 已答不同题数。重复作答不增加题目样本；这个比例不表示掌握率，也不预测成绩。"),
      this.note("不足 10 道已答题时样本不足，不自动排序选择薄弱章节，请自行确认知识点范围。"));
    const groups = new Map<string, string[]>();
    for (const question of Object.values(bank.questions)) {
      if (question.inactive) continue;
      const domain = question.revisions[question.activeRevisionId]!.domain;
      const ids = groups.get(domain) ?? [];
      ids.push(question.id);
      groups.set(domain, ids);
    }
    const rows = this.details("compose-evidence");
    append(rows, element("summary", { text: `查看各知识点的作答样本 · ${groups.size} 类` }));
    const describe = (value: { sampleCount: number; correctCount: number } | undefined): string =>
      value?.sampleCount ? `${value.correctCount}/${value.sampleCount} 次正确` : "尚无可确认样本";
    for (const [domain, ids] of groups) {
      const answered = ids.filter((id) => (study.questions[id]?.attempts ?? 0) > 0).length;
      const wrong = ids.filter((id) => study.questions[id]?.isWrong).length;
      const observed = evidence.domains.find((item) => item.domain === domain);
      const row = element("div", { attrs: { "data-compose-domain": domain } });
      append(row, element("h4", { text: domain || "未归类" }), this.note(`未停用 ${ids.length} 题 · 已答 ${answered} 题 · 当前错题 ${wrong} 题 · 错题占比 ${answered ? `${Math.round(100 * wrong / answered)}%` : "暂无样本"}`),
        this.note(`首次作答：${describe(observed?.firstAnswers)}；延迟复测：${describe(observed?.delayedAnswers)}。`));
      if (answered < 10) append(row, this.note(`样本不足：仅有 ${answered} 道已作答题，请自行确认本次章节范围。`));
      append(rows, row);
    }
    if (groups.size) append(section, rows);
    if (!groups.size) append(section, this.note("尚无可比较的题目，请先建立题库。"));
    if (evidence.legacyExcludedFromFirstAndDelayed) append(section, this.note("旧版累计记录参与当前错题统计；无法还原的首次作答和延迟复测不补造为样本。"));
    append(parent, section);
  }

  private renderPaperSources(parent: HTMLElement, paper: FrozenPaper): void {
    const groups = new Map<string, { label: string; count: number }>();
    for (const item of paper.items) {
      const seen = new Set<string>();
      for (const source of item.snapshot.sources ?? []) {
        if (!source.file || seen.has(source.file)) continue;
        seen.add(source.file);
        const existing = groups.get(source.file);
        const fileName = source.file.split(/[\\/]/).pop() || source.file;
        groups.set(source.file, { label: existing?.label ?? (source.label ? `${source.label} · ${fileName}` : fileName), count: (existing?.count ?? 0) + 1 });
      }
      if (!seen.size) {
        const missing = groups.get("");
        groups.set("", { label: "未标明来源", count: (missing?.count ?? 0) + 1 });
      }
    }
    const section = element("section", { attrs: { "data-compose-sources": "" } });
    append(section, this.heading("来源构成"), this.note("按本次试卷的冻结题目统计。同一题在同一来源只计一次；有多个来源时会分别计入，因此来源题数之和可能大于整卷题量。"));
    for (const source of groups.values()) append(section, element("p", { text: `${source.label} · ${source.count} 题` }));
    append(parent, section);
  }

  private renderReview(parent: HTMLElement): void {
    const bank = this.bank();
    if (!bank) return;
    const panel = element("section", { className: "yiji-manager-panel" });
    append(parent, panel);
    append(panel, this.heading("隔一段时间再检查"), this.note("错题本记录最近仍答错的题；巩固复习安排以后再次检查。一次答对离开错题本，不会抹掉复习安排。"), this.check(`为“${bank.name}”开启巩固复习`, bank.reviewEnabled, (enabled) => { void this.perform({ type: "set-review", bankId: bank.id, enabled }); }));
    append(panel, this.note("开启后，新作答进入巩固安排。旧题由你主动选择加入；关闭时保留历史，不产生新的复习安排。"));
    const studied = new Set(Object.entries(bank.baseline.questions).filter(([, progress]) => progress.attempts > 0).map(([id]) => id));
    for (const event of Object.values(this.snapshot?.library.events ?? {})) if (event.bankId === bank.id && event.kind === "answer") studied.add(event.questionId);
    const eligible = [...studied].filter((id) => bank.questions[id] && !bank.questions[id]?.inactive);
    append(panel, this.heading(`将已有学习记录加入巩固 · ${eligible.length} 道`));
    if (!eligible.length) { append(panel, this.note("当前还没有已作答的题。先完成一次练习，再回来选择。")); return; }
    append(panel, this.check("选择全部已作答且可用的题目", eligible.every((id) => this.session.reviewIds.has(id)), (checked) => {
      for (const id of eligible) { if (checked) this.session.reviewIds.add(id); else this.session.reviewIds.delete(id); }
      this.session.resetReviewConfirmed = false;
      this.render();
    }));
    const list = this.details("review-questions");
    append(list, element("summary", { text: "逐题选择（最多显示前 100 道）" }));
    for (const id of eligible.slice(0, 100)) {
      const question = bank.questions[id];
      const revision = question?.revisions[question.activeRevisionId];
      if (!revision) continue;
      append(list, this.check(revision.stem, this.session.reviewIds.has(id), (checked) => {
        if (checked) this.session.reviewIds.add(id); else this.session.reviewIds.delete(id);
        this.session.resetReviewConfirmed = false;
        this.render();
      }));
    }
    append(panel, list);
    if (eligible.length > 100) append(panel, this.note("列表显示前 100 道；“选择全部”包含所有已作答题。"));
    const ids = eligible.filter((id) => this.session.reviewIds.has(id));
    const enroll = this.action(`将所选 ${ids.length} 道加入巩固`, () => { void this.perform({ type: "enroll-review", bankId: bank.id, questionIds: ids }, (result) => { if (!result.issues?.length) this.session.reviewIds.clear(); }); }, "primary");
    enroll.disabled = this.busy || !bank.reviewEnabled || !ids.length;
    append(panel, enroll);
    if (!bank.reviewEnabled) append(panel, this.note("先开启巩固复习，再加入历史题目。"));
    const reset = this.details("reset-review");
    append(reset, element("summary", { text: "重新安排所选题目的复习" }), this.note(`所选 ${ids.length} 道题将改为 24 小时后再次检查。原作答、错题记录及累计次数保留；此操作不会增加一次作答。`), this.check("我确认把所选题目的巩固安排重设为 24 小时后", this.session.resetReviewConfirmed, (checked) => { this.session.resetReviewConfirmed = checked; this.render(); }));
    const restart = this.action("确认重设所选题目", () => {
      const selected = eligible.filter((id) => this.session.reviewIds.has(id));
      if (!this.session.resetReviewConfirmed || !selected.length || !bank.reviewEnabled) { this.showProblem("先开启巩固、选择题目并确认重设范围。"); return; }
      void this.perform({ type: "reset-review", bankId: bank.id, questionIds: selected }, (result) => { if (!result.issues?.length) this.session.resetReviewConfirmed = false; });
    });
    restart.disabled = this.busy || !bank.reviewEnabled || !ids.length || !this.session.resetReviewConfirmed;
    append(reset, restart); append(panel, reset);
  }

  private renderSettings(parent: HTMLElement): void {
    const layout = element("div", { className: "yiji-manager-columns" });
    const ai = element("section", { className: "yiji-manager-panel" });
    const backup = element("section", { className: "yiji-manager-panel" });
    append(parent, layout); append(layout, ai, backup);
    append(ai, this.heading("AI 整理方式"));
    const draft = this.aiDraft ?? { mode: "codex", endpoint: "", model: "", supportsImages: false };
    this.aiDraft = draft;
    append(ai, this.select("处理方式", draft.mode, [["codex", "导出 Codex 任务后导入结果"], ["api", "连接自己的 AI 服务"]], (value) => {
      if (value === "codex" || value === "api") draft.mode = value;
      this.render();
    }));
    if (draft.mode === "api") {
      append(ai, this.textField("服务地址", draft.endpoint, (value) => { draft.endpoint = value; }, { type: "url", placeholder: "服务商提供的兼容接口地址" }), this.textField("模型名称", draft.model, (value) => { draft.model = value; }), this.textField("API 密钥", this.apiKey, (value) => { this.apiKey = value; }, { type: "password", autocomplete: "off", placeholder: this.snapshot?.ai.keyConfigured ? "已配置；留空保留当前密钥" : "仅用于你选择的 AI 服务" }), this.note("选择服务并不发送题库。每次调用前需在导入页确认范围；扫描件还要求模型支持图像。"));
      append(ai, this.check("我选择的模型支持图像输入", draft.supportsImages, (checked) => { draft.supportsImages = checked; }));
    } else append(ai, this.note("在导入页选择资料范围，导出任务及所需附件。把 Codex 返回的 JSON 导回本题库，再核对采用。插件不会自动创建聊天或额外调用 API。"));
    append(ai, this.action("保存 AI 设置", () => {
      if (draft.mode === "api" && (!draft.endpoint.trim() || !draft.model.trim())) { this.showProblem("使用 AI 服务时，请填写服务地址和模型名称。"); return; }
      void this.perform({ type: "configure-ai", settings: { ...draft, endpoint: draft.endpoint.trim(), model: draft.model.trim() }, apiKey: this.apiKey || undefined }, (result) => { if (!result.issues?.length) this.apiKey = ""; });
    }, "primary"));
    append(ai, this.note("密钥不进入题目、导出内容或普通日志。不能安全持久保存的宿主应只在当前会话使用密钥。"));
    append(backup, this.heading("导出与恢复"), this.note("完整备份保留学习记录、修订历史、试卷、必要题图、原始资料和未完成整理任务。只有内容导出可选择是否包含原资料；内容导出不保留全部学习状态。"));
    const sourceChoice = this.check(this.session.backupHistory ? "包含原始来源资料（完整备份必需）" : "包含原始来源资料",
      this.session.backupHistory || this.session.backupSources, (checked) => { if (!this.session.backupHistory) this.session.backupSources = checked; });
    const sourceInput = sourceChoice.querySelector<HTMLInputElement>("input");
    if (sourceInput) sourceInput.disabled = this.busy || this.session.backupHistory;
    append(backup, this.check("包含学习记录（完整备份）", this.session.backupHistory, (checked) => { this.session.backupHistory = checked; this.render(); }), sourceChoice);
    append(backup, this.action(this.session.backupHistory ? "保存完整备份" : "导出题库内容", () => { void this.perform({ type: "export-backup", includeSources: this.session.backupHistory || this.session.backupSources, includeHistory: this.session.backupHistory }); }, "primary"));
    const restore = this.details("restore");
    append(restore, element("summary", { text: "从备份恢复" }), this.note("先读取并检查备份。确认恢复前会展示范围，当前题库应先保存备份。"));
    const picker = element("input", { attrs: { type: "file", accept: ".json", "aria-label": "选择易记备份文件" } });
    picker.disabled = this.busy;
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      if (!file) return;
      void file.text().then((text) => { this.session.restoreText = text; this.session.restoreFileName = file.name; this.session.restoreSummary = ""; this.session.restoreChecked = false; this.render(); }).catch((error: unknown) => { this.showProblem(this.errorText(error)); });
    });
    append(restore, picker);
    if (this.session.restoreFileName) append(restore, this.note(`已读取文件：${this.session.restoreFileName}（${this.session.restoreText.length.toLocaleString()} 字符）。点击“检查备份”核对恢复范围；下方粘贴内容会替换这份文件。`));
    // Keep file payloads out of textarea layout: source images can make a backup
    // several MB, which otherwise stalls Android WebView during each render.
    append(restore, this.textArea("备份内容", this.session.restoreFileName ? "" : this.session.restoreText, (value) => { this.session.restoreText = value; this.session.restoreFileName = ""; this.session.restoreSummary = ""; this.session.restoreChecked = false; }, 5), this.action("检查备份", () => {
      if (!this.session.restoreText.trim()) { this.showProblem("请先选择或粘贴备份内容。"); return; }
      void this.perform({ type: "restore-backup", text: this.session.restoreText, confirmed: false }, (result) => { this.session.restoreSummary = result.restoreSummary ?? ""; this.session.restoreChecked = false; });
    }));
    if (this.session.restoreSummary) {
      append(restore, element("p", { className: "yiji-manager-risk", text: this.session.restoreSummary }), this.check("我已查看恢复范围，并已为当前题库保留备份", this.session.restoreChecked, (checked) => { this.session.restoreChecked = checked; this.render(); }));
      const confirm = this.action("确认恢复这份备份", () => {
        if (!this.session.restoreChecked || !this.session.restoreSummary) { this.showProblem("备份内容已变化，请重新检查并确认恢复范围。"); return; }
        void this.perform({ type: "restore-backup", text: this.session.restoreText, confirmed: true }, (result) => {
          if (result.issues?.length) return;
          this.session.restoreSummary = ""; this.session.restoreChecked = false;
          this.session.editingKey = null; this.session.composePreview = undefined;
        });
      });
      confirm.disabled = this.busy || !this.session.restoreChecked;
      append(restore, confirm);
    }
    append(backup, restore);
    if (this.session.resultText) {
      const output = element("details");
      append(output, element("summary", { text: "查看最近导出的内容" }));
      const large = this.session.resultText.length > 100_000;
      if (large) append(output, this.note("内容较大，仅显示前 2,000 字符。完整内容已保存在上方提示的导出文件中，请使用该文件恢复或分享。"));
      append(output, this.readOnlyText(large ? this.session.resultText.slice(0, 2000) : this.session.resultText));
      append(backup, output);
    }
    const conflicts = this.snapshot?.library.conflicts.filter((conflict) => !conflict.resolved) ?? [];
    this.renderBankSettings(parent);
    if (conflicts.length) {
      const conflictPanel = element("section", { className: "yiji-manager-panel" });
      append(parent, conflictPanel);
      append(conflictPanel, this.heading(`需要选择的冲突版本 · ${conflicts.length}`), this.note("检测到同一内容的不同版本。请先对照内容，再决定采用哪一份；已有作答记录应分别保留。"));
      for (const conflict of conflicts) {
        const detail = element("details");
        const names: Record<string, string> = { revision: "题目修订", "question-head": "当前题目版本", event: "作答记录", baseline: "原有学习记录", paper: "试卷", exam: "考试记录", "exam-write": "考试断点", attachment: "题图附件", candidate: "导入草稿", bank: "题库信息" };
        const conflictBank = this.snapshot?.library.banks[conflict.bankId];
        const revisions = conflictBank?.questions[conflict.entityId]?.revisions;
        const local = typeof conflict.local === "string" && revisions?.[conflict.local] ? revisions[conflict.local] : conflict.local;
        const remote = typeof conflict.remote === "string" && revisions?.[conflict.remote] ? revisions[conflict.remote] : conflict.remote;
        append(detail, element("summary", { text: `${conflictBank?.name ?? "题库"} · ${names[conflict.kind] ?? "保存内容"}` }), element("h4", { text: "当前版本" }), this.readOnlyText(this.describeConflict(local)), element("h4", { text: "另一设备版本" }), this.readOnlyText(this.describeConflict(remote)));
        const buttons = element("div", { className: "yiji-manager-actions" });
        append(buttons, this.action("采用当前版本", () => { void this.perform({ type: "resolve-conflict", conflictId: conflict.id, choice: "local" }); }), this.action("采用另一设备版本", () => { void this.perform({ type: "resolve-conflict", conflictId: conflict.id, choice: "remote" }); }));
        append(detail, buttons); append(conflictPanel, detail);
      }
    }
  }

  private appendSourceImage(parent: HTMLElement, dataUrl: string): void {
    if (!/^data:image\/(png|jpeg|webp|gif);base64,/i.test(dataUrl)) return;
    append(parent, this.note("核对用原页，可能包含答案；不会自动用作答题页中的题图。"), element("img", { className: "yiji-manager-source-image", attrs: { src: dataUrl, alt: "用于核对题目与答案的来源原页", loading: "lazy" } }));
  }

  private renderBankSettings(parent: HTMLElement): void {
    const bank = this.bank();
    if (!bank) return;
    const panel = element("section", { className: "yiji-manager-panel" });
    append(parent, panel);
    append(panel, this.heading(`管理“${bank.name}”`), this.textField("题库名称", this.session.renameNames[bank.id] ?? bank.name, (value) => { this.session.renameNames[bank.id] = value; }), this.action("保存题库名称", () => {
      const name = (this.session.renameNames[bank.id] ?? bank.name).trim();
      if (!name) { this.showProblem("题库名称不能为空。"); return; }
      void this.perform({ type: "rename-bank", bankId: bank.id, name }, (result) => {
        if (!result.issues?.length) { this.session.deleteName = ""; this.session.deleteAcknowledged = false; }
      });
    }));
    const domainCounts = new Map<string, number>();
    for (const question of Object.values(bank.questions)) {
      const domain = question.revisions[question.activeRevisionId]?.domain;
      if (domain) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    }
    const domains = [...domainCounts.entries()].sort(([left], [right]) => left.localeCompare(right));
    const classification = this.details("manage-domains");
    append(classification, element("summary", { text: `知识点分类 · ${domains.length} 类` }), this.note("题目中的知识点名称会自动形成分类。这里可批量改名；改成已有名称会合并分类，题目及学习记录保留。题量包含已停用题目。"));
    for (const [domain, count] of domains) append(classification, element("p", { text: `${domain} · ${count} 道题` }));
    if (domains.length) {
      append(classification, this.select("要改名的知识点", this.session.domainFrom, [["", "请选择知识点"], ...domains.map(([domain, count]): [string, string] => [domain, `${domain}（${count} 题）`])], (value) => { this.session.domainFrom = value; this.session.domainConfirmed = false; this.render(); }), this.textField("新的知识点名称", this.session.domainTo, (value) => { this.session.domainTo = value; this.session.domainConfirmed = false; }), this.check(`确认修改该分类下的 ${domainCounts.get(this.session.domainFrom) ?? 0} 道题的知识点名称`, this.session.domainConfirmed, (checked) => { this.session.domainConfirmed = checked; this.render(); }));
      const rename = this.action("确认更新知识点名称", () => {
        const from = this.session.domainFrom, to = this.session.domainTo.trim();
        if (!domainCounts.has(from) || !to || from === to || !this.session.domainConfirmed) { this.showProblem("请选择原知识点、填写不同的新名称，并确认受影响题量。"); return; }
        void this.perform({ type: "rename-domain", bankId: bank.id, from, to }, (result) => {
          if (!result.issues?.length) { this.session.domainFrom = ""; this.session.domainTo = ""; this.session.domainConfirmed = false; }
        });
      });
      rename.disabled = this.busy || !this.session.domainConfirmed || !domainCounts.has(this.session.domainFrom) || !this.session.domainTo.trim();
      append(classification, rename);
    } else append(classification, this.note("新增题目并填写知识点后，分类会出现在这里。"));
    append(panel, classification);
    append(panel, this.note("在 Obsidian 中修改题目笔记后，先核对差异再采用；格式有问题时正式题库保留最后可用版本。"), this.action("检查题目笔记的外部修改", () => {
      void this.perform({ type: "review-external-notes", bankId: bank.id }, () => { this.session.tab = "import"; this.session.editingKey = null; });
    }, "quiet"));
    const remove = this.details(`delete-bank:${bank.id}`);
    const answerEvents = Object.values(this.snapshot?.library.events ?? {}).filter((event) => event.bankId === bank.id && event.kind === "answer").length;
    const baselineAnswers = Object.values(bank.baseline.questions).reduce((total, progress) => total + progress.attempts, 0);
    append(remove, element("summary", { text: "删除此题库" }), element("p", { className: "yiji-manager-risk", text: `将删除“${bank.name}”：${Object.keys(bank.questions).length} 道题、${Object.keys(bank.papers).length} 份试卷、新版作答 ${answerEvents} 次、原有累计作答 ${baselineAnswers} 次。当前已索引来源资料 ${this.snapshot?.importSources?.length ?? 0} 份。` }),
      this.note("删除后，此题库和学习记录退出正常使用列表。插件会先保存可恢复的完整备份，再写入同步删除标记，防止旧设备副本自动恢复题库。原始资料、已有备份及其他设备尚未同步的副本不会自动清除。"),
      this.action("先保存全部题库的完整备份", () => { void this.perform({ type: "export-backup", includeSources: true, includeHistory: true }); }),
      this.textField("输入题库名称以确认删除", this.session.deleteName, (value) => {
        this.session.deleteName = value;
        const action = this.contentEl.querySelector<HTMLButtonElement>("[data-delete-bank]");
        if (action) action.disabled = this.busy || !this.session.deleteAcknowledged || value !== bank.name;
      }, { placeholder: bank.name }),
      this.check("我已核对删除范围，理解原始资料和已有备份不会自动清除", this.session.deleteAcknowledged, (checked) => { this.session.deleteAcknowledged = checked; this.render(); }));
    const confirm = this.action("确认删除此题库", () => {
      if (!this.session.deleteAcknowledged || this.session.deleteName !== bank.name) { this.showProblem("请准确输入题库名称，并确认删除范围。"); return; }
      void this.perform({ type: "delete-bank", bankId: bank.id, confirmName: this.session.deleteName }, (result) => {
        if (!result.issues?.length) {
          this.session.editingKey = null; this.session.deleteName = ""; this.session.deleteAcknowledged = false;
          this.session.selectedCandidates.clear(); this.session.selectedUnits.clear(); this.session.composePreview = undefined;
        }
      });
    });
    confirm.classList.add("is-danger");
    confirm.dataset.deleteBank = bank.id;
    confirm.disabled = this.busy || !this.session.deleteAcknowledged || this.session.deleteName !== bank.name;
    append(remove, confirm); append(panel, remove);
  }

  private describeConflict(value: unknown): string {
    if (!value || typeof value !== "object" || Array.isArray(value)) return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    const record = value as Record<string, unknown>;
    const readable = (item: unknown, fallback = "未知"): string => typeof item === "string" || typeof item === "number" ? String(item) : fallback;
    if (typeof record.stem === "string") {
      const options = Array.isArray(record.options) ? record.options.map((option: unknown) => {
        if (!option || typeof option !== "object") return "";
        const item = option as Record<string, unknown>;
        return `${readable(item.key, "")}. ${readable(item.text, "")}`;
      }).join("\n") : "";
      return `${record.stem}\n\n${options}\n\n答案：${Array.isArray(record.answers) ? record.answers.join("、") : "未提供"}\n知识点：${readable(record.domain, "未归类")}\n修订理由：${readable(record.reason, "未提供")}\n保存时间：${readable(record.createdAt)}`;
    }
    if (typeof record.title === "string") return `${record.title}\n题数：${Array.isArray(record.items) ? record.items.length : "未知"}\n总分：${readable(record.totalScore)}\n限时：${readable(record.durationMinutes)} 分钟\n保存时间：${readable(record.createdAt)}`;
    if (record.kind === "answer") return `作答时间：${readable(record.at)}\n所选答案：${Array.isArray(record.selected) ? record.selected.join("、") : "未记录"}\n判题结果：${record.correct === true ? "正确" : "错误"}\n主动标记蒙对：${record.guessed === true ? "是" : "否"}`;
    return JSON.stringify(value, null, 2);
  }

  private details(key: string, className = ""): HTMLDetailsElement {
    const detail = element("details", { className });
    detail.open = this.session.expanded[key] ?? false;
    detail.addEventListener("toggle", () => { if (detail.isConnected) this.session.expanded[key] = detail.open; });
    return detail;
  }

  private scrollToEditor(): void {
    const viewport = this.contentEl.ownerDocument.defaultView;
    if (viewport && viewport.innerWidth <= 767) {
      this.contentEl.scrollTop = 0;
      this.modalEl.scrollTop = 0;
    }
  }

  private action(text: string, callback: () => void, style: "normal" | "primary" | "quiet" | "row" = "normal"): HTMLButtonElement {
    const button = element("button", { className: `yiji-manager-button ${style === "normal" ? "" : `is-${style}`}`, text, attrs: { type: "button" } });
    button.disabled = this.busy;
    button.addEventListener("click", callback);
    return button;
  }

  private textField(label: string, value: string, update: (value: string) => void, attrs: Record<string, string> = {}): HTMLLabelElement {
    const wrapper = element("label", { className: "yiji-manager-field" });
    const input = element("input", { attrs: { type: "text", ...attrs } });
    input.value = value;
    input.disabled = this.busy;
    input.addEventListener("input", () => { update(input.value); });
    append(wrapper, element("span", { text: label }), input);
    return wrapper;
  }

  private textArea(label: string, value: string, update: (value: string) => void, rows: number): HTMLLabelElement {
    const wrapper = element("label", { className: "yiji-manager-field" });
    const input = element("textarea", { attrs: { rows } });
    input.value = value;
    input.disabled = this.busy;
    input.addEventListener("input", () => { update(input.value); });
    append(wrapper, element("span", { text: label }), input);
    return wrapper;
  }

  private readOnlyText(text: string): HTMLTextAreaElement {
    const input = element("textarea", { className: "yiji-manager-readonly", attrs: { rows: 7, readonly: true, "aria-label": "可选取复制的只读内容" } });
    input.value = text;
    return input;
  }

  private select(label: string, value: string, options: [string, string][], update: (value: string) => void): HTMLLabelElement {
    const wrapper = element("label", { className: "yiji-manager-field" });
    const select = element("select");
    for (const [key, name] of options) append(select, element("option", { text: name, attrs: { value: key } }));
    select.value = value;
    select.disabled = this.busy;
    select.addEventListener("change", () => { update(select.value); });
    append(wrapper, element("span", { text: label }), select);
    return wrapper;
  }

  private check(label: string, checked: boolean, update: (checked: boolean) => void): HTMLLabelElement {
    const wrapper = element("label", { className: "yiji-manager-check" });
    const input = element("input", { attrs: { type: "checkbox" } });
    input.checked = checked;
    input.disabled = this.busy;
    input.addEventListener("change", () => { update(input.checked); });
    append(wrapper, input, element("span", { text: label }));
    return wrapper;
  }

  private heading(text: string): HTMLHeadingElement { return element("h2", { text }); }
  private note(text: string): HTMLParagraphElement { return element("p", { className: "yiji-manager-muted", text }); }
  private empty(title: string, detail: string): HTMLElement {
    const wrapper = element("div", { className: "yiji-manager-empty" });
    append(wrapper, element("h3", { text: title }), this.note(detail));
    return wrapper;
  }
  private showProblem(message: string): void { this.problems = [message]; this.render(); }
}

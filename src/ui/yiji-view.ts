import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_YIJI } from "../constants";
import {
  ACTIVE_CONTENT_PACKAGE,
  getExamQuestionCount,
  getKnowledgeNotePath,
} from "../content/content-package";
import { QuestionBank } from "../data/question-bank";
import { EMBEDDED_EXAM_PAPERS } from "../generated/electricity-trader-pack";
import type { ExamPaper } from "../content/exam-paper";
import { isCorrectSelection, saveExam, startExam, submitExam } from "../state/exam-state";
import type { ExamAttempt } from "../state/exam-state";
import type { Question, QuestionType } from "../domain/question";
import type YijiPlugin from "../main";
import {
  getStudySummary,
  recordAnswer,
  saveCursor,
  toggleBookmark,
} from "../state/study-state";
import type { StudyDataV1, WrongAction } from "../state/study-state";
import { append, button, element, textPair } from "./dom";
import { icon, iconButton } from "./icons";

type Screen = "home" | "library" | "practice" | "feedback" | "exam" | "stats" | "wrongbook"
  | "exam-question" | "exam-sheet" | "exam-confirm" | "exam-result" | "exam-restart";

type PracticeMode =
  | { kind: "domain"; value: string }
  | { kind: "type"; value: QuestionType }
  | { kind: "wrongbook"; value: string | null };

interface FeedbackState {
  correct: boolean;
  selected: string[];
  wrongAction: WrongAction;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  single: "单选",
  multiple: "多选",
  judge: "判断",
};

export class YijiView extends ItemView {
  private rootEl: HTMLElement | null = null;
  private bank: QuestionBank | null = null;
  private screen: Screen = "home";
  private mode: PracticeMode | null = null;
  private sequence: string[] = [];
  private questionIndex = 0;
  private selected = new Set<string>();
  private feedback: FeedbackState | null = null;
  private actionPending = false;
  private examId: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: YijiPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_YIJI;
  }

  getDisplayText(): string {
    return "易记";
  }

  override getIcon(): string {
    return "book-open";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.classList.add("yiji-view-content");
    this.rootEl = this.contentEl.createDiv({ cls: "yiji-root" });
    this.registerDomEvent(this.rootEl, "click", (event) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-action]")
        : null;
      if (target) void this.handleActionSafely(target);
    });
    this.renderLoading();
    this.registerInterval(this.containerEl.win.setInterval(() => { void this.tickExam(); }, 1000));

    try {
      this.bank = await this.plugin.getQuestionBank();
      this.render();
    } catch (error) {
      this.renderError(error);
    }
  }

  override async onClose(): Promise<void> {
    this.contentEl.classList.remove("yiji-view-content");
    this.contentEl.empty();
    this.rootEl = null;
  }

  private get studyData(): StudyDataV1 {
    return this.plugin.getStudyData();
  }

  private renderLoading(): void {
    if (!this.rootEl) return;
    const state = element("div", { className: "yiji-system-state" });
    append(
      state,
      icon("loader-circle", "yiji-system-icon"),
      element("h1", { text: "正在读取题库" }),
      element("p", { text: "正在读取本地题库与内置题包，不会改写原题库。" }),
    );
    this.rootEl.replaceChildren(state);
  }

  private renderError(error: unknown): void {
    if (!this.rootEl) return;
    const message = error instanceof Error ? error.message : String(error);
    const state = element("div", { className: "yiji-system-state yiji-system-error" });
    append(
      state,
      icon("triangle-alert", "yiji-system-icon"),
      element("h1", { text: "题库读取失败" }),
      element("p", { text: message }),
      button("重新读取", "retry-load", "yiji-primary-button"),
    );
    this.rootEl.replaceChildren(state);
  }

  private render(): void {
    if (!this.rootEl || !this.bank) return;
    this.rootEl.replaceChildren(this.renderCurrentScreen());
    this.rootEl.dataset.ready = "true";
  }

  private renderCurrentScreen(): HTMLElement {
    switch (this.screen) {
      case "library": return this.renderLibrary();
      case "practice": return this.renderPractice();
      case "feedback": return this.renderFeedback();
      case "exam": return this.renderExam();
      case "exam-question": return this.renderExamQuestion();
      case "exam-sheet": return this.renderExamSheet();
      case "exam-confirm": return this.renderExamConfirmation(false);
      case "exam-restart": return this.renderExamConfirmation(true);
      case "exam-result": return this.renderExamResult();
      case "stats": return this.renderStats();
      case "wrongbook": return this.renderWrongbook();
      default: return this.renderHome();
    }
  }

  private createScreen(withNav: boolean): { screen: HTMLElement; scroll: HTMLElement } {
    const screen = element("section", {
      className: `yiji-screen${withNav ? " yiji-has-nav" : " yiji-has-dock"}`,
    });
    const scroll = element("div", { className: "yiji-screen-scroll" });
    screen.appendChild(scroll);
    return { screen, scroll };
  }

  private pageHeader(kicker: string, title: string): HTMLElement {
    const header = element("header", { className: "yiji-page-header" });
    const copy = element("div");
    append(
      copy,
      element("p", { className: "yiji-header-kicker", text: kicker }),
      element("h1", { className: "yiji-header-title", text: title }),
    );
    append(header, copy, iconButton("settings", "易记设置", "settings"));
    return header;
  }

  private sectionHeader(title: string, actionText?: string, action?: string): HTMLElement {
    const header = element("div", { className: "yiji-section-header" });
    header.appendChild(element("h2", { text: title }));
    if (actionText && action) header.appendChild(button(actionText, action, "yiji-text-button"));
    return header;
  }

  private renderHome(): HTMLElement {
    const bank = this.requireBank();
    const { screen, scroll } = this.createScreen(true);
    scroll.appendChild(this.pageHeader(`${ACTIVE_CONTENT_PACKAGE.name} · ${bank.counts.total} 题`, "易记"));

    const cursor = this.getLatestCursor();
    if (cursor) {
      const card = button("", "continue-practice", "yiji-continue-card");
      append(
        card,
        element("span", { className: "yiji-eyebrow", text: "上次读到这里" }),
        element("strong", { text: cursor.label }),
        element("span", { className: "yiji-card-meta", text: cursor.position }),
        element("span", { className: "yiji-primary-button yiji-inline-primary", text: "继续刷题" }),
      );
      scroll.appendChild(card);
    }

    scroll.appendChild(this.sectionHeader("按知识域刷", `查看全部 ${bank.domains.length} 个`, "open-library"));
    const domainGrid = element("div", { className: "yiji-domain-grid" });
    const featured = [...bank.domains]
      .filter((domain) => domain.count > 0)
      .sort((left, right) => right.count - left.count)
      .slice(0, 4);
    for (const domain of featured) {
      const domainButton = button("", "start-domain", "yiji-domain-card", { value: domain.name });
      append(
        domainButton,
        element("strong", { text: domain.name }),
        element("span", { text: `${domain.count} 题` }),
      );
      domainGrid.appendChild(domainButton);
    }
    scroll.appendChild(domainGrid);

    scroll.appendChild(this.sectionHeader("按题型刷"));
    const typeGrid = element("div", { className: "yiji-type-grid" });
    for (const type of ["single", "multiple", "judge"] as const) {
      const typeButton = button("", "start-type", "yiji-type-card", { value: type });
      append(
        typeButton,
        element("strong", { text: TYPE_LABELS[type] }),
        element("span", { text: `${bank.counts[type]} 题` }),
      );
      typeGrid.appendChild(typeButton);
    }
    scroll.appendChild(typeGrid);
    screen.appendChild(this.bottomNav("home"));
    return screen;
  }

  private renderLibrary(): HTMLElement {
    const bank = this.requireBank();
    const { screen, scroll } = this.createScreen(true);
    scroll.appendChild(this.pageHeader(`${bank.domains.length} 个知识域 · 默认目录`, "知识域"));
    const list = element("div", { className: "yiji-domain-list" });

    for (const [index, domain] of bank.domains.entries()) {
      const answered = bank.questions.filter(
        (question) => question.domain === domain.name && (this.studyData.questions[question.id]?.attempts ?? 0) > 0,
      ).length;
      const row = button("", "start-domain", "yiji-domain-row", { value: domain.name });
      row.disabled = domain.count === 0;
      append(
        row,
        element("span", { className: "yiji-domain-index", text: String(index + 1).padStart(2, "0") }),
        textPair(domain.name, domain.count ? `已答 ${answered} / ${domain.count}` : "当前题库暂无题目"),
        element("span", { className: "yiji-domain-count", text: domain.count ? `${domain.count} 题` : "0 题" }),
      );
      list.appendChild(row);
    }
    scroll.appendChild(list);
    screen.appendChild(this.bottomNav("home"));
    return screen;
  }

  private renderPractice(): HTMLElement {
    const question = this.currentQuestion();
    if (!question) return this.renderEmptyPractice();
    const { screen, scroll } = this.createScreen(false);
    const header = element("header", { className: "yiji-practice-header" });
    const position = element("div", { className: "yiji-question-position" });
    append(
      position,
      element("strong", { text: `${this.questionIndex + 1} / ${this.sequence.length}` }),
      element("span", { text: this.modeLabel() }),
    );
    const bookmark = iconButton(
      "star",
      this.studyData.questions[question.id]?.bookmarked ? "取消收藏" : "收藏题目",
      "toggle-bookmark",
    );
    if (this.studyData.questions[question.id]?.bookmarked) bookmark.classList.add("is-active");
    append(header, iconButton("x", "退出并保存断点", "exit-practice"), position, bookmark);
    scroll.appendChild(header);

    const progress = element("div", {
      className: "yiji-progress",
      attrs: {
        role: "progressbar",
        "aria-valuemin": "1",
        "aria-valuemax": this.sequence.length,
        "aria-valuenow": this.questionIndex + 1,
      },
    });
    progress.appendChild(
      element("span", { attrs: { style: `width:${((this.questionIndex + 1) / this.sequence.length) * 100}%` } }),
    );
    scroll.appendChild(progress);

    const tags = element("div", { className: "yiji-tag-row" });
    append(
      tags,
      element("span", { className: "yiji-tag is-accent", text: `${TYPE_LABELS[question.type]}题` }),
      element("span", { className: "yiji-tag", text: question.domain }),
      element("span", { className: "yiji-tag", text: `重复考点 ×${question.repeatCount}` }),
    );
    append(
      scroll,
      tags,
      element("h1", { className: "yiji-question-title", text: question.stem }),
      this.renderOptions(question, false),
    );

    const submitText = this.selected.size
      ? question.type === "multiple"
        ? `已选 ${this.selected.size} 项 · 确认答案`
        : "确认答案"
      : "请先选择答案";
    const submit = button(submitText, "submit-answer", "yiji-primary-button");
    submit.disabled = this.selected.size === 0;
    screen.appendChild(this.actionDock(submit));
    return screen;
  }

  private renderFeedback(): HTMLElement {
    const question = this.currentQuestion();
    if (!question || !this.feedback) return this.renderEmptyPractice();
    const { screen, scroll } = this.createScreen(false);
    const header = element("header", { className: "yiji-practice-header" });
    const position = element("div", { className: "yiji-question-position" });
    append(
      position,
      element("strong", { text: "答案核对" }),
      element("span", { text: this.modeLabel() }),
    );
    append(header, iconButton("x", "退出反馈页", "exit-practice"), position, element("span"));
    scroll.appendChild(header);

    const banner = element("div", {
      className: `yiji-result-banner ${this.feedback.correct ? "is-correct" : "is-wrong"}`,
    });
    append(
      banner,
      icon(this.feedback.correct ? "circle-check" : "circle-x", "yiji-result-icon"),
      textPair(
        this.feedback.correct ? "回答正确" : "这题答错了",
        this.resultMessage(this.feedback.wrongAction),
        "yiji-result-title",
        "yiji-result-meta",
      ),
    );
    append(
      scroll,
      banner,
      element("p", { className: "yiji-feedback-stem", text: question.stem }),
      this.renderOptions(question, true),
    );

    const explanation = element("article", { className: "yiji-explanation" });
    append(
      explanation,
      element("h2", { text: "答案与来源" }),
      element("p", {
        text: `参考答案：${question.answers.join("、")}。题库未提供详细解析，保留原答案与来源，避免生成未经复核的解释。`,
      }),
      element("p", {
        className: "yiji-source-line",
        text: `来源：${question.sources.join("、") || "原题库"}`,
      }),
    );
    const notePath = getKnowledgeNotePath(ACTIVE_CONTENT_PACKAGE, question.domain);
    if (notePath && this.app.vault.getAbstractFileByPath(notePath)) {
      explanation.appendChild(
        button(`打开「${question.domain}」知识笔记`, "open-note", "yiji-secondary-button"),
      );
    }
    scroll.appendChild(explanation);
    screen.appendChild(this.actionDock(button("下一题", "next-question", "yiji-primary-button")));
    return screen;
  }

  private renderOptions(question: Question, feedbackMode: boolean): HTMLElement {
    const options = element("div", { className: "yiji-options", attrs: { role: "group" } });
    if (question.sourceNote) options.appendChild(element("p", { className: "yiji-development-note", text: question.sourceNote }));
    for (const option of question.options) {
      const isSelected = this.selected.has(option.key);
      const isAnswer = question.answers.includes(option.key);
      const classNames = ["yiji-option"];
      let marker = "";
      if (!feedbackMode && isSelected) classNames.push("is-selected");
      if (feedbackMode && isAnswer && isSelected) {
        classNames.push("is-correct");
        marker = "正确";
      } else if (feedbackMode && isAnswer) {
        classNames.push("is-missed");
        marker = "漏选";
      } else if (feedbackMode && isSelected) {
        classNames.push("is-wrong");
        marker = "错选";
      }

      const row = feedbackMode
        ? element("div", { className: classNames.join(" ") })
        : button("", "select-option", classNames.join(" "), { value: option.key });
      if (row instanceof HTMLButtonElement) row.setAttribute("aria-pressed", String(isSelected));
      append(
        row,
        element("span", { className: "yiji-option-key", text: option.key }),
        element("span", { className: "yiji-option-copy", text: option.text }),
        element("span", { className: "yiji-option-marker", text: marker }),
      );
      options.appendChild(row);
    }
    return options;
  }

  private renderExam(): HTMLElement {
    const { screen, scroll } = this.createScreen(true);
    const examQuestionCount = getExamQuestionCount(ACTIVE_CONTENT_PACKAGE);
    scroll.appendChild(this.pageHeader(`${ACTIVE_CONTENT_PACKAGE.name} · 按原卷题号作答`, "模考"));
    const intro = element("article", { className: "yiji-exam-intro" });
    append(
      intro,
      element("h2", { text: "新增四套完整真题" }),
      element("p", {
        text: "每卷 170 题，按原题序作答，进度自动保存。练习限时 120 分钟（沿用易记设置，原 PDF 未注明限时），多选须全部选对才得分。",
      }),
    );
    scroll.appendChild(intro);
    for (const paper of EMBEDDED_EXAM_PAPERS) {
      const attempt = this.studyData.exams?.[paper.id];
      const compatible = attempt?.paperDigest === paper.sourceSha256;
      const card = element("article", { className: "yiji-exam-intro" });
      append(card,
        element("h2", { text: paper.title }),
        element("p", { text: `${paper.counts.single} 单选 · ${paper.counts.multiple} 多选 · ${paper.counts.judge} 判断 · ${paper.totalScore} 分` }),
        element("p", { className: "yiji-paper-meta", text: paper.totalScore !== paper.declaredTotalScore
          ? `原卷卷头标注 ${paper.declaredTotalScore} 分，逐题合计 ${paper.totalScore} 分；按逐题分值计分，不折算。`
          : "按原卷逐题分值计分 · 交卷后查看答案" }),
        button(compatible ? attempt.submittedAt !== undefined ? "查看成绩与答案" : "继续作答" : "开始整卷", "exam-open", "yiji-primary-button", { value: paper.id }),
      );
      if (compatible && attempt.submittedAt !== undefined) {
        card.appendChild(button("再练一次", "exam-restart", "yiji-secondary-button", { value: paper.id }));
      }
      scroll.appendChild(card);
    }
    scroll.appendChild(this.sectionHeader("原有样卷与模拟卷 · 待开放"));
    const list = element("div", { className: "yiji-paper-list" });
    for (const paper of ACTIVE_CONTENT_PACKAGE.exam.papers) {
      const card = element("article", { className: "yiji-paper-card" });
      append(
        card,
        icon("file-check-2", "yiji-paper-icon"),
        textPair(
          paper.title,
          `${examQuestionCount} 题 · ${ACTIVE_CONTENT_PACKAGE.exam.durationMinutes} 分钟 · ${ACTIVE_CONTENT_PACKAGE.exam.totalScore} 分`,
          "yiji-paper-name",
          "yiji-paper-meta",
        ),
        element("span", { className: "yiji-paper-badge", text: paper.badge }),
      );
      list.appendChild(card);
    }
    scroll.appendChild(list);
    scroll.appendChild(
      element("p", {
        className: "yiji-development-note",
        text: "以上原有两套样卷和五套模拟卷仍待映射与体检；新增四套真题已可完整作答。",
      }),
    );
    screen.appendChild(this.bottomNav("exam"));
    return screen;
  }

  private currentExam(): { paper: ExamPaper; attempt: ExamAttempt } {
    const paper = EMBEDDED_EXAM_PAPERS.find((entry) => entry.id === this.examId);
    const attempt = paper && this.studyData.exams?.[paper.id];
    if (!paper || !attempt || attempt.paperDigest !== paper.sourceSha256) throw new Error("试卷尚未开始或版本已变更");
    return { paper, attempt };
  }

  private examTimerText(attempt: ExamAttempt): string {
    const seconds = Math.max(0, Math.ceil((attempt.deadlineAt - Date.now()) / 1000));
    return `剩余 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  private async tickExam(): Promise<void> {
    if (!this.rootEl || this.actionPending || !this.examId || !this.screen.startsWith("exam-")) return;
    const attempt = this.studyData.exams?.[this.examId];
    if (!attempt || attempt.submittedAt !== undefined) return;
    const timer = this.rootEl.querySelector(".yiji-exam-timer");
    if (timer) timer.textContent = this.examTimerText(attempt);
    if (Date.now() >= attempt.deadlineAt) {
      this.actionPending = true;
      try { await this.finishExam(); }
      catch (error) { console.error("易记自动交卷失败", error); }
      finally { this.actionPending = false; }
    }
  }

  private async finishExam(): Promise<void> {
    const { paper } = this.currentExam();
    await this.plugin.persistStudyData(submitExam(this.studyData, paper, this.requireBank().byId, Date.now()));
    this.screen = "exam-result";
    this.render();
  }

  private renderExamQuestion(): HTMLElement {
    const { paper, attempt } = this.currentExam();
    const item = paper.items[attempt.index]!;
    const question = this.requireBank().byId.get(item.questionId)!;
    const review = attempt.submittedAt !== undefined;
    const { screen, scroll } = this.createScreen(false);
    append(scroll,
      button("返回试卷列表", "nav-exam", "yiji-text-button"),
      this.pageHeader(paper.title, `第 ${item.ordinal} / ${paper.items.length} 题`),
      element("p", { className: "yiji-exam-timer", text: review ? "已交卷 · 答案回顾" : this.examTimerText(attempt) }),
      element("p", { className: "yiji-paper-meta", text: `${TYPE_LABELS[question.type]}题 · ${item.points} 分 · ${question.domain}` }),
      element("h2", { className: "yiji-question-title", text: question.stem }),
    );
    const saved = this.selected;
    this.selected = new Set(attempt.answers[String(item.ordinal)] ?? []);
    const options = this.renderOptions(question, review);
    this.selected = saved;
    options.querySelectorAll<HTMLElement>("[data-action]").forEach((row) => { row.dataset.action = "exam-select"; });
    scroll.appendChild(options);
    if (review) {
      append(scroll, element("p", { className: "yiji-explanation", text: `你的答案：${attempt.answers[String(item.ordinal)]?.join("、") || "未作答"}；参考答案：${question.answers.join("、")}。原题库未提供详细解析。` }));
    }
    const controls = element("div", { className: "yiji-exam-controls" });
    const previous = button("上一题", "exam-move", "yiji-secondary-button", { value: String(attempt.index - 1) });
    previous.disabled = attempt.index === 0;
    const next = button("下一题", "exam-move", "yiji-primary-button", { value: String(attempt.index + 1) });
    next.disabled = attempt.index === paper.items.length - 1;
    append(controls, previous, button("答题卡", "exam-sheet", "yiji-secondary-button"), next);
    screen.appendChild(this.actionDock(controls));
    return screen;
  }

  private renderExamSheet(): HTMLElement {
    const { paper, attempt } = this.currentExam();
    const { screen, scroll } = this.createScreen(false);
    const review = attempt.submittedAt !== undefined;
    const answered = Object.values(attempt.answers).filter((answer) => answer.length).length;
    append(scroll, button("返回当前题", "exam-question", "yiji-text-button"),
      this.pageHeader(paper.title, "答题卡"),
      element("p", { text: `已答 ${answered} / ${paper.items.length} 题 · 点击题号跳转` }));
    const grid = element("div", { className: "yiji-exam-grid" });
    for (const item of paper.items) {
      const selected = attempt.answers[String(item.ordinal)] ?? [];
      const correct = isCorrectSelection(this.requireBank().byId.get(item.questionId)!, selected);
      const status = !selected.length ? "未答" : review ? correct ? "正确" : "错误" : "已答";
      grid.appendChild(button(`${item.ordinal}\n${status}`, "exam-move", `yiji-exam-number ${selected.length ? review && !correct ? "is-wrong" : "is-selected" : ""}`, { value: String(item.ordinal - 1) }));
    }
    scroll.appendChild(grid);
    screen.appendChild(this.actionDock(button(review ? "返回成绩" : "交卷", review ? "exam-result" : "exam-confirm", "yiji-primary-button")));
    return screen;
  }

  private renderExamConfirmation(restart: boolean): HTMLElement {
    const { paper, attempt } = this.currentExam();
    const { screen, scroll } = this.createScreen(false);
    const unanswered = paper.items.filter((item) => !attempt.answers[String(item.ordinal)]?.length).length;
    append(scroll, this.pageHeader(paper.title, restart ? "再练一次？" : "确认交卷？"),
      element("p", { className: "yiji-explanation", text: restart
        ? "将替换本卷上一次成绩和作答快照。累计答题记录、错题与收藏仍然保留。"
        : `还有 ${unanswered} 题未作答。交卷后不可修改答案；未答题计 0 分，不加入错题本。` }),
      button("返回", restart ? "nav-exam" : "exam-sheet", "yiji-secondary-button"));
    screen.appendChild(this.actionDock(button(restart ? "确认重新开始" : "确认交卷", restart ? "exam-start-again" : "exam-submit", "yiji-primary-button")));
    return screen;
  }

  private renderExamResult(): HTMLElement {
    const { paper, attempt } = this.currentExam();
    const { screen, scroll } = this.createScreen(false);
    append(scroll, this.pageHeader(paper.title, `${attempt.score ?? 0} / ${paper.totalScore} 分`),
      element("p", { className: "yiji-explanation", text: `答对 ${attempt.correctCount ?? 0} 题 · 答错 ${(attempt.answeredCount ?? 0) - (attempt.correctCount ?? 0)} 题 · 未答 ${paper.items.length - (attempt.answeredCount ?? 0)} 题。已作答题目的结果已同步到统计和错题本。` }),
      element("p", { className: "yiji-paper-meta", text: paper.ruleNote }),
      button("查看答题卡与答案", "exam-sheet", "yiji-primary-button"));
    screen.appendChild(this.actionDock(button("返回试卷列表", "nav-exam", "yiji-secondary-button")));
    return screen;
  }

  private async handleExamAction(action: string, value: string | undefined): Promise<void> {
    if (action === "exam-open" || action === "exam-restart") {
      const paper = EMBEDDED_EXAM_PAPERS.find((entry) => entry.id === value);
      if (!paper || paper.items.some((item) => !this.requireBank().byId.has(item.questionId))) throw new Error("试卷不完整");
      this.examId = paper.id;
      const existing = this.studyData.exams?.[paper.id];
      if (!existing || existing.paperDigest !== paper.sourceSha256) {
        await this.plugin.persistStudyData(saveExam(this.studyData, startExam(paper, Date.now())));
      }
      const { attempt } = this.currentExam();
      if (attempt.submittedAt === undefined && Date.now() >= attempt.deadlineAt) { await this.finishExam(); return; }
      this.screen = action === "exam-restart" ? "exam-restart" : attempt.submittedAt !== undefined ? "exam-result" : "exam-question";
      this.render();
      return;
    }
    const { paper, attempt } = this.currentExam();
    if (attempt.submittedAt === undefined && Date.now() >= attempt.deadlineAt) { await this.finishExam(); return; }
    if (action === "exam-submit") { await this.finishExam(); return; }
    if (action === "exam-start-again" && this.screen === "exam-restart") {
      await this.plugin.persistStudyData(saveExam(this.studyData, startExam(paper, Date.now())));
      this.screen = "exam-question";
    } else if (action === "exam-select" && value && attempt.submittedAt === undefined) {
      const item = paper.items[attempt.index]!;
      const question = this.requireBank().byId.get(item.questionId)!;
      if (!question.options.some((option) => option.key === value)) return;
      const selected = new Set(attempt.answers[String(item.ordinal)] ?? []);
      if (question.type !== "multiple") selected.clear();
      if (selected.has(value)) selected.delete(value); else selected.add(value);
      await this.plugin.persistStudyData(saveExam(this.studyData, { ...attempt, answers: { ...attempt.answers, [item.ordinal]: [...selected] } }));
      const scrollTop = this.rootEl?.querySelector(".yiji-screen-scroll")?.scrollTop ?? 0;
      this.render();
      const scroll = this.rootEl?.querySelector(".yiji-screen-scroll");
      if (scroll) scroll.scrollTop = scrollTop;
      return;
    } else if (action === "exam-move" && value !== undefined) {
      const index = Number(value);
      if (!Number.isInteger(index) || index < 0 || index >= paper.items.length) return;
      await this.plugin.persistStudyData(saveExam(this.studyData, { ...attempt, index }));
      this.screen = "exam-question";
    } else if (action === "exam-sheet" || action === "exam-question" || action === "exam-result" || action === "exam-confirm") {
      this.screen = action;
    }
    this.render();
  }

  private renderStats(): HTMLElement {
    const bank = this.requireBank();
    const summary = getStudySummary(this.studyData);
    const { screen, scroll } = this.createScreen(true);
    scroll.appendChild(this.pageHeader("错题 · 收藏 · 历史 · 成绩", "统计"));

    const wrongEntry = button("", "open-wrongbook", "yiji-wrong-entry");
    append(
      wrongEntry,
      icon("triangle-alert", "yiji-wrong-entry-icon"),
      textPair("错题本", "答错加入，完整答对后自动移出", "yiji-wrong-entry-title", "yiji-row-meta"),
      element("strong", { className: "yiji-wrong-entry-count", text: `${summary.wrongCount} 题` }),
      icon("chevron-right", "yiji-row-arrow"),
    );
    scroll.appendChild(wrongEntry);

    const grid = element("div", { className: "yiji-stats-grid" });
    for (const [value, label] of [
      [summary.answeredCount, "已答题目"],
      [`${summary.accuracy}%`, "累计正确率"],
      [summary.bookmarkedCount, "收藏题目"],
      [summary.attemptCount, "累计作答"],
    ] as const) {
      const card = element("article", { className: "yiji-stat-card" });
      append(
        card,
        element("strong", { text: String(value) }),
        element("span", { text: label }),
      );
      grid.appendChild(card);
    }
    scroll.appendChild(grid);

    const completedExams = EMBEDDED_EXAM_PAPERS.filter((paper) => this.studyData.exams?.[paper.id]?.submittedAt !== undefined);
    if (completedExams.length) {
      scroll.appendChild(this.sectionHeader("近期真题成绩"));
      for (const paper of completedExams) {
        const attempt = this.studyData.exams?.[paper.id];
        scroll.appendChild(button(`${paper.title} · ${attempt?.score ?? 0} / ${paper.totalScore} 分`, "exam-open", "yiji-secondary-button", { value: paper.id }));
      }
    }

    scroll.appendChild(this.sectionHeader("最近活动"));
    const history = element("div", { className: "yiji-history-list" });
    const recent = [...this.studyData.history].slice(-3).reverse();
    if (!recent.length) {
      history.appendChild(element("p", { className: "yiji-empty-copy", text: "完成第一道题后，作答记录会出现在这里。" }));
    }
    for (const entry of recent) {
      const question = bank.byId.get(entry.questionId);
      if (!question) continue;
      const row = element("article", { className: "yiji-history-row" });
      append(
        row,
        textPair(question.domain, question.stem, "yiji-history-title", "yiji-history-meta"),
        element("span", {
          className: `yiji-history-result ${entry.correct ? "is-correct" : "is-wrong"}`,
          text: entry.correct ? "正确" : "错误",
        }),
      );
      history.appendChild(row);
    }
    scroll.appendChild(history);

    const health = element("div", { className: "yiji-health-row" });
    const sourceLabel = bank.sourceKind === "embedded" ? "内置题包" : "本地 Markdown + 内置题包";
    append(
      health,
      icon("activity", "yiji-health-icon"),
      textPair(
        "题库体检",
        bank.issues.length
          ? `${sourceLabel} · ${bank.issues.length} 处解析问题`
          : `${sourceLabel} · ${bank.counts.total} 题解析正常 · 0 个 ID 冲突`,
      ),
    );
    scroll.appendChild(health);
    screen.appendChild(this.bottomNav("stats"));
    return screen;
  }

  private renderWrongbook(): HTMLElement {
    const bank = this.requireBank();
    const summary = getStudySummary(this.studyData);
    const { screen, scroll } = this.createScreen(true);
    const header = element("header", { className: "yiji-subpage-header" });
    const copy = element("div");
    append(
      copy,
      element("p", { text: "统计 / 错题本" }),
      element("h1", { text: "错题本" }),
    );
    append(header, iconButton("chevron-left", "返回统计", "nav-stats"), copy, element("span"));
    scroll.appendChild(header);

    const summaryCard = element("article", { className: "yiji-wrong-summary" });
    const number = element("div");
    append(
      number,
      element("strong", { text: String(summary.wrongCount) }),
      element("span", { text: "当前错题" }),
    );
    append(
      summaryCard,
      number,
      element("p", { text: "完整答对后自动移出，错误历史仍保留。" }),
      button("继续刷错题", "start-wrongbook", "yiji-primary-button"),
    );
    scroll.appendChild(summaryCard);
    scroll.appendChild(this.sectionHeader("按知识域查看"));

    const wrongQuestions = bank.questions.filter((question) => this.studyData.questions[question.id]?.isWrong);
    const list = element("div", { className: "yiji-wrong-list" });
    const grouped = new Map<string, number>();
    for (const question of wrongQuestions) grouped.set(question.domain, (grouped.get(question.domain) ?? 0) + 1);
    if (!wrongQuestions.length) {
      const empty = element("div", { className: "yiji-empty-state" });
      append(
        empty,
        icon("circle-check", "yiji-empty-icon"),
        element("strong", { text: "当前没有错题" }),
        element("p", { text: "之后答错会自动加入这里，不需要手工整理。" }),
      );
      list.appendChild(empty);
    }
    for (const { name: domain } of bank.domains) {
      const count = grouped.get(domain) ?? 0;
      if (!count) continue;
      const row = button("", "start-wrong-domain", "yiji-wrong-row", { value: domain });
      append(
        row,
        textPair(domain, "按本知识域继续练习"),
        element("strong", { text: `${count} 题` }),
      );
      list.appendChild(row);
    }
    scroll.appendChild(list);
    screen.appendChild(this.bottomNav("stats"));
    return screen;
  }

  private renderEmptyPractice(): HTMLElement {
    const { screen, scroll } = this.createScreen(false);
    const state = element("div", { className: "yiji-system-state" });
    append(
      state,
      icon("circle-check", "yiji-system-icon"),
      element("h1", { text: "这一组已经刷完" }),
      element("p", { text: "可以返回题库选择其他知识域，或去统计页回看。" }),
      button("返回题库", "nav-home", "yiji-primary-button"),
    );
    scroll.appendChild(state);
    return screen;
  }

  private bottomNav(active: "home" | "exam" | "stats"): HTMLElement {
    const nav = element("nav", { className: "yiji-bottom-nav", attrs: { "aria-label": "主要导航" } });
    const items = [
      ["home", "book-open", "题库"],
      ["exam", "clipboard-check", "模考"],
      ["stats", "chart-no-axes-column", "统计"],
    ] as const;
    for (const [screen, iconName, label] of items) {
      const item = button("", `nav-${screen}`, `yiji-nav-button${active === screen ? " is-active" : ""}`);
      if (active === screen) item.setAttribute("aria-current", "page");
      append(item, icon(iconName), element("span", { text: label }));
      nav.appendChild(item);
    }
    return nav;
  }

  private actionDock(action: HTMLElement): HTMLElement {
    const dock = element("div", { className: "yiji-action-dock" });
    dock.appendChild(action);
    return dock;
  }

  private requireBank(): QuestionBank {
    if (!this.bank) throw new Error("题库尚未读取完成");
    return this.bank;
  }

  private currentQuestion(): Question | null {
    const questionId = this.sequence[this.questionIndex];
    return questionId ? this.requireBank().byId.get(questionId) ?? null : null;
  }

  private questionsForMode(mode: PracticeMode): Question[] {
    const questions = this.requireBank().questions;
    if (mode.kind === "domain") return questions.filter((question) => question.domain === mode.value);
    if (mode.kind === "type") return questions.filter((question) => question.type === mode.value);
    return questions.filter(
      (question) =>
        this.studyData.questions[question.id]?.isWrong &&
        (mode.value === null || question.domain === mode.value),
    );
  }

  private cursorKey(mode: PracticeMode): string {
    if (mode.kind === "domain") return `domain:${mode.value}`;
    if (mode.kind === "type") return `type:${mode.value}`;
    return mode.value ? `wrongbook:${mode.value}` : "wrongbook:all";
  }

  private async beginPractice(mode: PracticeMode): Promise<void> {
    const questions = this.questionsForMode(mode);
    if (!questions.length) {
      new Notice(mode.kind === "wrongbook" ? "当前没有可刷的错题" : "当前分类没有题目");
      return;
    }

    const sequence = questions.map((question) => question.id);
    const cursor = this.studyData.cursors[this.cursorKey(mode)];
    const cursorIndex = cursor ? sequence.indexOf(cursor.questionId) : -1;
    const unansweredIndex = questions.findIndex(
      (question) => (this.studyData.questions[question.id]?.attempts ?? 0) === 0,
    );
    this.mode = mode;
    this.sequence = sequence;
    this.questionIndex = cursorIndex >= 0 ? cursorIndex : unansweredIndex >= 0 ? unansweredIndex : 0;
    this.selected.clear();
    this.feedback = null;
    this.screen = "practice";
    await this.saveCurrentCursor();
    this.render();
  }

  private async saveCurrentCursor(): Promise<void> {
    const question = this.currentQuestion();
    if (!question || !this.mode) return;
    const next = saveCursor(this.studyData, this.cursorKey(this.mode), question.id);
    await this.plugin.persistStudyData(next);
  }

  private modeLabel(): string {
    if (!this.mode) return "练习";
    if (this.mode.kind === "domain") return this.mode.value;
    if (this.mode.kind === "type") return `${TYPE_LABELS[this.mode.value]}题专项`;
    return this.mode.value ? `${this.mode.value}错题` : "错题本";
  }

  private getLatestCursor(): { mode: PracticeMode; label: string; position: string } | null {
    const bank = this.requireBank();
    const entries = Object.entries(this.studyData.cursors).sort(
      ([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt),
    );
    for (const [key, cursor] of entries) {
      const question = bank.byId.get(cursor.questionId);
      if (!question) continue;
      let mode: PracticeMode | null = null;
      if (key.startsWith("domain:")) mode = { kind: "domain", value: key.slice(7) };
      if (key.startsWith("type:")) {
        const type = key.slice(5);
        if (this.isQuestionType(type)) mode = { kind: "type", value: type };
      }
      if (key === "wrongbook:all") mode = { kind: "wrongbook", value: null };
      if (key.startsWith("wrongbook:") && key !== "wrongbook:all") {
        mode = { kind: "wrongbook", value: key.slice(10) };
      }
      if (!mode) continue;
      const questions = this.questionsForMode(mode);
      const position = questions.findIndex((item) => item.id === cursor.questionId);
      if (position < 0) continue;
      return {
        mode,
        label: mode.kind === "domain" ? `${mode.value} · ${TYPE_LABELS[question.type]}题` : this.labelForMode(mode),
        position: `第 ${position + 1} / ${questions.length} 题 · 位置已自动保存`,
      };
    }
    return null;
  }

  private labelForMode(mode: PracticeMode): string {
    if (mode.kind === "type") return `${TYPE_LABELS[mode.value]}题专项`;
    if (mode.kind === "wrongbook") return mode.value ? `${mode.value}错题` : "错题本";
    return mode.value;
  }

  private resultMessage(action: WrongAction): string {
    if (action === "added") return "已加入错题本";
    if (action === "kept") return "仍保留在错题本";
    if (action === "removed") return "已从错题本移出，历史记录仍保留";
    return "本题结果已记录";
  }

  private isQuestionType(value: string): value is QuestionType {
    return value === "single" || value === "multiple" || value === "judge";
  }

  private async handleActionSafely(target: HTMLElement): Promise<void> {
    if (this.actionPending) return;
    this.actionPending = true;
    try {
      await this.handleAction(target);
    } catch (error) {
      console.error("易记操作失败", error);
      new Notice("操作失败，请稍后重试；题库原文未被修改");
    } finally {
      this.actionPending = false;
    }
  }

  private async handleAction(target: HTMLElement): Promise<void> {
    const action = target.dataset.action;
    if (!action) return;
    if (action.startsWith("exam-")) {
      await this.handleExamAction(action, target.dataset.value);
      return;
    }
    if (action === "nav-home") {
      this.screen = "home";
      this.render();
      return;
    }
    if (action === "nav-exam") {
      this.screen = "exam";
      this.render();
      return;
    }
    if (action === "nav-stats") {
      this.screen = "stats";
      this.render();
      return;
    }
    if (action === "open-library") {
      this.screen = "library";
      this.render();
      return;
    }
    if (action === "open-wrongbook") {
      this.screen = "wrongbook";
      this.render();
      return;
    }
    if (action === "start-domain" && target.dataset.value) {
      await this.beginPractice({ kind: "domain", value: target.dataset.value });
      return;
    }
    if (action === "start-type" && target.dataset.value && this.isQuestionType(target.dataset.value)) {
      await this.beginPractice({ kind: "type", value: target.dataset.value });
      return;
    }
    if (action === "start-wrongbook") {
      await this.beginPractice({ kind: "wrongbook", value: null });
      return;
    }
    if (action === "start-wrong-domain" && target.dataset.value) {
      await this.beginPractice({ kind: "wrongbook", value: target.dataset.value });
      return;
    }
    if (action === "continue-practice") {
      const cursor = this.getLatestCursor();
      if (cursor) await this.beginPractice(cursor.mode);
      return;
    }
    if (action === "select-option" && target.dataset.value) {
      const question = this.currentQuestion();
      if (!question) return;
      if (question.type === "multiple") {
        if (this.selected.has(target.dataset.value)) this.selected.delete(target.dataset.value);
        else this.selected.add(target.dataset.value);
      } else {
        this.selected = new Set([target.dataset.value]);
      }
      this.render();
      return;
    }
    if (action === "toggle-bookmark") {
      const question = this.currentQuestion();
      if (!question) return;
      const data = toggleBookmark(this.studyData, question.id);
      await this.plugin.persistStudyData(data);
      this.render();
      new Notice(data.questions[question.id]?.bookmarked ? "已加入收藏" : "已取消收藏");
      return;
    }
    if (action === "submit-answer" && this.selected.size) {
      const question = this.currentQuestion();
      if (!question) return;
      const selected = [...this.selected];
      const correct =
        selected.length === question.answers.length &&
        selected.every((answer) => question.answers.includes(answer));
      const transition = recordAnswer(this.studyData, question.id, correct, new Date().toISOString());
      await this.plugin.persistStudyData(transition.data);
      this.feedback = { correct, selected, wrongAction: transition.wrongAction };
      this.screen = "feedback";
      this.render();
      return;
    }
    if (action === "next-question") {
      await this.advanceQuestion();
      return;
    }
    if (action === "exit-practice") {
      this.screen = this.mode?.kind === "wrongbook" ? "wrongbook" : "home";
      this.selected.clear();
      this.feedback = null;
      this.render();
      return;
    }
    if (action === "open-note") {
      const question = this.currentQuestion();
      if (question) await this.openKnowledgeNote(question.domain);
      return;
    }
    if (action === "retry-load") {
      this.renderLoading();
      try {
        this.bank = await this.plugin.getQuestionBank();
        this.render();
      } catch (error) {
        this.renderError(error);
      }
      return;
    }
    if (action === "settings") new Notice("设置将在内容包切换功能中开放");
  }

  private async advanceQuestion(): Promise<void> {
    if (!this.mode) return;
    const currentId = this.sequence[this.questionIndex];
    const oldSequence = this.sequence;
    const oldIndex = this.questionIndex;
    const fresh = this.questionsForMode(this.mode).map((question) => question.id);
    if (!fresh.length) {
      this.sequence = [];
      this.questionIndex = 0;
      this.screen = this.mode.kind === "wrongbook" ? "wrongbook" : "home";
      this.selected.clear();
      this.feedback = null;
      this.render();
      return;
    }

    const currentFreshIndex = currentId ? fresh.indexOf(currentId) : -1;
    if (currentFreshIndex >= 0) {
      this.questionIndex = (currentFreshIndex + 1) % fresh.length;
    } else {
      const nextId = oldSequence.slice(oldIndex + 1).find((questionId) => fresh.includes(questionId));
      this.questionIndex = nextId ? fresh.indexOf(nextId) : 0;
    }
    this.sequence = fresh;
    this.selected.clear();
    this.feedback = null;
    this.screen = "practice";
    await this.saveCurrentCursor();
    this.render();
  }

  private async openKnowledgeNote(domain: string): Promise<void> {
    const path = getKnowledgeNotePath(ACTIVE_CONTENT_PACKAGE, domain);
    if (!path || !this.app.vault.getAbstractFileByPath(path)) {
      new Notice("未找到对应知识笔记");
      return;
    }
    await this.app.workspace.openLinkText(path, "", true);
  }
}

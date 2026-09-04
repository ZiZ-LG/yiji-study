import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_YIJI } from "../constants";
import {
  ACTIVE_CONTENT_PACKAGE,
  getExamQuestionCount,
  getExamRuleText,
  getKnowledgeNotePath,
} from "../content/content-package";
import { DOMAIN_ORDER, QuestionBank } from "../data/question-bank";
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

type Screen = "home" | "library" | "practice" | "feedback" | "exam" | "stats" | "wrongbook";

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
      element("p", { text: "易记只读取本地 Markdown，不会改写原题库。" }),
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
    scroll.appendChild(this.pageHeader(`${ACTIVE_CONTENT_PACKAGE.name} · 固定考试规则`, "模考"));
    const intro = element("article", { className: "yiji-exam-intro" });
    append(
      intro,
      element("h2", { text: "规则与样卷保持一致" }),
      element("p", {
        text: getExamRuleText(ACTIVE_CONTENT_PACKAGE),
      }),
    );
    scroll.appendChild(intro);
    scroll.appendChild(this.sectionHeader("真题参考与固定模拟卷"));
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
        text: "开考功能将在原卷映射和模拟卷体检全部通过后开放；当前开发版不会用随机题冒充固定试卷。",
      }),
    );
    screen.appendChild(this.bottomNav("exam"));
    return screen;
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
    const sourceLabel = bank.sourceKind === "embedded" ? "内置题包" : "本地 Markdown";
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
    for (const domain of DOMAIN_ORDER) {
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

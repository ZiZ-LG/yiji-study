import { Notice, Plugin, TFile, debounce } from "obsidian";
import { VIEW_TYPE_YIJI } from "./constants";
import type { QuestionBank } from "./data/question-bank";
import type { StudyDataV1 } from "./state/study-state";
import { YijiView } from "./ui/yiji-view";
import { LibraryController } from "./host/library-controller";
import { ManagerController } from "./host/manager-controller";
import { LibraryManager } from "./ui/library-manager";
import type { ExamPaper } from "./content/exam-paper";
import { getActiveBank } from "./library";

export { VIEW_TYPE_YIJI } from "./constants";

export default class YijiPlugin extends Plugin {
  private controller!: LibraryController;
  private managerHost!: ManagerController;

  override async onload(): Promise<void> {
    const raw: unknown = await this.loadData();
    this.controller = new LibraryController(this.app, (settings) => this.saveData(settings), raw);
    await this.controller.initialize(raw);
    this.managerHost = new ManagerController(this.controller);
    this.registerView(VIEW_TYPE_YIJI, (leaf) => new YijiView(leaf, this));

    this.addRibbonIcon("book-open", "打开易记", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-yiji",
      name: "打开刷题器",
      callback: () => {
        void this.activateView();
      },
    });
    this.addCommand({ id: "manage-question-banks", name: "管理题库与导入资料", callback: () => this.openManager() });
    const refresh = debounce(() => {
      void this.refreshFromDisk().catch((error: unknown) => {
        new Notice(error instanceof Error ? error.message : "题库刷新失败，请等待同步完成后重试。", 10000);
      });
    }, 500, true);
    this.registerDomEvent(window, "focus", refresh);
    this.registerDomEvent(document, "visibilitychange", () => { if (!document.hidden) refresh(); });
  }

  getStudyData(): StudyDataV1 {
    return this.controller.getStudyData();
  }

  async persistStudyData(data: StudyDataV1): Promise<void> {
    await this.controller.persistStudyData(data);
  }

  getQuestionBank(): Promise<QuestionBank> {
    return Promise.resolve(this.controller.getQuestionBank());
  }

  getQuestionBankSnapshot() {
    const bank = this.controller.getQuestionBank();
    return { bank, bankId: this.getActiveBankId(), revisions: new Map(bank.questions.map((question) => [question.id, this.controller.getRevision(question.id)!])) };
  }

  getContentPackage() { return this.controller.getContentPackage(); }
  getActiveBankId() { return this.controller.state.activeBankId ?? ""; }
  getExamPapers() { return this.controller.getExamPapers(); }
  getExamQuestions(paper: ExamPaper) { return this.controller.getExamQuestions(paper); }
  getQuestionRevision(id: string) { return this.controller.getRevision(id); }
  getReviewIds() { return this.controller.getReviewIds(); }
  isReviewEnabled() { return this.controller.reviewEnabled(); }
  async markGuessed(id: string) { await this.controller.markGuessed(id); }
  submitPracticeAnswer(id: string, revisionId: string, selected: string[], context: "practice" | "review") {
    return this.controller.submitPracticeAnswer(id, revisionId, selected, context);
  }
  getExamHistory() { return this.controller.getExamHistory(); }
  selectExamHistory(id: string) { return this.controller.selectExamHistory(id); }
  clearExamHistorySelection() { this.controller.clearExamHistorySelection(); }
  getLearningEvidence() { return this.controller.getLearningEvidence(); }
  getExamExplanation(paper: ExamPaper, ordinal: number): string | undefined {
    return getActiveBank(this.controller.state)?.papers[paper.id]?.items.find((item) => item.ordinal === ordinal)?.snapshot.explanation;
  }
  private async refreshFromDisk(): Promise<void> {
    await this.controller.reloadFromDisk();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_YIJI)) {
      if (leaf.view instanceof YijiView) await leaf.view.refreshLibrary();
    }
  }
  getQuestionImages(id: string, paper?: ExamPaper, revisionId?: string): string[] {
    const bank = getActiveBank(this.controller.state);
    const revision = paper ? bank?.papers[paper.id]?.items.find((item) => item.questionId === id)?.snapshot : revisionId ? bank?.questions[id]?.revisions[revisionId] : this.controller.getRevision(id);
    return (revision?.attachmentIds ?? []).flatMap((attachmentId) => {
      const attachment = bank?.attachments[attachmentId];
      if (!attachment || !/^image\/(png|jpeg|gif|webp)$/.test(attachment.mimeType)) return [];
      const file = this.app.vault.getAbstractFileByPath(attachment.path);
      return file instanceof TFile ? [this.app.vault.getResourcePath(file)] : [];
    });
  }

  openManager(): void {
    const modal = new LibraryManager(this.app, this.managerHost);
    const close = modal.onClose.bind(modal);
    modal.onClose = () => {
      close();
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_YIJI)) {
        if (leaf.view instanceof YijiView) void leaf.view.refreshLibrary();
      }
    };
    modal.open();
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_YIJI)[0];
    const leaf = existing ?? this.app.workspace.getLeaf(true);

    await leaf.setViewState({ type: VIEW_TYPE_YIJI, active: true });
    await this.app.workspace.revealLeaf(leaf);

    if (!existing) {
      new Notice("易记已打开");
    }
  }
}

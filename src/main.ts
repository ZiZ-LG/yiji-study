import { Notice, Plugin } from "obsidian";
import { VIEW_TYPE_YIJI } from "./constants";
import { loadQuestionBank, QuestionBank } from "./data/question-bank";
import {
  createEmptyStudyData,
  parseStudyData,
  StudyDataV1,
} from "./state/study-state";
import { YijiView } from "./ui/yiji-view";

export { VIEW_TYPE_YIJI } from "./constants";

export default class YijiPlugin extends Plugin {
  private bankPromise: Promise<QuestionBank> | null = null;
  private studyData: StudyDataV1 = createEmptyStudyData();

  override async onload(): Promise<void> {
    this.studyData = parseStudyData(await this.loadData());
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
  }

  getStudyData(): StudyDataV1 {
    return this.studyData;
  }

  async persistStudyData(data: StudyDataV1): Promise<void> {
    this.studyData = data;
    await this.saveData(data);
  }

  getQuestionBank(): Promise<QuestionBank> {
    this.bankPromise ??= loadQuestionBank(this.app.vault).catch((error: unknown) => {
      this.bankPromise = null;
      throw error;
    });
    return this.bankPromise;
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

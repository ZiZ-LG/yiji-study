import { YijiView } from "../../src/ui/yiji-view";
import { buildQuestionBankFromQuestions } from "../../src/data/question-bank";
import { EMBEDDED_EXAM_PAPERS, EMBEDDED_QUESTIONS } from "../../src/generated/electricity-trader-pack";
import { createEmptyStudyData, parseStudyData, recordAnswer } from "../../src/state/study-state";
import type YijiPlugin from "../../src/main";
import type { StudyDataV1 } from "../../src/state/study-state";
import type { WorkspaceLeaf } from "obsidian";

const params = new URLSearchParams(location.search);
document.body.className = params.get("platform") === "android" ? "is-mobile is-phone is-android" : "is-mobile is-phone is-ios is-floating-nav";
const app = document.getElementById("app")!;
app.style.width = `${Number(params.get("width")) || 390}px`;
let saved: StudyDataV1 = createEmptyStudyData();
let failSave = false;
const bank = buildQuestionBankFromQuestions(EMBEDDED_QUESTIONS);
const plugin = {
  getStudyData: () => saved,
  getQuestionBank: async () => bank,
  persistStudyData: async (data: StudyDataV1) => {
    if (failSave) throw new Error("Simulated storage failure");
    saved = parseStudyData(JSON.parse(JSON.stringify(data)));
  },
};
let view: YijiView;
const checks: string[] = [];
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
async function open() {
  if (view) { (view as unknown as { destroy(): void }).destroy(); await view.onClose(); }
  view = new YijiView({} as WorkspaceLeaf, plugin as unknown as YijiPlugin);
  await view.onOpen();
}
async function click(action: string, value?: string) {
  const node = Array.from(app.querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`))
    .find((node) => value === undefined || node.dataset.value === value);
  assert(node && !node.disabled, `Missing enabled button: ${action}/${value}`);
  node.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
function measure() {
  for (const node of Array.from(app.querySelectorAll<HTMLElement>("button, .yiji-option-copy, .yiji-question-title"))) {
    assert(node.scrollWidth <= node.clientWidth + 1, `Text overflow: ${node.className}`);
  }
  for (const key of Array.from(app.querySelectorAll(".yiji-option-key"))) {
    const outer = key.parentElement!.getBoundingClientRect();
    const rect = key.getBoundingClientRect();
    assert(rect.left >= outer.left && rect.right <= outer.right && rect.top >= outer.top && rect.bottom <= outer.bottom, "Option key outside button");
  }
  const dock = app.querySelector(".yiji-action-dock")?.getBoundingClientRect();
  if (dock) assert(app.getBoundingClientRect().bottom - dock.bottom >= 84, "Dock overlaps host toolbar");
}
async function jump(index: number) {
  await click("exam-sheet");
  measure();
  await click("exam-move", String(index));
  measure();
}
async function main() {
  await open();
  await click("nav-exam");
  assert(app.querySelectorAll('[data-action="exam-open"]').length === 4, "Four playable papers required");
  measure();
  if (params.has("preview")) {
    if (params.get("preview") === "question") {
      await click("exam-open", "real-2026-6-30");
      await jump(121);
      await click("exam-select", "F");
    }
    document.body.dataset.examResult = encodeURIComponent(JSON.stringify({ status: "PREVIEW" }));
    return;
  }
  for (const paper of EMBEDDED_EXAM_PAPERS) {
    await click("exam-open", paper.id);
    assert(!app.textContent?.includes("参考答案："), "Answers leaked before submission");
    await jump(169);
    const question = bank.byId.get(paper.items[169]!.questionId)!;
    for (const key of question.answers) await click("exam-select", key);
    assert(saved.exams?.[paper.id]?.index === 169, "Position not persisted");
    await open();
    await click("nav-exam");
    await click("exam-open", paper.id);
    assert(app.textContent?.includes("第 170 / 170 题"), "Restart did not resume");
    assert(app.querySelector('[aria-pressed="true"]'), "Restart lost selection");
    await click("exam-sheet");
    await click("exam-confirm");
    assert(app.textContent?.includes("169 题未作答"), "Submission warning incorrect");
    await click("exam-submit");
    assert(saved.exams?.[paper.id]?.score === 0.5, "Incorrect score");
    await click("exam-sheet");
    await click("exam-move", "169");
    assert(app.textContent?.includes("参考答案："), "Review missing answers");
    assert(!app.querySelector('[data-action="exam-select"]'), "Submitted answers editable");
    await click("nav-exam");
    checks.push(`${paper.id}: start, last question, selection, reload, submit, review`);
  }
  // Restart confirmation; six-option multiple answer; failed storage must be retryable.
  await click("exam-restart", "real-2026-6-30");
  await click("exam-start-again");
  await jump(121);
  assert(app.querySelectorAll('[data-action="exam-select"]').length === 6, "Option F missing");
  for (const key of ["A", "B", "E", "F"]) await click("exam-select", key);
  measure();
  await click("exam-sheet");
  await click("exam-confirm");
  const historyBefore = saved.history.length;
  failSave = true;
  await click("exam-submit");
  assert(saved.history.length === historyBefore && saved.exams?.["real-2026-6-30"]?.submittedAt === undefined, "Failed save modified study data");
  failSave = false;
  await click("exam-submit");
  assert(saved.exams?.["real-2026-6-30"]?.score === 1, "ABEF not graded correctly");
  assert(saved.history.length === historyBefore + 1, "Duplicate submission statistics");
  checks.push("ABEF multi-select, restart, storage failure/retry, exactly-once grading");
  await click("nav-exam");
  await click("exam-restart", "real-2026-6-26-A");
  await click("exam-start-again");
  const attempt = saved.exams!["real-2026-6-26-A"]!;
  saved = { ...saved, exams: { ...saved.exams, [attempt.paperId]: { ...attempt, startedAt: Date.now() - 8_000_000, deadlineAt: Date.now() - 1 } } };
  await click("exam-select", "A");
  assert(saved.exams?.[attempt.paperId]?.submittedAt !== undefined, "Expired session not submitted");
  assert(saved.exams?.[attempt.paperId]?.answeredCount === 0, "Late answer accepted");
  checks.push("Expired session submits before accepting another answer");
  // Newly unclassified questions must be reachable from Statistics > Mistakes.
  const unclassified = bank.questions.find((q) => q.domain === "未归类")!;
  saved = recordAnswer(saved, unclassified.id, false, new Date().toISOString()).data;
  await click("nav-exam");
  await click("nav-stats");
  assert(app.textContent?.includes("近期真题成绩"), "Exam results missing in statistics");
  await click("open-wrongbook");
  await click("start-wrong-domain", "未归类");
  assert(app.textContent?.includes(unclassified.stem), "Unclassified mistakes unreachable");
  measure();
  checks.push("Statistics and unclassified mistake practice reachable");
  document.body.dataset.examResult = encodeURIComponent(JSON.stringify({ status: "PASS", width: app.clientWidth, checks }));
}
void main().catch((error: unknown) => {
  document.body.dataset.examResult = encodeURIComponent(JSON.stringify({ status: "FAIL", message: error instanceof Error ? error.message : String(error) }));
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((path): path is string => Boolean(path && existsSync(path)));
let directory = "";

const obsidianStub = String.raw`
globalThis.createEl = tag => document.createElement(tag);
Object.defineProperty(HTMLElement.prototype,"win",{get:()=>window});
HTMLElement.prototype.empty=function(){this.replaceChildren();};
HTMLElement.prototype.createDiv=function(options={}){const node=document.createElement("div");node.className=options.cls||"";this.appendChild(node);return node;};
export class ItemView {
  constructor(leaf){this.contentEl=leaf.root;this.containerEl=leaf.root;this.app={vault:{getAbstractFileByPath:()=>null}};this.disposers=[];}
  registerDomEvent(node,type,callback){node.addEventListener(type,callback);this.disposers.push(()=>node.removeEventListener(type,callback));}
  registerInterval(id){this.disposers.push(()=>clearInterval(id));}
  destroy(){this.disposers.forEach(dispose=>dispose());}
}
export class Notice {constructor(message){document.body.dataset.notice=message;}}
export function setIcon(node){node.textContent="◇";}
`;

const browserScenario = String.raw`
import { YijiView } from "./src/ui/yiji-view";
import { buildQuestionBankFromQuestions } from "./src/data/question-bank";
import { ACTIVE_CONTENT_PACKAGE } from "./src/content/content-package";
import { commitQuestion, createLibrary, createBank, getActiveQuestions, getBank, getBankStudyData, getLearningEvidence, getReviewQueue, markReviewAgain, recordAnswerEvent, recordStudyTransition, restoreBankAsCopy, setReviewEnabled } from "./src/library";

const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const settle=()=>new Promise(resolve=>setTimeout(resolve,10));
const calls=[];
const views=[];
let state=createBank(createLibrary("browser-device"),"原题库",{id:"bank-a"});
const base={type:"multiple",stem:"原版本题干：选择甲和丙",options:[{key:"A",text:"甲"},{key:"B",text:"乙"},{key:"C",text:"丙"}],answers:["A","C"],domain:"基础",explanation:"提交后才能看到的解析"};
const added=commitQuestion(state,base);
state=added.state;
const firstId=added.questionId;
const originalRevision=getBank(state).questions[firstId].activeRevisionId;
const currentRevision=id=>{const question=getBank(state).questions[id];return question?.revisions[question.activeRevisionId];};
const plugin={
  getStudyData:()=>getBankStudyData(state),
  getQuestionBank:async()=>buildQuestionBankFromQuestions(getActiveQuestions(state)),
  getQuestionBankSnapshot:()=>{const bank=buildQuestionBankFromQuestions(getActiveQuestions(state));return{bank,bankId:state.activeBankId,revisions:new Map(bank.questions.map(question=>[question.id,currentRevision(question.id)]))};},
  getContentPackage:()=>({...ACTIVE_CONTENT_PACKAGE,id:state.activeBankId,name:getBank(state).name,knowledgeRoot:"",domains:["基础"],exam:{...ACTIVE_CONTENT_PACKAGE.exam,papers:[]}}),
  getActiveBankId:()=>state.activeBankId,
  getQuestionRevision:currentRevision,
  getQuestionImages:()=>[],
  getExamPapers:()=>[],
  getExamHistory:()=>[],
  clearExamHistorySelection:()=>undefined,
  getLearningEvidence:()=>getLearningEvidence(state),
  getReviewIds:()=>getReviewQueue(state).map(entry=>entry.questionId),
  isReviewEnabled:()=>getBank(state).reviewEnabled,
  openManager:()=>undefined,
  markGuessed:async id=>{state=markReviewAgain(state,id);},
  persistStudyData:async next=>{state=recordStudyTransition(state,getBankStudyData(state),next);},
  submitPracticeAnswer:async(id,expectedRevision,selected,context)=>{
    calls.push({bankId:state.activeBankId,id,expectedRevision,selected:[...selected],context});
    const revision=currentRevision(id);
    assert(revision.id===expectedRevision,"View submitted a stale revision to the host");
    const previous=getBankStudyData(state).questions[id];
    const correct=selected.length===revision.answers.length && selected.every(key=>revision.answers.includes(key));
    state=recordAnswerEvent(state,id,correct,{revisionId:expectedRevision,selected,context});
    return correct ? previous?.isWrong ? "removed" : "correct" : previous?.isWrong ? "kept" : "added";
  }
};
async function open(id){const root=document.createElement("main");root.id=id;document.body.appendChild(root);const view=new YijiView({root},plugin);views.push(view);await view.onOpen();return{root,view};}
async function click(root,action,value){const node=Array.from(root.querySelectorAll('[data-action="'+action+'"]')).find(node=>value===undefined || node.dataset.value===value);assert(node && !node.disabled,"Missing enabled action "+action+"/"+value);node.click();await settle();}
const selectedCount=root=>root.querySelectorAll('[data-action="select-option"][aria-pressed="true"]').length;
const answers=()=>Object.values(state.events).filter(event=>event.kind==="answer");

async function ordinary(){
  const {root}=await open("first-view");
  await click(root,"start-domain","基础");
  assert(root.textContent.includes(base.stem),"Original question did not render");
  assert(!root.textContent.includes(base.explanation),"Explanation leaked before submission");
  await click(root,"select-option","C");await click(root,"select-option","A");await click(root,"submit-answer");
  assert(calls.length===1,"One click must save exactly one answer");
  const call=calls[0];const event=answers()[0];
  assert(call.expectedRevision===originalRevision && call.context==="practice","Practice lost displayed revision or context");
  assert(call.selected.join(",")==="C,A" && event.selected.join(",")==="C,A","Actual selected options were not saved");
  assert(event.revisionId===originalRevision && event.correct===true,"Persisted result disagrees with shown version");
  assert(getBankStudyData(state).questions[firstId].attempts===1,"Practice count incorrect");
  assert(root.textContent.includes("回答正确") && root.textContent.includes(base.explanation),"Feedback did not show saved result and explanation");
}
async function revision(){
  const first=await open("first-view");await click(first.root,"start-domain","基础");await click(first.root,"select-option","A");
  const changed=commitQuestion(state,{...base,stem:"第二个视图采用的新题干",answers:["B"]},{questionId:firstId,reason:"对照原件修正答案"});
  assert(!changed.issues.length,"Revision fixture is invalid");state=changed.state;
  const second=await open("second-view");await click(second.root,"start-domain","基础");
  assert(second.root.textContent.includes("第二个视图采用的新题干"),"Second view did not see new revision");
  assert(first.root.textContent.includes(base.stem),"Old view was unexpectedly refreshed before interaction");
  await click(first.root,"select-option","C");
  assert(calls.length===0 && answers().length===0,"A stale displayed question caused an answer save");
  assert(first.root.textContent.includes("第二个视图采用的新题干"),"Stale view did not refresh its question");
  assert(selectedCount(first.root)===0,"Old selections survived a content revision");
  assert(document.body.dataset.notice.includes("已更新"),"Revision change did not explain recovery");
  await click(first.root,"select-option","B");await click(first.root,"submit-answer");
  assert(calls.length===1 && calls[0].expectedRevision===changed.revisionId,"New text did not submit its own revision");
  assert(calls[0].expectedRevision!==originalRevision && answers()[0].correct===true,"Old answer was used after revision");
}
async function bank(){
  const first=await open("first-view");await click(first.root,"start-domain","基础");await click(first.root,"select-option","A");
  state=restoreBankAsCopy(state,state,"bank-a",{id:"bank-b",name:"内容副本"});
  assert(currentRevision(firstId).id===originalRevision,"Copy must preserve question and revision IDs to exercise the bank guard");
  const second=await open("second-view");assert(second.root.textContent.includes("内容副本"),"Second view did not select the copied bank");
  await click(first.root,"submit-answer");
  assert(calls.length===0 && answers().length===0,"Stale view wrote into another bank");
  assert(first.root.textContent.includes("内容副本") && !first.root.querySelector('[data-action="submit-answer"]'),"Bank switch did not return stale view to refreshed home");
  await click(first.root,"start-domain","基础");await click(first.root,"select-option","A");await click(first.root,"select-option","C");await click(first.root,"submit-answer");
  assert(calls.length===1 && calls[0].bankId==="bank-b","Fresh copied-bank practice was not recorded in its bank");
  assert(!getBankStudyData(state,"bank-a").questions[firstId]?.attempts && getBankStudyData(state,"bank-b").questions[firstId].attempts===1,"Learning leaked across bank identities");
}
async function review(){
  for(let index=2;index<=12;index++)state=commitQuestion(state,{...base,stem:"巩固题 "+index}).state;
  state=setReviewEnabled(state,true);
  const old=new Date(Date.now()-2*86400000).toISOString();
  for(const id of Object.keys(getBank(state).questions))state=recordAnswerEvent(state,id,false,{selected:["B"],context:"practice",now:old});
  assert(plugin.getReviewIds().length===12,"Review fixture must begin with 12 due questions");
  const before=answers().length;const {root}=await open("first-view");await click(root,"start-review");await click(root,"review-begin","10");
  for(let index=1;index<=10;index++){
    const position=root.querySelector(".yiji-question-position strong")?.textContent;
    assert(position===index+" / 10","Review position does not match the selected round size: "+position);
    await click(root,"select-option","A");await click(root,"select-option","C");await click(root,"submit-answer");
    assert(calls.length===index,"Review submitted an extra or missing answer");await click(root,"next-question");
  }
  assert(calls.length===10 && new Set(calls.map(call=>call.id)).size===10,"Review repeated questions inside this round");
  assert(calls.every(call=>call.context==="review"),"Review was recorded as ordinary practice");
  assert(answers().length===before+10,"Review count includes phantom answers");
  assert(!root.querySelector('[data-action="submit-answer"]') && !root.querySelector('[data-action="next-question"]'),"Review loops beyond its selected size");
  assert(document.body.dataset.notice==="本轮 10 道巩固题已完成。","Review round lacks a clear completion state");
  assert(plugin.getReviewIds().length===2 && root.textContent.includes("2 题待复查"),"Unselected due questions were lost or replayed");
}
const scenarios={ordinary,revision,bank,review};
const scenario=new URL(location.href).searchParams.get("scenario");
Promise.resolve().then(()=>scenarios[scenario]()).then(()=>{
  views.forEach(view=>view.destroy());
  document.body.dataset.studyResult=encodeURIComponent(JSON.stringify({status:"PASS",scenario,submissions:calls.length}));
}).catch(error=>{
  views.forEach(view=>view.destroy());
  document.body.dataset.studyResult=encodeURIComponent(JSON.stringify({status:"FAIL",scenario,message:error.message,stack:error.stack}));
});
`;

describe.skipIf(!chrome)("study view in Chromium (simulated Obsidian host)", () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "yiji-study-ui-"));
    await build({ stdin: { contents: browserScenario, resolveDir: resolve("."), loader: "ts" }, bundle: true, format: "iife", outfile: join(directory, "app.js"),
      plugins: [{ name: "obsidian-test-host", setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "study-host" }));
        builder.onLoad({ filter: /.*/, namespace: "study-host" }, () => ({ contents: obsidianStub, loader: "js" }));
      } }] });
    const styles = await readFile(resolve("styles-base.css"), "utf8");
    await writeFile(join(directory, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0}main{width:440px;height:900px;display:inline-block;vertical-align:top}${styles}</style><body><script>window.addEventListener("error",event=>{document.body.dataset.studyResult=encodeURIComponent(JSON.stringify({status:"FAIL",message:event.message}));});</script><script src="app.js"></script></body></html>`);
  });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it.each([
    ["ordinary", "saves the selected options, displayed revision and practice context"],
    ["revision", "refreshes a stale question before any answer can use the new revision"],
    ["bank", "refreshes a stale bank even when the copied question and revision IDs match"],
    ["review", "finishes a selected ten-question review round without looping"],
  ])("%s: %s", (scenario) => {
    const output = execFileSync(chrome!, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--disable-background-networking", "--disable-component-update", "--disable-sync", "--window-size=1000,1000",
      `--user-data-dir=${join(directory, `profile-${scenario}`)}`, "--virtual-time-budget=7000", "--dump-dom",
      `${pathToFileURL(join(directory, "index.html")).href}?scenario=${scenario}`],
    { encoding: "utf8", timeout: 45000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    const raw = output.match(/data-study-result="([^"]+)"/)?.[1];
    expect(raw, `Browser did not finish ${scenario}`).toBeTruthy();
    const report = JSON.parse(decodeURIComponent(raw!)) as { status: string; message?: string; stack?: string };
    expect(report.status, `${report.message ?? ""}\n${report.stack ?? ""}`).toBe("PASS");
  }, 50000);
});

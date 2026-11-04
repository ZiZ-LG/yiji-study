import { afterAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"]
  .find((path): path is string => Boolean(path && existsSync(path)));
const directories: string[] = [];
afterAll(async () => {
  if (process.env.YIJI_MANAGER_KEEP_UI !== "1") await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

const browserScenario = String.raw`
import { LibraryManager } from "./src/ui/library-manager";
import { createLibrary, createBank, renameBank, commitQuestion, getBank, getBankStudyData, recordAnswerEvent, setReviewEnabled, markReviewAgain, stageCandidates, updateCandidate, acceptCandidate, validateQuestion } from "./src/library";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const findButton = (text) => Array.from(document.querySelectorAll("button")).find(node => node.textContent === text);
const click = async (text) => { const button = findButton(text); assert(button, "Missing button: " + text); assert(button.getBoundingClientRect().height>0,"Hidden button: " + text); assert(!button.disabled, "Disabled button: " + text); button.click(); await settle(); };
const label = (text) => Array.from(document.querySelectorAll("label")).find(node => node.querySelector("span")?.textContent === text);
const fill = (text, value) => { const input = label(text)?.querySelector("input,textarea,select"); assert(input, "Missing field: " + text); input.value = value; input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true })); };
const check = async (text) => { const input = label(text)?.querySelector("input"); assert(input, "Missing checkbox: " + text); input.click(); await settle(); };
const openSummary = async (text) => { const summary = Array.from(document.querySelectorAll("summary")).find(node => node.textContent.includes(text)); assert(summary, "Missing details: " + text); if (!summary.parentElement.open) summary.click(); await settle(); };
const commands = [];
let state = createLibrary("ui-test-device");
const base = { type: "single", stem: "普通导入题", options: [{key:"A",text:"选项一"},{key:"B",text:"选项二"}], answers:["A"], domain:"基础", sources:[{file:"sample.txt",ordinal:"1"}] };
const snapshot = () => ({ library: state, ai: {mode:"codex",endpoint:"",model:"",keyConfigured:false,supportsImages:false}, importSources: state.activeBankId ? [{ id:"source1", name:"sample.txt", path:"sample.txt", kind:"text", pageCount:2, textPreview:"", issues:[], units:[{id:"u1",locator:"第 1 段",textPreview:"仅发送此段"},{id:"u2",locator:"第 2 段",textPreview:"不发送此段"}] }] : [] });
const host = {
  async getSnapshot() { return snapshot(); },
  async execute(command) {
    commands.push(command);
    if (command.type === "create-bank") state = createBank(state, command.name);
    else if (command.type === "rename-bank") state = renameBank(state,command.bankId,command.name);
    else if (command.type === "rename-domain") for (const question of Object.values(getBank(state).questions)) {
      const revision=question.revisions[question.activeRevisionId];
      if(revision.domain===command.from){const result=commitQuestion(state,{...revision,domain:command.to},{bankId:command.bankId,questionId:question.id,allowSeparate:true,reason:"更改知识点名称"}); if(result.issues.length)throw new Error(result.issues.join(";")); state=result.state;}
    }
    else if (command.type === "set-review") state=setReviewEnabled(state,command.enabled,command.bankId);
    else if (command.type === "reset-review") for(const id of command.questionIds) state=markReviewAgain(state,id,{bankId:command.bankId});
    else if (command.type === "save-question") { const result = commitQuestion(state, command.input, command.options); if(result.issues.length) throw new Error(result.issues.join(";")); state=result.state; }
    else if (command.type === "stage-text") state = stageCandidates(state,[base,{...base,stem:"缺答案题",answers:[],sources:[{file:"sample.txt",ordinal:"2"}]}],{batchId:"sample-batch",bankId:command.bankId,issues:[[],["缺少答案"]]});
    else if (command.type === "commit-normal-candidates") for(const id of command.candidateIds) { const candidate = getBank(state).candidates[id]; assert(!candidate.issues.length,"High-risk candidate entered bulk approval"); const result=acceptCandidate(state,id,{bankId:command.bankId}); if(result.issues.length)throw new Error(result.issues.join(";")); state=result.state; }
    else if (command.type === "commit-candidate") { const issues=validateQuestion(command.input,getBank(state)); state=updateCandidate(state,command.candidateId,command.input,issues,command.bankId); const result=acceptCandidate(state,command.candidateId,{bankId:command.bankId,resolveConflict:command.resolveConflict}); if(result.issues.length)throw new Error(result.issues.join(";")); state=result.state; }
    return {message:"已保存",snapshot:snapshot()};
  }
};

(async () => {
  const requestedWidth = Number(new URL(location.href).searchParams.get("width")) || window.innerWidth;
  document.body.style.width = requestedWidth + "px";
  const modal = new LibraryManager({},host); modal.open(); await settle();
  fill("新题库名称","通用考试样本"); await click("新建题库");
  assert(getBank(state).name === "通用考试样本","Create bank did not persist");
  await click("手工新增");
  const stem = '<img src=x onerror="window.__unsafe=true"> 应作为题干文字';
  fill("题干",stem); fill("选项（每行一个，例如 A. 选项内容）","A. 正确选项\nB. 另一个选项".replace(/\\n/g,"\n"));
  fill("采用答案（选项编号，多个用逗号分开）","A"); fill("知识点／章节","第一章");
  await click("返回题目目录"); await click("导入核对"); await click("题目"); await click("手工新增");
  assert(label("题干").querySelector("textarea").value === stem,"Unsaved form lost on tab switch");
  await click("保存题目");
  assert(Object.keys(getBank(state).questions).length === 1,"Manual question not saved");
  assert(!window.__unsafe && !document.querySelector("img"),"Question text executed as HTML");
  await click("手工新增"); fill("题型","judge"); fill("题干","判断题必须可以手工创建"); fill("采用答案（选项编号，多个用逗号分开）","对");
  await click("保存题目"); assert(Object.keys(getBank(state).questions).length === 2,"Judge authoring failed");
  const learnedId=Object.keys(getBank(state).questions)[0]; state=recordAnswerEvent(state,learnedId,true,{selected:["A"]});
  await click("导入核对"); await openSummary("粘贴文本或结构化题库"); fill("题库内容","sample"); await click("本地解析并预览");
  await check("选中普通题（1 道）"); await click("确认所选普通题入库");
  assert(Object.values(getBank(state).candidates).filter(c=>c.status==="pending").length===1,"Bulk approval included blocked candidate");
  const risky = Array.from(document.querySelectorAll("button")).find(node => node.classList.contains("is-row") && node.textContent.includes("缺答案题")); risky.click(); await settle();
  assert(findButton("确认这一题入库").disabled,"Risky candidate accepted without explicit review");
  fill("采用答案（选项编号，多个用逗号分开）","A"); await check("我已对照来源逐项处理上述问题，并确认采用当前答案"); await click("确认这一题入库");
  assert(Object.values(getBank(state).candidates).every(c=>c.status!=="pending"),"Reviewed candidate did not save");
  await openSummary("sample.txt"); await check("第 1 段");
  assert(findButton("导出 Codex 整理任务").disabled,"AI task exported before scope confirmation");
  await check("我确认将选中资料包含在导出的 Codex 任务中"); await click("导出 Codex 整理任务");
  const exported = commands.find(command=>command.type==="export-codex");
  assert(exported.scope.unitIds.length===1 && exported.scope.unitIds[0]==="u1","Unselected source unit leaked into task");
  await click("设置备份"); fill("题库名称","已重命名的考试题库"); await click("保存题库名称");
  assert(getBank(state).name==="已重命名的考试题库","Rename bank did not persist");
  const fullSources=label("包含原始来源资料（完整备份必需）").querySelector("input");
  assert(fullSources.checked && fullSources.disabled,"Full backup presents source inclusion as optional");
  await check("包含学习记录（完整备份）");
  assert(!label("包含原始来源资料").querySelector("input").disabled,"Content export cannot choose source inclusion");
  await check("包含原始来源资料"); await click("导出题库内容");
  const contentExport=commands.filter(command=>command.type==="export-backup").at(-1);
  assert(contentExport.includeHistory===false && contentExport.includeSources===false,"Content export ignored source opt-out");
  await check("包含学习记录（完整备份）");
  const requiredSources=label("包含原始来源资料（完整备份必需）").querySelector("input");
  assert(requiredSources.checked && requiredSources.disabled,"Switching back to full backup retained misleading source opt-out");
  await click("保存完整备份");
  const fullExport=commands.filter(command=>command.type==="export-backup").at(-1);
  assert(fullExport.includeHistory===true && fullExport.includeSources===true,"Full backup command did not match its displayed scope");
  const originalLearningKey=getBank(state).questions[learnedId].revisions[getBank(state).questions[learnedId].activeRevisionId].learningKey;
  await openSummary("知识点分类"); fill("要改名的知识点","第一章"); fill("新的知识点名称","基本概念");
  await check("确认修改该分类下的 1 道题的知识点名称"); await click("确认更新知识点名称");
  const updatedRevision=getBank(state).questions[learnedId].revisions[getBank(state).questions[learnedId].activeRevisionId];
  assert(updatedRevision.domain==="基本概念" && updatedRevision.learningKey===originalLearningKey,"Classification rename changed learning identity");
  await openSummary("删除此题库");
  assert(findButton("确认删除此题库").disabled,"Delete enabled before confirmation");
  fill("输入题库名称以确认删除","错误的题库名"); await check("我已核对删除范围，理解原始资料和已有备份不会自动清除");
  assert(findButton("确认删除此题库").disabled,"Delete enabled for mismatching bank name");
  fill("输入题库名称以确认删除","已重命名的考试题库");
  assert(!findButton("确认删除此题库").disabled,"Delete stays inaccessible after exact-name confirmation");
  await click("巩固"); await check("为“已重命名的考试题库”开启巩固复习"); await check("选择全部已作答且可用的题目");
  await openSummary("重新安排所选题目的复习");
  assert(findButton("确认重设所选题目").disabled,"Review reset skipped confirmation");
  const attemptsBefore=getBankStudyData(state).questions[learnedId].attempts;
  await check("我确认把所选题目的巩固安排重设为 24 小时后"); await click("确认重设所选题目");
  assert(getBankStudyData(state).questions[learnedId].attempts===attemptsBefore,"Review reset fabricated an answer");
  const root = document.querySelector(".modal");
  assert(root.scrollWidth <= root.clientWidth + 2,"Manager has horizontal overflow");
  assert(Array.from(document.querySelectorAll("button")).filter(node=>node.getBoundingClientRect().width>0).every(node=>node.getBoundingClientRect().height>=44),"Touch target is smaller than 44px");
  assert(root.clientWidth <= requestedWidth,"Test host failed to constrain content width");
  await click("题目");
  const savedRow = Array.from(document.querySelectorAll("button")).find(node => node.classList.contains("is-row") && node.textContent.includes("判断题必须")); savedRow.click(); await settle();
  document.body.dataset.managerResult = JSON.stringify({status:"PASS",width:root.clientWidth,questions:Object.keys(getBank(state).questions).length,commands:commands.length});
})().catch(error=>{document.body.dataset.managerResult=JSON.stringify({status:"FAIL",message:error.message,stack:error.stack});});
`;

const obsidianStub = String.raw`
globalThis.createEl = (tag) => document.createElement(tag);
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
export class App {}
export class Modal {
  constructor(app) {
    this.app=app;
    this.modalEl=document.createElement("div"); this.modalEl.className="modal";
    this.titleEl=document.createElement("h1");
    this.contentEl=document.createElement("div"); this.contentEl.className="modal-content";
    this.modalEl.append(this.titleEl,this.contentEl); document.body.append(this.modalEl);
  }
  open(){this.onOpen();}
  close(){this.onClose();this.modalEl.remove();}
}
`;

describe.skipIf(!chrome)("management UI in Chromium (simulated Obsidian host)", () => {
  it("preserves authoring, separates risky review, and sends only selected units on desktop and narrow mobile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yiji-manager-ui-")); directories.push(directory);
    await build({ stdin: { contents: browserScenario, resolveDir: resolve("."), loader: "ts" }, bundle: true, format: "iife", outfile: join(directory,"app.js"),
      plugins: [{name:"obsidian-test-host",setup(builder) {
        builder.onResolve({filter:/^obsidian$/},()=>({path:"obsidian",namespace:"test-host"}));
        builder.onLoad({filter:/.*/,namespace:"test-host"},()=>({contents:obsidianStub,loader:"js"}));
      }}] });
    const styles = await readFile(resolve("styles-manager.css"),"utf8");
    await writeFile(join(directory,"index.html"),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#0b1117}.modal{margin:0 auto}.modal-content{max-height:calc(94vh - 110px);overflow-y:auto}${styles}</style><body><script src="app.js"></script></body></html>`);
    for (const width of [320,1100]) {
      const screenshot = process.env.YIJI_MANAGER_KEEP_UI === "1" ? [`--screenshot=${join(directory,`manager-${width}.png`)}`] : [];
      const output = execFileSync(chrome!,["--headless=new","--no-sandbox","--disable-gpu","--no-first-run","--no-default-browser-check","--disable-background-networking","--disable-component-update","--disable-sync",`--window-size=${width},900`,`--user-data-dir=${join(directory,`profile-${width}`)}`,"--virtual-time-budget=7000",...screenshot,"--dump-dom",`${pathToFileURL(join(directory,"index.html")).href}?width=${width}`],{encoding:"utf8",timeout:45000,maxBuffer:4*1024*1024,stdio:["ignore","pipe","pipe"]});
      const raw = output.match(/data-manager-result="([^"]+)"/)?.[1];
      expect(raw,"Browser did not finish the management workflow").toBeTruthy();
      const report = JSON.parse(raw!.replaceAll("&quot;",'"').replaceAll("&amp;","&")) as {status:string;message?:string};
      expect(report.status,report.message).toBe("PASS");
    }
    if (process.env.YIJI_MANAGER_KEEP_UI === "1") console.log(`Manager UI screenshots: ${directory}`);
  },100_000);
});

// Optional local regression using a separately supplied PDF.js runtime and synthetic PDF.
// The runtime is never downloaded or added to the distributable plugin.
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { build } from "esbuild";

const runtime = process.env.YIJI_REAL_PDFJS_DIR;
if (!runtime) throw new Error("Set YIJI_REAL_PDFJS_DIR to a local directory containing pdf.min.mjs and pdf.worker.min.mjs.");
const fixture = await fs.readFile(process.env.YIJI_REAL_PDF_FIXTURE ?? ".artifacts/acceptance-materials/计算机基础-50页200题.pdf");
const directory = path.resolve(".artifacts/real-pdf-import");
await fs.mkdir(directory, { recursive: true });
const app = await build({ stdin: { resolveDir: process.cwd(), loader: "ts", contents: `
import * as pdfjs from "/runtime/pdf.min.mjs";
import {extractDocument,parseDocumentCandidates} from "./src/import/index";
window.activeWindow=window; window.activeDocument=document;
pdfjs.GlobalWorkerOptions.workerSrc='/runtime/pdf.worker.min.mjs';
window.report={ready:true};
window.run=async()=>{
 const start=performance.now(); const stages=[]; window.report={version:pdfjs.version,ready:true,stage:'load',completed:0,animationFramesSuspended:true,stages};
 // Simulate the scheduling condition; this is not a claim about mobile lifecycle.
 window.requestAnimationFrame=()=>0;
 try {
  const bytes=new Uint8Array(await(await fetch('/fixture.pdf')).arrayBuffer());
  const source=await extractDocument({name:'synthetic-50-pages.pdf',bytes},{pdf:pdfjs,createCanvas:()=>document.createElement('canvas'),renderTimeoutMs:2000,
   onStage(status){window.report.stage=status.phase;stages.push({...status,elapsed:Math.round(performance.now()-start)});},
   onProgress(completed,total){window.report.completed=completed;window.report.selectedPages=total;}});
  const parsed=parseDocumentCandidates(source);
  Object.assign(window.report,{done:true,elapsed:Math.round(performance.now()-start),pages:source.units.length,images:source.attachments.length,questions:parsed.candidates.length,
   blockingQuestions:parsed.candidates.filter(q=>q.issues.some(issue=>issue.blocking)).length,previewWarning:source.warnings.find(w=>w.includes('批注或图层'))});
 }catch(error){window.report.error=String(error);}
};` }, bundle: true, write: false, platform: "browser", format: "esm", target: "es2021", external: ["/runtime/pdf.min.mjs"] });
const files = new Map([
  ["/", { body: '<!doctype html><meta charset="utf-8"><script type="module" src="/app.js"></script>', mime: "text/html" }],
  ["/app.js", { body: app.outputFiles[0].text, mime: "text/javascript" }],
  ["/fixture.pdf", { body: fixture, mime: "application/pdf" }],
  ...await Promise.all(["pdf.min.mjs", "pdf.worker.min.mjs"].map(async (name) => [`/runtime/${name}`, { body: await fs.readFile(path.join(runtime, name)), mime: "text/javascript" }]))
]);
const server = http.createServer((request, response) => {
  const file = files.get(request.url); if (!file) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "content-type": file.mime }); response.end(file.body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const profile = path.join(directory, `chrome-profile-${Date.now()}`);
await fs.mkdir(profile, { recursive: true });
const chrome = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const child = spawn(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/`], { stdio: ["ignore", "ignore", "pipe"] });
let stderr = ""; child.stderr.on("data", (bytes) => { stderr += bytes; });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket; let requestId = 0; const waiting = new Map();
try {
  let debugPort;
  for (let i = 0; i < 50; i++) {
    try { debugPort = Number((await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); break; }
    catch { await sleep(100); }
  }
  if (!debugPort) throw new Error(`Chrome did not start: ${stderr.slice(-1500)}`);
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = (event) => { const value = JSON.parse(event.data); const pending = waiting.get(value.id); if (pending) { waiting.delete(value.id); value.error ? pending.reject(value.error) : pending.resolve(value.result); } };
  const evaluate = async (expression) => (await new Promise((resolve, reject) => { const id = ++requestId; waiting.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } })); })).result.value;
  let ready = false;
  for (let i = 0; i < 50; i++) { ready = await evaluate("Boolean(window.report?.ready)"); if (ready) break; await sleep(100); }
  if (!ready) throw new Error("PDF.js regression page did not initialize.");
  await evaluate("void window.run()");
  let report;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) { await sleep(100); report = await evaluate("window.report"); if (report.done || report.error) break; }
  report.environment = "Production importer in independent headless Chrome using supplied local PDF.js; requestAnimationFrame deliberately suspended, not an actual mobile/background-host acceptance.";
  await fs.writeFile(path.join(directory, "report.json"), JSON.stringify(report, null, 2));
  if (!report.done || report.pages !== 50 || report.images !== 50 || report.questions !== 200 || report.blockingQuestions !== 0) throw new Error(JSON.stringify(report));
  console.log(JSON.stringify({ status: "PASS", version: report.version, pages: report.pages, images: report.images, questions: report.questions, animationFramesSuspended: true, elapsed: report.elapsed, report: path.join(directory, "report.json") }));
} finally { socket?.close(); child.kill("SIGTERM"); server.close(); }

import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

describe("browser document extraction", () => {
  it("uses real DOMParser for DOCX and exercises the injected PDF.js/canvas boundary", async () => {
    const directory = resolve(".artifacts/import-browser");
    await mkdir(directory, { recursive: true });
    await build({
      stdin: {
        resolveDir: process.cwd(), loader: "ts",
        contents: `
import { zipSync, strToU8 } from "fflate";
import { extractDocument } from "./src/import/extract";
import { parseDocumentCandidates } from "./src/import/parse";
async function run() {
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>单选题</w:t></w:r></w:p><w:p><w:r><w:t>1. 选择 A &amp; B 中的</w:t></w:r><w:r><w:t>正确项？</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A. 甲</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B. 乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>答案：A</w:t></w:r></w:p><w:p><w:r><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:r></w:p></w:body></w:document>';
  const docx = zipSync({ 'word/document.xml': strToU8(xml), 'word/_rels/document.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="media/image1.png" Type="image"/></Relationships>'), 'word/media/image1.png': new Uint8Array([137,80,78,71]) });
  const source = await extractDocument({ name: "自制.docx", bytes: docx });
  const parsed = parseDocumentCandidates(source);
  if (source.units[1].text !== '1. 选择 A & B 中的正确项？') throw new Error('Word runs/entities lost');
  if (source.units[2].text !== 'A. 甲\\tB. 乙') throw new Error('Word table column order lost');
  if (source.attachments.length !== 1 || parsed.candidates.length !== 1) throw new Error('Word image/question missing');
  if (parsed.candidates[0].answers[0] !== 'A' || parsed.candidates[0].options.length !== 2) throw new Error('Word answer/options mismatch');
  let destroyed = false;
  const pdfRuntime = { getDocument: () => ({ promise: Promise.resolve({ numPages: 2, destroy: async () => { destroyed = true; }, getPage: async (page) => ({ getTextContent: async () => ({items: page === 1 ? [{str:'文本页',hasEOL:true}] : []}), getViewport: ({scale}) => ({width: 600*scale,height:800*scale}), render: ({canvasContext}) => ({promise: Promise.resolve().then(() => { canvasContext.fillStyle='white';canvasContext.fillRect(0,0,20,20); })}) }) }) }) };
  const pdf = await extractDocument({name:'扫描.pdf',bytes:new Uint8Array([37,80,68,70])},{pdf:pdfRuntime,pages:[2],createCanvas:()=>document.createElement('canvas')});
  if (!destroyed || pdf.totalUnits !== 2 || pdf.omittedUnitIds.length !== 1 || !pdf.units[0].needsRecognition) throw new Error('PDF scope/cleanup mismatch');
  if (!pdf.units[0].imageDataUrl.startsWith('data:image/jpeg;base64,') || pdf.attachments[0].purpose !== 'preview') throw new Error('PDF preview missing');
  if (pdf.units[0].attachmentIds?.length) throw new Error('Whole PDF page should not be auto-attached to scored question');
  return { docxParagraphs:source.units.length,docxQuestions:parsed.candidates.length,docxAttachments:source.attachments.length,pdfSelectedPages:pdf.units.length,pdfOmittedPages:pdf.omittedUnitIds.length };
}
run().then((details)=>document.body.dataset.importResult=encodeURIComponent(JSON.stringify({status:'PASS',...details}))).catch((error)=>document.body.dataset.importResult=encodeURIComponent(JSON.stringify({status:'FAIL',message:error.message})));
`,
      },
      bundle: true, format: "iife", platform: "browser", target: "es2021", outfile: resolve(directory, "app.js"),
    });
    await writeFile(resolve(directory, "index.html"), '<!doctype html><meta charset="utf-8"><title>自制资料导入测试</title><body><script src="app.js"></script></body>');
    const browser = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find((candidate) => candidate && existsSync(candidate));
    expect(browser, "Chrome is required for DOCX browser parsing").toBeTruthy();
    const run = spawnSync(browser!, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--disable-background-networking", "--allow-file-access-from-files", "--virtual-time-budget=4000", "--dump-dom", pathToFileURL(resolve(directory, "index.html")).href], { encoding: "utf8", timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
    expect(run.status, run.stderr).toBe(0);
    const encoded = run.stdout.match(/data-import-result="([^"]+)"/)?.[1];
    expect(encoded, run.stdout.slice(-2000)).toBeTruthy();
    const report = JSON.parse(decodeURIComponent(encoded!)) as { status: string; message?: string; docxQuestions: number; pdfOmittedPages: number };
    expect(report.status, report.message).toBe("PASS");
    expect(report.docxQuestions).toBe(1);
    expect(report.pdfOmittedPages).toBe(1);
  }, 30_000);
});

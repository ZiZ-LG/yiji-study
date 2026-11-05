// Synthetic, deterministic material for the real Obsidian import acceptance flow.
// No source exams or user notes are read by this script.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { zipSync, strToU8 } from "fflate";

const directory = resolve(".artifacts/acceptance-materials");
await mkdir(directory, { recursive: true });
const escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const browser = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find((path) => path && existsSync(path));
if (!browser) throw new Error("Chrome is required to create the PDF acceptance fixtures.");
const run = (args) => {
  const result = spawnSync(browser, ["--headless=new", "--no-sandbox", "--no-first-run", "--disable-gpu", "--disable-background-networking", ...args], { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || "Chrome fixture generation failed.");
};
const print = (name) => run(["--no-pdf-header-footer", `--print-to-pdf=${resolve(directory, `${name}.pdf`)}`, pathToFileURL(resolve(directory, `${name}.html`)).href]);
const head = '<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font:14px Arial,sans-serif;color:#111}pre{font:14px Arial,sans-serif;white-space:pre-wrap;line-height:1.55}section{break-after:page}section:last-child{break-after:auto}</style>';
// Add the image fixture without touching the files already used by desktop QA.
if (process.argv.includes("--image-only")) {
  await createImageFixture();
  console.log(`Image fixture written to ${directory}; existing fixtures were not regenerated.`);
  process.exit(0);
}
const questionText = await readFile("tests/fixtures/custom-paper-source.md", "utf8");
const answerText = await readFile("tests/fixtures/custom-paper-answers.md", "utf8");
const pages = questionText.split(/(?=## 多选题|## 判断题|## 资料异常样本)/);
await writeFile(resolve(directory, "常识A卷.html"), `${head}${pages.map((page) => `<section><pre>${escape(page)}</pre></section>`).join("")}`);
print("常识A卷");
const documentXml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${answerText.split("\n").map((line) => `<w:p><w:r><w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`).join("")}<w:sectPr/></w:body></w:document>`;
const docx = zipSync({
  "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  "word/document.xml": strToU8(documentXml),
});
await writeFile(resolve(directory, "常识A卷-独立答案.docx"), docx);

const capacityQuestions = Array.from({ length: 2000 }, (_, index) => ({
  type: index % 3 === 0 ? "multiple" : index % 3 === 1 ? "single" : "judge",
  stem: `Synthetic computing question ${index + 1}: ${index % 3 === 0 ? "Which values are powers of two?" : index % 3 === 1 ? "How many bits are in one byte?" : "A byte contains eight bits."}`,
  options: index % 3 === 2 ? [{ key: "对", text: "正确" }, { key: "错", text: "错误" }] : [{ key: "A", text: "8" }, { key: "B", text: "12" }, { key: "C", text: "16" }],
  answers: index % 3 === 0 ? ["A", "C"] : index % 3 === 2 ? ["对"] : ["A"], domain: `Computing chapter ${index % 5 + 1}`, answerOrigin: "source",
}));
await writeFile(resolve(directory, "计算机基础-2000题.json"), JSON.stringify({ format: "yiji-import", version: 1, questions: capacityQuestions }, null, 2));
const loadPages = Array.from({ length: 50 }, (_, page) => `<section><h1>Computing practice: page ${page + 1}</h1><pre>${Array.from({ length: 4 }, (_, offset) => {
  const ordinal = page * 4 + offset + 1;
  return `单选题\n${ordinal}. Synthetic computing question ${ordinal}: How many bits are in one byte?\nA. 8\nB. 12\nC. 16\n答案：A\n`;
}).map(escape).join("\n")}</pre></section>`);
await writeFile(resolve(directory, "计算机基础-50页200题.html"), `${head}${loadPages.join("")}`);
print("计算机基础-50页200题");

await writeFile(resolve(directory, "扫描页.html"), '<!doctype html><meta charset="utf-8"><style>body{background:white;font:28px Arial;padding:35px;width:680px;line-height:1.8;color:black}</style><h1>Synthetic computing exam</h1><p>Single choice</p><p>1. How many bits are in one byte?</p><p>A. 8<br>B. 12<br>C. 16</p><p>Answer: A</p><p>This image is test material.</p>');
run(["--hide-scrollbars", "--window-size=800,1000", `--screenshot=${resolve(directory, "计算机基础-扫描页.png")}`, pathToFileURL(resolve(directory, "扫描页.html")).href]);
const png = await readFile(resolve(directory, "计算机基础-扫描页.png"));
await writeFile(resolve(directory, "计算机基础-扫描卷.html"), `${head}<img style="width:100%;height:auto" src="data:image/png;base64,${png.toString("base64")}">`);
print("计算机基础-扫描卷");
await writeFile(resolve(directory, "README.md"), "# 自制验收资料\n\n常识 A 卷含 12 个题号。第 10 题缺答案，第 11 题有冲突答案，第 12 题缺图；这 3 题必须待处理。其余 9 题答案见独立 DOCX。\n\n计算机题库有 2000 道带独立题干编号的题；50 页 PDF 各页 4 题，共 200 题。扫描 PDF 只有图像，不能当空白页跳过。所有资料均由本项目自制，不对应真实考试。\n");
console.log(`Acceptance fixtures written to ${directory}`);
await createImageFixture();

async function createImageFixture() {
  const htmlPath = resolve(directory, "自制两个圆.html");
  const pngPath = resolve(directory, "自制两个圆.png");
  await writeFile(htmlPath, '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:white;width:640px;height:320px;overflow:hidden}body{display:flex;align-items:center;justify-content:center;gap:80px}.circle{box-sizing:border-box;width:120px;height:120px;border:6px solid #111;border-radius:50%}</style><div class="circle"></div><div class="circle"></div>');
  const profile = await mkdtemp(resolve(tmpdir(), "yiji-image-fixture-"));
  try {
    run([`--user-data-dir=${profile}`, "--hide-scrollbars", "--window-size=640,320", "--force-device-scale-factor=1", `--screenshot=${pngPath}`, pathToFileURL(htmlPath).href]);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
  const image = new Uint8Array(await readFile(pngPath));
  const paragraph = (text) => `<w:p><w:r><w:t>${escape(text)}</w:t></w:r></w:p>`;
  const drawing = '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="6096000" cy="3048000"/><wp:docPr id="1" name="自制两个圆"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="自制两个圆.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImage1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6096000" cy="3048000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  const document = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${paragraph("自制题图卷：共 1 题，每题 2 分。仅供插件验收，不对应真实考试。")}${paragraph("单选题")}${paragraph("1. 图中有几个圆？")}${drawing}${["A. 1", "B. 2", "C. 3", "答案：B"].map(paragraph).join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  await writeFile(resolve(directory, "自制题图卷.docx"), zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": strToU8(document),
    "word/_rels/document.xml.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/two-circles.png"/></Relationships>'),
    "word/media/two-circles.png": image,
  }));
}

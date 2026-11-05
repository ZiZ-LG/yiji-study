import { strFromU8, unzipSync } from "fflate";
import { bytesToDataUrl, fingerprint } from "./fingerprint";
import type { DocumentInput, ExtractOptions, ImportIssue, SourceAttachment, SourceDocument, SourceKind, SourceUnit } from "./types";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_XML_BYTES = 12 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const EXTENSIONS: Record<string, SourceKind> = {
  txt: "text", md: "markdown", csv: "csv", json: "json", docx: "docx", pdf: "pdf",
  jpg: "image", jpeg: "image", png: "image",
};

function cancelled(options: ExtractOptions): void {
  if (options.signal?.aborted) throw new Error("整理已取消，已保存的草稿可以稍后继续。");
}

export function identifySourceKind(name: string): SourceKind {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const kind = EXTENSIONS[extension];
  if (!kind) throw new Error("暂不支持此格式。请选择 PDF、DOCX、TXT、Markdown、CSV、JSON、JPG 或 PNG。");
  return kind;
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2));
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { throw new Error("文字编码无法识别，请将文件另存为 UTF-8 后导入。"); }
}

export function extractDocxParts(bytes: Uint8Array): Record<string, Uint8Array> {
  let expanded = 0;
  const parts = unzipSync(bytes, {
    filter(file) {
      const wanted = file.name === "word/document.xml" || file.name === "word/_rels/document.xml.rels"
        || /^word\/media\/[^/]+\.(?:png|jpg|jpeg|gif)$/i.test(file.name);
      if (!wanted) return false;
      const limit = file.name.endsWith(".xml") || file.name.endsWith(".rels") ? MAX_XML_BYTES : 8 * 1024 * 1024;
      expanded += file.originalSize;
      if (file.originalSize > limit || expanded > MAX_EXPANDED_BYTES || file.originalSize < 0) {
        throw new Error("Word 内容解压后过大，请拆分资料后导入。");
      }
      return true;
    },
  });
  if (!parts["word/document.xml"]) throw new Error("此 DOCX 缺少正文，无法读取。");
  return parts;
}

function xmlDocument(xml: string, options: ExtractOptions): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Word 包含不支持的 XML 实体声明，请转换为普通 DOCX 或 PDF。");
  const parsed = options.parseXml ? options.parseXml(xml) : new DOMParser().parseFromString(xml, "application/xml");
  if (parsed.getElementsByTagName("parsererror").length) throw new Error("Word 正文格式损坏，无法读取。");
  return parsed;
}

function descendants(node: Element, localName: string): Element[] {
  return Array.from(node.getElementsByTagNameNS("*", localName));
}

function wordText(node: Element): string {
  let text = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    if (element.localName === "t") text += element.textContent ?? "";
    else if (element.localName === "tab") text += "\t";
    else if (element.localName === "br" || element.localName === "cr") text += "\n";
    else text += wordText(element);
  }
  return text;
}

function extractDocx(input: DocumentInput, source: SourceDocument, options: ExtractOptions): void {
  const parts = extractDocxParts(input.bytes);
  const body = xmlDocument(strFromU8(parts["word/document.xml"]!), options).getElementsByTagNameNS("*", "body")[0];
  if (!body) throw new Error("此 DOCX 的正文为空。");
  const relationshipBytes = parts["word/_rels/document.xml.rels"];
  const relationships = new Map<string, string>();
  if (relationshipBytes) {
    const rels = xmlDocument(strFromU8(relationshipBytes), options).getElementsByTagNameNS("*", "Relationship");
    for (const relation of Array.from(rels)) {
      const id = relation.getAttribute("Id");
      const target = relation.getAttribute("Target");
      if (id && target && !relation.getAttribute("TargetMode") && /^media\/[^/]+$/.test(target)) relationships.set(id, `word/${target}`);
    }
  }
  let paragraph = 0;
  let table = 0;
  for (const block of Array.from(body.children)) {
    cancelled(options);
    if (block.localName !== "p" && block.localName !== "tbl") continue;
    const locator = block.localName === "tbl" ? `表格 ${++table}` : `段落 ${++paragraph}`;
    const text = block.localName === "tbl"
      ? descendants(block, "tr").map((row) => Array.from(row.children).filter((cell) => cell.localName === "tc").map((cell) => descendants(cell, "p").map(wordText).join("\n")).join("\t")).join("\n")
      : wordText(block);
    const attachmentIds: string[] = [];
    const issues: ImportIssue[] = [];
    for (const blip of descendants(block, "blip")) {
      const relationId = Array.from(blip.attributes).find((attribute) => attribute.localName === "embed")?.value;
      const imagePath = relationId ? relationships.get(relationId) : undefined;
      const bytes = imagePath ? parts[imagePath] : undefined;
      if (!bytes || !imagePath) {
        source.warnings.push(`${locator} 有未能读取的图片，相关题目需要核对。`);
        issues.push({ code: "missing-source-image", message: `${locator} 有未能读取的图片，需补齐题图或确认与题目无关。`, blocking: true });
        continue;
      }
      const id = `${source.id}-image-${fingerprint(bytes)}`;
      attachmentIds.push(id);
      if (!source.attachments.some((attachment) => attachment.id === id)) {
        const extension = imagePath.split(".").pop()!.toLowerCase();
        const mimeType = extension === "png" ? "image/png" : extension === "gif" ? "image/gif" : "image/jpeg";
        source.attachments.push({ id, name: imagePath.split("/").pop()!, mimeType, dataUrl: bytesToDataUrl(bytes, mimeType), locator, purpose: "content" });
      }
    }
    if (descendants(block, "oMath").length || descendants(block, "object").length) issues.push({ code: "complex-formula", message: `${locator} 含公式或嵌入对象，需对照原件确认题目完整。`, blocking: true });
    if (descendants(block, "vMerge").length || descendants(block, "gridSpan").length) issues.push({ code: "merged-table", message: `${locator} 含合并单元格，需核对选项和题号的对应关系。`, blocking: true });
    if (text.trim() || attachmentIds.length || issues.length) source.units.push({ id: `${source.id}-u${source.units.length + 1}`, locator, text, attachmentIds, issues });
  }
  source.totalUnits = source.units.length;
  if (!source.units.length) throw new Error("此 DOCX 没有可读取的正文或图片。");
  if (descendants(body, "oMath").length || descendants(body, "object").length) {
    source.warnings.push("资料包含公式或嵌入对象，文字提取可能不完整，请对照 Word 原件核对，必要时改用 PDF。");
  }
}

/** Reconstruct layout without manufacturing spaces between Chinese glyph items. */
export function pdfPageText(items: unknown[]): { text: string; rawText: string } {
  let rawText = "";
  let previous: { text: string; x: number; y: number; width: number; height: number; eol: boolean } | undefined;
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item) || typeof item.str !== "string") continue;
    const transform = "transform" in item && Array.isArray(item.transform) ? item.transform : [];
    const x = Number(transform[4]); const y = Number(transform[5]);
    const height = Math.abs(Number(transform[3])) || ("height" in item ? Number(item.height) : 0) || 12;
    const width = "width" in item ? Number(item.width) : 0;
    const eol = "hasEOL" in item && item.hasEOL === true;
    if (previous && rawText && !rawText.endsWith("\n")) {
      const newLine = Number.isFinite(y) && Number.isFinite(previous.y) && Math.abs(y - previous.y) > Math.max(height, previous.height) * 0.4;
      const gap = x - previous.x - previous.width;
      const latinBoundary = /[A-Za-z0-9]$/.test(previous.text) && /^[A-Za-z0-9]/.test(item.str);
      if (previous.eol || newLine) rawText += "\n";
      else if (latinBoundary && Number.isFinite(gap) && gap > Math.max(height, previous.height) * 0.15 && !/\s$/.test(rawText)) rawText += " ";
    }
    rawText += item.str;
    if (eol) rawText += "\n";
    previous = { text: item.str, x, y, width, height, eol };
  }
  const normalized = rawText.normalize("NFKC");
  const text = normalized.replace(/(\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, "$1").replace(/[ \t]+\n/g, "\n").trim();
  return { text, rawText: rawText.trim() };
}

async function extractPdf(input: DocumentInput, source: SourceDocument, options: ExtractOptions): Promise<void> {
  if (!options.pdf) throw new Error("PDF 读取器尚未就绪，请重试。");
  options.onStage?.({ phase: "load" });
  const task = options.pdf.getDocument({ data: input.bytes.slice(), isEvalSupported: false, useSystemFonts: true });
  const pdf = await task.promise;
  try {
    source.totalUnits = pdf.numPages;
    const range = options.pageRange ?? { from: 1, to: Math.min(pdf.numPages, options.maxPages ?? 50) };
    if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 1 || range.from > pdf.numPages || range.to < range.from) throw new Error("PDF 开始页超出原卷范围，或页码区间无效。");
    const selected = options.pages ? [...new Set(options.pages)].sort((a, b) => a - b)
      : Array.from({ length: Math.min(range.to, pdf.numPages) - range.from + 1 }, (_, i) => range.from + i);
    if (!selected.length || selected.some((page) => !Number.isInteger(page) || page < 1 || page > pdf.numPages)) throw new Error("请选择有效的 PDF 页码范围。");
    if (selected.length > (options.maxPages ?? 50)) throw new Error(`本批最多处理 ${options.maxPages ?? 50} 页，请先选择页码范围。`);
    source.omittedUnitIds = Array.from({ length: pdf.numPages }, (_, i) => i + 1).filter((page) => !selected.includes(page)).map((page) => `${source.id}-p${page}`);
    if (source.omittedUnitIds.length) source.warnings.push(`本次只导入所选 ${selected.length} 页，另有 ${source.omittedUnitIds.length} 页待分批导入。`);
    for (const pageNumber of selected) {
      cancelled(options);
      options.onStage?.({ phase: "text", page: pageNumber, total: pdf.numPages });
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const { text, rawText } = pdfPageText(content.items);
      const unit: SourceUnit = { id: `${source.id}-p${pageNumber}`, locator: `第 ${pageNumber} 页`, page: pageNumber, text, rawText, needsRecognition: text.replace(/\s/g, "").length < 20 };
      if (unit.needsRecognition || options.renderAllPdfPages !== false) {
        const canvas = options.createCanvas?.() ?? createEl("canvas");
        const original = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1400 / Math.max(original.width, original.height));
        const viewport = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("此设备无法绘制 PDF 页面，请先转换为图片或文字。");
        options.onStage?.({ phase: "render", page: pageNumber, total: pdf.numPages });
        // Import produces a static printable preview. Display intent relies on
        // animation frames, which a background Obsidian window may suspend.
        const timeoutMs = options.renderTimeoutMs ?? 60_000;
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("PDF 页面处理超时设置无效。");
        const render = page.render({ canvasContext: context, viewport, intent: "print" });
        let stop: (() => void) | undefined;
        const cancelledRender = new Promise<never>((_resolve, reject) => {
          stop = () => { reject(new Error("PDF 导入已取消，已完成的导入批次保留。")); render.cancel?.(); };
          options.signal?.addEventListener("abort", stop, { once: true });
          if (options.signal?.aborted) stop();
        });
        let timeout: number | undefined;
        try {
          await Promise.race([render.promise, cancelledRender, new Promise<never>((_resolve, reject) => {
            timeout = window.setTimeout(() => {
              reject(new Error(`第 ${pageNumber} 页预览等待超时，已停止本次导入。请对照原文件检查这一页后重试。`)); render.cancel?.();
            }, timeoutMs);
          })]);
          unit.imageDataUrl = canvas.toDataURL("image/jpeg", 0.85);
        } finally {
          if (timeout !== undefined) window.clearTimeout(timeout);
          if (stop) options.signal?.removeEventListener("abort", stop);
          canvas.width = 0;
          canvas.height = 0;
        }
        const id = `${unit.id}-image`;
        source.attachments.push({ id, name: `page-${pageNumber}.jpg`, mimeType: "image/jpeg", dataUrl: unit.imageDataUrl, locator: unit.locator, purpose: "preview" });
      }
      source.units.push(unit);
      page.cleanup?.();
      options.onProgress?.(source.units.length, selected.length);
    }
    if (source.units.some((unit) => unit.needsRecognition)) source.warnings.push("部分页面需要图像识别；AI 处理前请确认所选页码和图像发送范围。");
    source.warnings.push("页面预览可能与原文件的批注或图层不同，请以原件为准。");
    source.warnings.push("PDF 的多栏、跨页题和公式需要对照原页核对；文字提取不代表整卷已还原。");
  } finally { options.onStage?.({ phase: "release" }); await pdf.destroy(); }
}

export async function extractDocument(input: DocumentInput, options: ExtractOptions = {}): Promise<SourceDocument> {
  cancelled(options);
  if (!input.name.trim() || !input.bytes.length) throw new Error("请选择有内容的资料文件。");
  if (input.bytes.length > (options.maxFileBytes ?? MAX_FILE_BYTES)) throw new Error("文件过大，请拆分后导入；默认单文件上限为 50 MB。");
  const hash = fingerprint(input.bytes);
  const kind = identifySourceKind(input.name);
  const source: SourceDocument = {
    id: `source-${hash}`, name: input.name, hash, kind, role: input.role ?? "questions",
    paperTitle: input.paperTitle?.trim() ?? input.name.replace(/\.[^.]+$/, ""), units: [], attachments: [], totalUnits: 0, omittedUnitIds: [], warnings: [],
  };
  if (kind === "pdf") await extractPdf(input, source, options);
  else if (kind === "docx") extractDocx(input, source, options);
  else if (kind === "image") {
    const mimeType = input.name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const header = Array.from(input.bytes.subarray(0, 8));
    if (mimeType === "image/png" ? header.join(",") !== "137,80,78,71,13,10,26,10" : header[0] !== 255 || header[1] !== 216 || header[2] !== 255) throw new Error("图片内容与文件格式不一致，或文件已经损坏。");
    const dataUrl = bytesToDataUrl(input.bytes, mimeType);
    const attachment: SourceAttachment = { id: `${source.id}-image`, name: input.name, mimeType, dataUrl, locator: "图片 1", purpose: "preview" };
    source.attachments.push(attachment);
    source.units.push({ id: `${source.id}-u1`, locator: "图片 1", text: "", imageDataUrl: dataUrl, attachmentIds: [attachment.id], needsRecognition: true });
    source.totalUnits = 1;
  } else {
    const text = decodeText(input.bytes);
    if (!text.trim()) throw new Error("此资料没有可读取的文字。");
    const pages = text.split("\f");
    source.units = pages.map((page, index) => ({ id: `${source.id}-u${index + 1}`, locator: pages.length > 1 ? `文字页 ${index + 1}` : "全文", text: page }));
    source.totalUnits = source.units.length;
  }
  return source;
}

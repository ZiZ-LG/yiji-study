import type { QuestionOption, QuestionType } from "../domain/question";
import { fingerprint } from "./fingerprint";
import type { AnswerEntry, ImportCandidate, ImportIssue, ImportResult, SourceDocument } from "./types";

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : ""; }
function issue(code: string, message: string, blocking = true): ImportIssue { return { code, message, blocking }; }

export function normalizeQuestionType(value: unknown): QuestionType | "unsupported" {
  const normalized = text(value).toLowerCase().replace(/题$/, "");
  if (["single", "单选", "单项选择"].includes(normalized)) return "single";
  if (["multiple", "多选", "多项选择"].includes(normalized)) return "multiple";
  if (["judge", "判断", "truefalse", "true/false"].includes(normalized)) return "judge";
  return "unsupported";
}

export function normalizeAnswers(value: unknown): string[] {
  const values: string[] = Array.isArray(value) ? value.map(text) : [text(value)];
  const answers = values.flatMap((answer) => {
    const cleaned = answer.replace(/^(?:参考)?答案\s*[:：]?\s*/, "").trim();
    if (/^(?:正确|对|是|√|true)$/i.test(cleaned)) return ["对"];
    if (/^(?:错误|错|否|×|false)$/i.test(cleaned)) return ["错"];
    return cleaned.toUpperCase().split(/[\s,，、;；|/]+/).filter(Boolean).flatMap((part) => /^[A-Z]{2,}$/.test(part) ? [...part] : [part]);
  });
  return [...new Set(answers)];
}

export function validateCandidate(candidate: ImportCandidate, availableAttachments?: ReadonlySet<string>): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (candidate.type === "unsupported") issues.push(issue("unsupported-type", "题型暂不支持或尚未确认。"));
  if (!candidate.stem.trim()) issues.push(issue("missing-stem", "缺少题干。"));
  if (candidate.type !== "judge" && candidate.options.length < 2) issues.push(issue("missing-options", "至少需要两个完整选项。"));
  if (candidate.type === "judge" && (candidate.options.length !== 2 || !candidate.options.some((option) => option.key === "对") || !candidate.options.some((option) => option.key === "错"))) issues.push(issue("judge-options", "判断题应使用对／错两个选项，请核对题型。"));
  if (candidate.options.some((option) => !option.key.trim() || !option.text.trim())) issues.push(issue("empty-option", "选项编号或文字为空。"));
  const keys = candidate.options.map((option) => option.key);
  if (new Set(keys).size !== keys.length) issues.push(issue("duplicate-options", "选项编号重复。"));
  if (!candidate.answers.length) issues.push(issue("missing-answer", "原资料缺少答案，需补齐或明确采用候选答案。"));
  if (candidate.answers.some((answer) => !keys.includes(answer))) issues.push(issue("invalid-answer", "答案包含不存在的选项。"));
  if ((candidate.type === "single" || candidate.type === "judge") && candidate.answers.length > 1) issues.push(issue("answer-count", "单选或判断题只能有一个答案。"));
  if (candidate.answerOrigin === "ai") issues.push(issue("ai-answer", "此答案由 AI 建议，需用户逐题核对后采用。"));
  if (availableAttachments && candidate.attachments.some((id) => !availableAttachments.has(id))) issues.push(issue("missing-attachment", "题目所需图片尚未保存。"));
  if (!candidate.domain) issues.push(issue("missing-domain", "尚未分类，可在入库前补充。", false));
  return issues;
}

function normalizeOptions(value: unknown): QuestionOption[] {
  if (Array.isArray(value)) return value.map((option, i) => record(option)
    ? { key: text(option.key).toUpperCase(), text: text(option.text) }
    : { key: String.fromCharCode(65 + i), text: text(option) });
  if (record(value)) return Object.entries(value).map(([key, value]) => ({ key: key.toUpperCase(), text: text(value) }));
  return [];
}

export function candidateFromObject(value: unknown, source: SourceDocument, index: number): ImportCandidate {
  if (!record(value)) throw new Error(`第 ${index + 1} 条题目不是有效对象。`);
  const type = normalizeQuestionType(value.type ?? value.题型);
  let options = normalizeOptions(value.options ?? value.选项);
  if (type === "judge" && !options.length) options = [{ key: "对", text: "正确" }, { key: "错", text: "错误" }];
  const ordinal = text(value.ordinal ?? value.题号) || String(index + 1);
  const explanation = text(value.explanation ?? value.解析);
  const candidate: ImportCandidate = {
    id: "", ordinal, type, stem: text(value.stem ?? value.题干), options,
    answers: normalizeAnswers(value.answers ?? value.answer ?? value.答案), domain: text(value.domain ?? value.知识点),
    explanation, ...(explanation ? { explanationOrigin: "source" as const } : {}), sourceId: source.id,
    sourceUnitIds: Array.isArray(value.sourceUnitIds) ? value.sourceUnitIds.filter((id): id is string => typeof id === "string") : source.units.length === 1 ? [source.units[0]!.id] : [],
    sourceLocator: text(value.sourceLocator) || source.units[0]?.locator || "导入数据",
    paperTitle: text(value.paperTitle) || source.paperTitle,
    answerOrigin: value.answerOrigin === "ai" ? "ai" : value.answerOrigin === "user" ? "user" : "source",
    attachments: Array.isArray(value.attachments) ? value.attachments.filter((item): item is string => typeof item === "string") : [],
    originalText: text(value.originalText), issues: [],
    ...(text(value.answerSourceId) ? { answerSourceId: text(value.answerSourceId), answerSourceLocator: text(value.answerSourceLocator) } : {}),
  };
  if (typeof value.points === "number" && Number.isFinite(value.points) && value.points >= 0) candidate.points = value.points;
  candidate.id = `candidate-${fingerprint(`${source.id}\n${candidate.sourceLocator}\n${ordinal}\n${index}\n${candidate.type}\n${candidate.stem}\n${JSON.stringify(candidate.options)}`)}`;
  candidate.issues = validateCandidate(candidate, new Set(source.attachments.map((attachment) => attachment.id)));
  for (const unit of source.units.filter((item) => candidate.sourceUnitIds.includes(item.id))) candidate.issues.push(...(unit.issues ?? []));
  if (Array.isArray(value.issues)) for (const problem of value.issues) {
    const message = typeof problem === "string" ? problem : record(problem) ? text(problem.message) : "";
    if (message) candidate.issues.push(issue("source-review", message));
  }
  return candidate;
}

export function parseStructuredQuestions(input: string, source: SourceDocument): ImportResult {
  let parsed: unknown;
  try { parsed = JSON.parse(input.replace(/^\uFEFF/, "")); } catch { throw new Error("JSON 格式无效，请检查逗号、引号及完整内容。"); }
  if (record(parsed) && ["yiji-workspace-backup", "yiji-library-backup"].includes(text(parsed.format))) throw new Error("这是易记备份文件，请到设置 → 导出与恢复导入，保留完整题库与学习记录。");
  const values = Array.isArray(parsed) ? parsed : record(parsed) && Array.isArray(parsed.questions) ? parsed.questions : null;
  if (!values) throw new Error("题库 JSON 需要 questions 数组，或直接提供题目数组。");
  if (values.length > 5000) throw new Error("单批最多导入 5,000 道候选题，请拆分文件。");
  return { candidates: values.map((value, index) => candidateFromObject(value, source, index)), warnings: [], unresolvedUnitIds: [] };
}

/** RFC 4180-style quoting; malformed quotes are rejected instead of shifting columns. */
export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else field += char;
      continue;
    }
    if (char === '"') {
      if (field || closedQuote) throw new Error("CSV 引号位置无效，请使用标准 CSV 格式。");
      quoted = true;
    } else if (char === ",") { row.push(field); field = ""; closedQuote = false; }
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field); if (row.some((item) => item.trim())) rows.push(row);
      row = []; field = ""; closedQuote = false;
    } else {
      if (closedQuote && char.trim()) throw new Error("CSV 引号后的内容无效。");
      if (!closedQuote) field += char;
    }
  }
  if (quoted) throw new Error("CSV 引号未闭合。");
  row.push(field); if (row.some((item) => item.trim())) rows.push(row);
  return rows;
}

export function parseCsvQuestions(input: string, source: SourceDocument): ImportResult {
  const rows = parseCsvRows(input.replace(/^\uFEFF/, ""));
  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  if (!headers.some((header) => ["stem", "题干"].includes(header))) throw new Error("CSV 缺少 stem（题干）列。请使用易记题库模板。");
  const candidates = rows.map((row, index) => {
    const value: Record<string, unknown> = Object.fromEntries(headers.map((header, column) => [header, row[column] ?? ""]));
    const options = headers.filter((header) => /^[A-Z]$/.test(header)).map((key) => ({ key, text: text(value[key]) })).filter((option) => option.text);
    if (options.length) value.options = options;
    else if (typeof value.options === "string" && value.options) {
      try { value.options = JSON.parse(value.options); } catch { value.options = []; }
    }
    value.sourceLocator = `数据行 ${index + 2}`;
    const candidate = candidateFromObject(value, source, index);
    if (row.length !== headers.length) candidate.issues.push(issue("column-count", "此行列数与表头不一致，需要核对。"));
    return candidate;
  });
  return { candidates, warnings: [], unresolvedUnitIds: [] };
}

function headingType(line: string): QuestionType | null {
  line = line.normalize("NFKC").replace(/(\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, "$1");
  const match = line.match(/^(?:#{1,6}\s*)?(?:[一二三四五六七八九十\d]+[、.．]\s*)?(单选题?|多选题?|判断题?|单项选择题?|多项选择题?)(?:\s|[（(:：]|$)/);
  if (!match) return null;
  const type = normalizeQuestionType(match[1]);
  return type === "unsupported" ? null : type;
}

export function parsePlainQuestions(source: SourceDocument): ImportResult {
  const candidates: ImportCandidate[] = [];
  let current: { ordinal: string; type: QuestionType | "unsupported"; lines: string[]; locators: string[]; unitIds: string[]; attachments: string[] } | null = null;
  let sectionType: QuestionType | "unsupported" = "unsupported";
  const usedUnits = new Set<string>();
  const flush = () => {
    if (!current) return;
    const originalText = current.lines.join("\n");
    const stem: string[] = [];
    const options: QuestionOption[] = [];
    let answer = "";
    let explanation = "";
    let domain = "";
    let lastOption: QuestionOption | undefined;
    let inExplanation = false;
    for (const line of current.lines) {
      const cleaned = line.replace(/^>\s?/, "").trim();
      const answerMatch = cleaned.match(/^(?:\*\*)?(?:参考答案|正确答案|答案)(?:\*\*)?\s*[:：]\s*(.*)$/);
      if (answerMatch) { answer = answerMatch[1] ?? ""; inExplanation = false; continue; }
      const explanationMatch = cleaned.match(/^(?:解析|解释)\s*[:：]\s*(.*)$/);
      if (explanationMatch) { explanation = explanationMatch[1] ?? ""; inExplanation = true; continue; }
      const domainMatch = cleaned.match(/^(?:知识点|知识域|章节)\s*[:：]\s*(.*)$/);
      if (domainMatch) { domain = domainMatch[1] ?? ""; inExplanation = false; continue; }
      if (inExplanation) { explanation += `\n${cleaned}`; continue; }
      if (/^\[!/.test(cleaned)) continue;
      const matches = [...cleaned.matchAll(/(?:^|\s)([A-Z])[.、．:：)]\s*/g)];
      if (matches.length && matches[0]!.index === 0) {
        for (const [index, match] of matches.entries()) {
          const start = match.index + match[0].length;
          lastOption = { key: match[1]!, text: cleaned.slice(start, matches[index + 1]?.index).trim() };
          options.push(lastOption);
        }
      } else if (lastOption && !answer) lastOption.text += `\n${cleaned}`;
      else if (!answer) stem.push(cleaned);
    }
    const candidate = candidateFromObject({
      ordinal: current.ordinal, type: current.type, stem: stem.join("\n").trim(), options, answers: answer,
      domain, explanation, sourceLocator: [...new Set(current.locators)].join("；"), sourceUnitIds: [...new Set(current.unitIds)], attachments: [...new Set(current.attachments)], originalText,
    }, source, candidates.length);
    if (new Set(current.unitIds).size > 1) candidate.issues.push(issue("cross-unit", "题目跨越页面或段落，请对照原文确认完整性。", false));
    if (/(?:附图|图像|图片|题图).{0,8}(?:缺失|缺少|未提供)/.test(originalText)
      || /(?:根据附图|根据下图|如图所示|见下图)/.test(originalText) && !candidate.attachments.length) candidate.issues.push(issue("missing-source-image", "原文标明题图缺失，需要补齐后才能计分。"));
    candidates.push(candidate);
    current = null;
  };
  for (const unit of source.units) {
    for (const line of unit.text.split(/\r?\n/)) {
      const clean = line.trim();
      const type = headingType(clean);
      if (type) { flush(); sectionType = type; continue; }
      const start = clean.match(/^(?:#{1,6}\s*)?(?:第\s*)?(\d+)\s*(?:题)?[.、．:：)]\s*(.*)$/);
      if (start) {
        flush();
        const tagged = (start[2] ?? "").match(/^[【[(（](单选题?|多选题?|判断题?)[】\])）]\s*(.*)$/);
        current = { ordinal: start[1]!, type: tagged ? normalizeQuestionType(tagged[1]) : sectionType, lines: [tagged ? tagged[2] ?? "" : start[2] ?? ""], locators: [unit.locator], unitIds: [unit.id], attachments: [...(unit.attachmentIds ?? [])] };
        usedUnits.add(unit.id);
      } else if (/^#{1,6}\s+/.test(clean)) {
        flush(); sectionType = "unsupported";
      } else if (current) {
        current.lines.push(line);
        current.locators.push(unit.locator);
        current.unitIds.push(unit.id);
        current.attachments.push(...(unit.attachmentIds ?? []));
        usedUnits.add(unit.id);
      }
    }
  }
  flush();
  return {
    candidates,
    warnings: candidates.length ? [] : ["未识别到标准题号。可选择 AI 整理，或按模板修正格式。"],
    unresolvedUnitIds: source.units.filter((unit) => !usedUnits.has(unit.id) && (unit.needsRecognition || unit.text.trim())).map((unit) => unit.id),
  };
}

export function parseDocumentCandidates(source: SourceDocument): ImportResult {
  if (source.role !== "questions") return { candidates: [], warnings: ["此文件已标为答案或参考资料，不单独建立题目。"], unresolvedUnitIds: [] };
  const content = source.units.map((unit) => unit.text).join("\n");
  if (source.kind === "json") return parseStructuredQuestions(content, source);
  if (source.kind === "csv") return parseCsvQuestions(content, source);
  return parsePlainQuestions(source);
}

export function extractAnswerEntries(source: SourceDocument): AnswerEntry[] {
  const entries: AnswerEntry[] = [];
  let type: QuestionType | undefined;
  for (const unit of source.units) for (const line of unit.text.split(/\r?\n/)) {
    const heading = headingType(line.trim());
    if (heading) { type = heading; continue; }
    // The answer pattern must end before another numbered entry or end of line.
    const pattern = /(?:^|[\s,，;；])(?:第\s*)?(\d+)\s*(?:题)?\s*[.、．:：)\t-]?\s*([A-Za-z]+(?:[ \t]*[,，、/|][ \t]*[A-Za-z]+)*|正确|错误|对|错|√|×)(?=\s*\d+\s*[.、．:：)\t-]|[\s,，;；]|$)/g;
    for (const match of line.matchAll(pattern)) entries.push({ paperTitle: source.paperTitle, ordinal: match[1]!, ...(type ? { type } : {}), answers: normalizeAnswers(match[2]), sourceId: source.id, sourceLocator: unit.locator });
  }
  return entries;
}

export function matchAnswers(candidates: readonly ImportCandidate[], entries: readonly AnswerEntry[]): ImportCandidate[] {
  return candidates.map((original) => {
    const candidate = { ...original, answers: [...original.answers], issues: original.issues.filter((item) => !["missing-answer", "invalid-answer", "answer-conflict", "ambiguous-answer"].includes(item.code)) };
    const matches = entries.filter((entry) => entry.paperTitle === candidate.paperTitle && entry.ordinal === candidate.ordinal
      && (!entry.type || entry.type === candidate.type));
    const siblingOrdinals = candidates.filter((sibling) => sibling.paperTitle === candidate.paperTitle && sibling.ordinal === candidate.ordinal);
    if (matches.length > 1 || (matches.length === 1 && !matches[0]!.type && siblingOrdinals.length > 1)) {
      candidate.issues.push(issue("ambiguous-answer", "答案对应到多个题目或答案条目，请按题型和题号核对。"));
    } else if (matches.length === 1) {
      const match = matches[0]!;
      if (candidate.answers.length && [...candidate.answers].sort().join("|") !== [...match.answers].sort().join("|")) candidate.issues.push(issue("answer-conflict", `原题答案与答案文件不一致（答案文件：${match.answers.join("、")}），需人工决定。`));
      else { candidate.answers = [...match.answers]; candidate.answerOrigin = "source"; candidate.answerSourceId = match.sourceId; candidate.answerSourceLocator = match.sourceLocator; }
    }
    const existing = new Set(candidate.issues.map((item) => item.code));
    candidate.issues.push(...validateCandidate(candidate).filter((item) => !existing.has(item.code)));
    return candidate;
  });
}

export const CSV_TEMPLATE = 'ordinal,type,stem,A,B,C,D,answers,domain,explanation\n1,single,下列哪项是示例？,示例,非示例,,,A,示例章节,这是自制示例题。\n';

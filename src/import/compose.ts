import type { ComposeOptions } from "../library/types";
import type { QuestionType } from "../domain/question";

const TYPES: QuestionType[] = ["single", "multiple", "judge"];
const FIELDS = new Set(["bankId", "title", "durationMinutes", "counts", "points", "domains", "sources", "filter", "scoreMode"]);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Model output is data, never a second prompt or a recursive network request. */
export function parseCompositionOptions(input: string, bankId: string, allowedDomains: readonly string[], allowedSources: readonly string[]): ComposeOptions {
  let value: unknown;
  try { value = JSON.parse(input.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/, "$1")); }
  catch { throw new Error("组卷条件不是完整 JSON，请让 AI 按任务格式返回；本次不会自动再次请求。"); }
  if (!record(value) || Object.keys(value).some((key) => !FIELDS.has(key))) throw new Error("组卷条件包含不支持的字段。");
  if (value.bankId !== undefined && value.bankId !== bankId) throw new Error("组卷条件不能切换到其他题库。");
  const result: ComposeOptions = { bankId, title: "自定义练习", durationMinutes: 30, counts: { single: 10 }, scoreMode: "exact" };
  if (value.title !== undefined) {
    if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 200) throw new Error("试卷名称无效。");
    result.title = value.title.trim();
  }
  if (value.durationMinutes !== undefined) {
    if (typeof value.durationMinutes !== "number" || !Number.isFinite(value.durationMinutes) || value.durationMinutes <= 0 || value.durationMinutes > 1440) throw new Error("试卷限时应为 0 至 1440 分钟之间。");
    result.durationMinutes = value.durationMinutes;
  }
  for (const field of ["counts", "points"] as const) {
    const map = value[field];
    if (map === undefined) continue;
    if (!record(map) || Object.keys(map).some((key) => !TYPES.includes(key as QuestionType))) throw new Error("题型数量或分值字段无效。");
    const normalized: Partial<Record<QuestionType, number>> = {};
    for (const type of TYPES) if (map[type] !== undefined) {
      const amount = map[type];
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > (field === "counts" ? 2000 : 10000)
        || field === "counts" && !Number.isInteger(amount)) throw new Error("题型数量必须是整数，分值必须是有限的非负数。");
      normalized[type] = amount;
    }
    result[field] = normalized;
  }
  const total = Object.values(result.counts).reduce((sum, count) => sum + count, 0);
  if (total < 1 || total > 2000) throw new Error("每份试卷应为 1 至 2,000 道题。");
  for (const field of ["domains", "sources"] as const) if (value[field] !== undefined) {
    const list = value[field];
    const allowed = field === "domains" ? allowedDomains : allowedSources;
    if (!Array.isArray(list) || !list.every((item): item is string => typeof item === "string" && allowed.includes(item))) throw new Error("AI 引用了当前题库中不存在的知识点或来源，请重新选择。");
    result[field] = [...new Set(list)];
  }
  if (value.filter !== undefined) {
    if (typeof value.filter !== "string" || !["all", "wrong", "unanswered", "bookmarked"].includes(value.filter)) throw new Error("组题筛选条件无效。");
    result.filter = value.filter as ComposeOptions["filter"];
  }
  if (value.scoreMode !== undefined) {
    if (value.scoreMode !== "exact" && value.scoreMode !== "proportional") throw new Error("多选计分规则无效。");
    result.scoreMode = value.scoreMode;
  }
  return result;
}

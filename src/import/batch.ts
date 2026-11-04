import { fingerprint } from "./fingerprint";
import { selectSourceUnits } from "./ai";
import type { ImportBatch, ImportResult, ImportScope, SourceDocument } from "./types";

export function createImportBatch(sources: readonly SourceDocument[], scope: ImportScope, now = new Date().toISOString()): ImportBatch {
  const selected = selectSourceUnits(sources, scope);
  const sourceHashes = [...new Set(selected.map((entry) => entry.source.hash))].sort();
  const id = `batch-${fingerprint(JSON.stringify([sourceHashes, [...scope.unitIds].sort(), scope.instructions ?? ""]))}`;
  return { id, sourceHashes, selectedUnitIds: [...scope.unitIds], createdAt: now, updatedAt: now, status: "draft", candidates: [], completedUnitIds: [], failedUnitIds: [], warnings: [] };
}

export function mergeImportResult(batch: ImportBatch, result: ImportResult, processedUnitIds: readonly string[], now = new Date().toISOString()): ImportBatch {
  if (processedUnitIds.some((id) => !batch.selectedUnitIds.includes(id))) throw new Error("处理结果包含当前批次之外的页面。");
  // A retry replaces the drafts from its pages; it must not append a second OCR interpretation.
  const candidates = new Map(batch.candidates.filter((candidate) => !candidate.sourceUnitIds.some((id) => processedUnitIds.includes(id))).map((candidate) => [candidate.id, candidate]));
  for (const candidate of result.candidates) candidates.set(candidate.id, candidate);
  const unresolved = new Set(result.unresolvedUnitIds);
  const completed = new Set(batch.completedUnitIds);
  const failed = new Set(batch.failedUnitIds);
  for (const id of processedUnitIds) {
    if (unresolved.has(id)) { failed.add(id); completed.delete(id); }
    else { completed.add(id); failed.delete(id); }
  }
  return { ...batch, updatedAt: now, status: "review", candidates: [...candidates.values()], completedUnitIds: [...completed], failedUnitIds: [...failed], warnings: [...new Set([...batch.warnings, ...result.warnings])] };
}

export function interruptImportBatch(batch: ImportBatch, message: string, now = new Date().toISOString()): ImportBatch {
  return { ...batch, updatedAt: now, status: "interrupted", warnings: [...new Set([...batch.warnings, message])] };
}

export function pendingImportUnits(batch: ImportBatch): string[] {
  return batch.selectedUnitIds.filter((id) => !batch.completedUnitIds.includes(id));
}

import type { Question } from "../domain/question";

/** Keep existing IDs, text and domains; add new provenance without duplicating a question. */
export function mergeQuestions(...groups: ReadonlyArray<readonly Question[]>): Question[] {
  const merged = new Map<string, Question>();
  for (const group of groups) {
    for (const question of group) {
      const previous = merged.get(question.id);
      const sources = [...new Set([...(previous?.sources ?? []), ...question.sources])];
      merged.set(question.id, {
        ...(previous ?? question),
        sources,
        repeatCount: Math.max(previous?.repeatCount ?? 1, question.repeatCount, sources.length),
      });
    }
  }
  return [...merged.values()];
}

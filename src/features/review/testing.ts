/** Test helpers. Not exported from index.ts. */
import { randomUUID } from "node:crypto";
import { saveSkillMap } from "@/features/skill-map";
import { putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";

export function resetStore(): void {
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
}

/** Saves a map with skills "a" and "b" owned by `ownerId`. */
export async function saveMap(ownerId: string, overrides: Partial<SkillMap> = {}): Promise<SkillMap> {
  const node = (id: string) => ({
    id,
    title: `Skill ${id}`,
    why: "Why.",
    prerequisites: [],
    fromSource: true,
    citation: null,
    checkpoints: ["x", "y", "z"],
  });
  const map: SkillMap = {
    id: randomUUID(),
    ownerId,
    title: "Payroll clerk",
    subtitle: "Calgary",
    sourceKind: "posting",
    sourceText: "posting",
    nodes: [node("a"), node("b")],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  await saveSkillMap(map);
  return map;
}

/**
 * Saves a deck as the flashcards feature does, at flashcards/<mapId>/<nodeId>, and returns the
 * card ids. Tests only: the real deck comes from a model call.
 */
export async function saveDeck(mapId: string, nodeId: string, count: number): Promise<string[]> {
  const items = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    mapId,
    nodeId,
    front: `Question ${nodeId}${i + 1}`,
    back: `Answer ${nodeId}${i + 1}`,
    citation: null,
  }));
  await putDoc(`flashcards/${mapId}/${nodeId}`, { items, createdAt: new Date().toISOString() });
  return items.map((item) => item.id);
}

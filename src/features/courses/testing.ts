/** Test helpers. Not exported from index.ts. */
import { randomUUID } from "node:crypto";
import { putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import { resetSeedStateForTests } from "./seed";
import { resetStartStateForTests } from "./start";

/** Empties the in-memory store and forgets seeding and starts in flight, so each test starts clean. */
export function resetStore(): void {
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
  resetSeedStateForTests();
  resetStartStateForTests();
}

export function makeNode(id: string, prerequisites: string[] = [], fromSource = true): SkillNode {
  return {
    id,
    title: `Skill ${id}`,
    why: `Why ${id} matters.`,
    prerequisites,
    fromSource,
    citation: null,
    checkpoints: ["One", "Two", "Three"],
  };
}

/** Saves a map owned by `ownerId` and returns it. */
export async function saveMap(ownerId: string, overrides: Partial<SkillMap> = {}): Promise<SkillMap> {
  const map: SkillMap = {
    id: randomUUID(),
    ownerId,
    title: "Data analyst",
    subtitle: "Calgary",
    sourceKind: "posting",
    sourceText: "secret posting text",
    nodes: [makeNode("sql"), makeNode("joins", ["sql"])],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  await putDoc(`maps/${map.id}`, map);
  return map;
}

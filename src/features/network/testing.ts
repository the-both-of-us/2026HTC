/** Test helpers. Not exported from index.ts. */
import { randomUUID } from "node:crypto";
import { putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import { resetDemoStateForTests } from "./demo";

/** Empties the in-memory store and forgets seeding, so each test starts clean. */
export function resetNetwork(): void {
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
  resetDemoStateForTests();
}

export function node(id: string, title: string, prerequisites: string[] = []): SkillNode {
  return { id, title, why: `Why ${title}.`, prerequisites, fromSource: true, citation: null, checkpoints: ["a", "b", "c"] };
}

/** Saves a map owned by `ownerId` and returns it. */
export async function saveMap(ownerId: string, nodes: SkillNode[], title = "Data analyst"): Promise<SkillMap> {
  const map: SkillMap = {
    id: randomUUID(),
    ownerId,
    title,
    subtitle: "Calgary",
    sourceKind: "posting",
    sourceText: "posting text",
    nodes,
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${map.id}`, map);
  return map;
}

/** Marks a node proven, the way teach-back records it. */
export async function prove(mapId: string, ownerId: string, nodeId: string): Promise<void> {
  await putDoc(`progress/${mapId}/${ownerId}/${nodeId}`, {
    nodeId,
    attemptId: randomUUID(),
    provenAt: new Date().toISOString(),
  });
}

/** Stores a live evidence page for a map, showing these node ids, the way proof publishes one. */
export async function publishEvidence(
  map: SkillMap,
  ownerId: string,
  nodeIds: string[],
  state: "live" | "revoked" = "live",
): Promise<string> {
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  const record =
    state === "live"
      ? {
          state,
          id,
          ownerId,
          mapId: map.id,
          hash: "h",
          seal: null,
          snapshot: { skills: nodeIds.map((nodeId) => ({ nodeId })) },
        }
      : { state, id, ownerId, mapId: map.id, revokedAt: new Date().toISOString() };
  await putDoc(`proofs/${id}`, record);
  await putDoc(`proof-index/${map.id}`, { proofId: id });
  return id;
}

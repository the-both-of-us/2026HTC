import { isEnergyRelated } from "@/features/grid";
import { deleteDoc, getDoc, putDoc } from "@/shared/store";
import type { PublicSkillNode, SkillMap } from "@/shared/types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What anyone holding a map's link can read. It leaves out ownerId on purpose:
 * that value is the owner's identity cookie, so publishing it would let a reader
 * act as them. sourceText is left out because no reader of the map needs it.
 * Checkpoint text is left out because it is the answer key: see PublicSkillNode.
 */
export type PublicSkillMap = Pick<SkillMap, "id" | "title" | "subtitle" | "sourceKind" | "createdAt"> & {
  nodes: PublicSkillNode[];
  /** True when the posting is energy related, so the map can show the live grid card. */
  energyRelated: boolean;
};

export function toPublicMap(map: SkillMap): PublicSkillMap {
  return {
    id: map.id,
    title: map.title,
    subtitle: map.subtitle,
    sourceKind: map.sourceKind,
    nodes: map.nodes.map(({ checkpoints, ...node }) => ({ ...node, checkpointCount: checkpoints.length })),
    energyRelated: isEnergyRelated(map.sourceText),
    createdAt: map.createdAt,
  };
}

export async function saveSkillMap(map: SkillMap): Promise<void> {
  await putDoc(`maps/${map.id}`, map);
}

/** Returns the full map, or null. The id comes from a URL, so it must look like one of ours. */
export async function getSkillMap(id: string): Promise<SkillMap | null> {
  if (!UUID_PATTERN.test(id)) return null;
  return getDoc<SkillMap>(`maps/${id}`);
}

export async function deleteSkillMap(id: string): Promise<void> {
  if (!UUID_PATTERN.test(id)) return;
  await deleteDoc(`maps/${id}`);
}

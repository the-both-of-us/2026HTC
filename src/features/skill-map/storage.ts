import { randomUUID } from "node:crypto";
import { deleteDoc, getDoc, listDocs, putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { SkillMapError } from "./build";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What anyone holding a map's link can read. It leaves out ownerId on purpose:
 * that value is the owner's identity cookie, so publishing it would let a reader
 * act as them. sourceText is left out because no reader of the map needs it.
 */
export type PublicSkillMap = Pick<
  SkillMap,
  "id" | "title" | "subtitle" | "sourceKind" | "nodes" | "createdAt"
>;

export function toPublicMap(map: SkillMap): PublicSkillMap {
  return {
    id: map.id,
    title: map.title,
    subtitle: map.subtitle,
    sourceKind: map.sourceKind,
    nodes: map.nodes,
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

/**
 * Copies a map for a new owner, for "Start this course". Progress lives under the
 * map's id, so the copy starts with none, and edits to the original never reach it.
 *
 * This does not check who may read the original: the caller must do that first.
 */
export async function copySkillMap(mapId: string, newOwnerId: string): Promise<SkillMap> {
  const source = await getSkillMap(mapId);
  if (!source) throw new SkillMapError("We could not find that course. It may have been removed.", 404);

  const copy: SkillMap = {
    ...source,
    id: randomUUID(),
    ownerId: newOwnerId,
    createdAt: new Date().toISOString(),
    forkedFrom: source.id,
  };
  await saveSkillMap(copy);
  return copy;
}

/** One user's maps, newest first. It reads every map, which is fine at this size. */
export async function listMapsByOwner(ownerId: string): Promise<SkillMap[]> {
  const maps = await listDocs<SkillMap>("maps/");
  return maps
    .filter((map) => map.ownerId === ownerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteSkillMap(id: string): Promise<void> {
  if (!UUID_PATTERN.test(id)) return;
  await deleteDoc(`maps/${id}`);
}

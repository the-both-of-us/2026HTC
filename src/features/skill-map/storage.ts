import { randomUUID } from "node:crypto";
import { deleteDoc, getDoc, listDocs, listKeys, putDoc } from "@/shared/store";
import type { PublicSkillNode, SkillMap } from "@/shared/types";
import { audienceForMap } from "@/shared/audience";
import { SkillMapError } from "./build";
import { isEnergyRelated } from "./energy";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What anyone holding a map's link can read. It leaves out ownerId on purpose:
 * that value is the owner's identity cookie, so publishing it would let a reader
 * act as them. sourceText is left out because no reader of the map needs it.
 * Checkpoint text is left out because it is the answer key: see PublicSkillNode.
 */
export type PublicSkillMap = Pick<SkillMap, "id" | "title" | "subtitle" | "sourceKind" | "createdAt" | "program" | "audience"> & {
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
    program: map.program,
    // Only when there is one, so a map for adults looks exactly as before.
    ...(map.audience && { audience: map.audience }),
  };
}

/**
 * The owner index: `maps-by-owner/<ownerId>/<mapId>` exists for every map, so one
 * person's maps are found by listing their own keys, never by reading every map.
 * Owner ids go into a key, so only plain ids (a UUID, or a fixed seed id) are indexed.
 */
const OWNER_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const ownerIndexPrefix = (ownerId: string) => `maps-by-owner/${ownerId}/`;
const ownerIndexKey = (ownerId: string, mapId: string) => `${ownerIndexPrefix(ownerId)}${mapId}`;
/** Present once every map saved before the index existed has an entry. */
const OWNER_INDEX_READY_KEY = "indexes/maps-by-owner-v1";

type OwnerIndexEntry = { mapId: string };

async function indexMap(map: Pick<SkillMap, "id" | "ownerId">): Promise<void> {
  if (!OWNER_ID_PATTERN.test(map.ownerId)) {
    console.warn("[skill-map] a map's owner id cannot go in a key, so the map is not indexed");
    return;
  }
  await putDoc(ownerIndexKey(map.ownerId, map.id), { mapId: map.id } satisfies OwnerIndexEntry);
}

let catchingUp: Promise<void> | null = null;

/**
 * Indexes maps saved before the index existed. It reads every map, but only once per
 * store: after it finishes, a marker says so, and every later save indexes its own map.
 * Writing an entry twice changes nothing, so two servers catching up at once is harmless.
 */
async function ensureOwnerIndex(): Promise<void> {
  if (await getDoc(OWNER_INDEX_READY_KEY)) return;
  catchingUp ??= (async () => {
    const maps = await listDocs<SkillMap>("maps/");
    await Promise.all(maps.map(indexMap));
    await putDoc(OWNER_INDEX_READY_KEY, { indexedAt: new Date().toISOString(), maps: maps.length });
  })().finally(() => {
    catchingUp = null;
  });
  await catchingUp;
}

export async function saveSkillMap(map: SkillMap): Promise<void> {
  await putDoc(`maps/${map.id}`, map);
  await indexMap(map);
}

/** Returns the full map, or null. The id comes from a URL, so it must look like one of ours. */
export async function getSkillMap(id: string): Promise<SkillMap | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const map = await getDoc<SkillMap>(`maps/${id}`);
  if (!map || map.audience !== undefined) return map;
  // Saved before audiences existed: a grade or age its title or program names still counts.
  const audience = audienceForMap(map);
  return audience ? { ...map, audience } : map;
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
    // A copy leaves its program behind: the program is private to the person who planned it.
    program: undefined,
    id: randomUUID(),
    ownerId: newOwnerId,
    createdAt: new Date().toISOString(),
    forkedFrom: source.id,
  };
  await saveSkillMap(copy);
  return copy;
}

/**
 * One user's maps, newest first. Lists only this owner's index keys and reads only
 * those maps. An entry whose map is gone is removed; one whose map now names another
 * owner is skipped, so the index can only ever narrow the answer, never widen it.
 */
export async function listMapsByOwner(ownerId: string): Promise<SkillMap[]> {
  if (!OWNER_ID_PATTERN.test(ownerId)) return [];
  await ensureOwnerIndex();

  const prefix = ownerIndexPrefix(ownerId);
  const mapIds = (await listKeys(prefix)).map((key) => key.slice(prefix.length)).filter((id) => UUID_PATTERN.test(id));
  const maps = await Promise.all(
    mapIds.map(async (mapId) => {
      const map = await getDoc<SkillMap>(`maps/${mapId}`);
      if (!map) await deleteDoc(ownerIndexKey(ownerId, mapId));
      return map;
    }),
  );
  return maps
    .filter((map): map is SkillMap => map !== null && map.ownerId === ownerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteSkillMap(id: string): Promise<void> {
  if (!UUID_PATTERN.test(id)) return;
  const map = await getDoc<SkillMap>(`maps/${id}`);
  await deleteDoc(`maps/${id}`);
  if (map && OWNER_ID_PATTERN.test(map.ownerId)) await deleteDoc(ownerIndexKey(map.ownerId, id));
}

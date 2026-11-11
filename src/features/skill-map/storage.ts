import { randomUUID } from "node:crypto";
import { claimDoc, deleteDoc, getDoc, listDocs, listKeys, putDoc } from "@/shared/store";
import type { CourseSyllabus, PublicSkillNode, SkillMap, SkillNode } from "@/shared/types";
import { audienceForMap } from "@/shared/audience";
import { readCatalogSyllabus } from "@/features/catalog";
import { SkillMapError } from "./build";
import type { CourseBuildState } from "./types";
import { isEnergyRelated } from "./energy";
import { syllabusForLearner } from "./learnerSyllabus";

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
  /**
   * The course plan, for the unit rail. Only on maps built from a syllabus. It holds no answer
   * key (objectives, key terms and scope may be shown), and `rootMapId` is left out because it
   * can name another person's map.
   */
  syllabus?: PublicSyllabus;
  /** Wave 2: only on a map with a courseId, from `syncCourseMap`. See CourseBuildState. */
  build?: CourseBuildState;
};

/** A syllabus as a browser may see it. */
export type PublicSyllabus = Omit<CourseSyllabus, "rootMapId">;

function toPublicSyllabus(syllabus: CourseSyllabus): PublicSyllabus {
  const { rootMapId, ...rest } = syllabus;
  void rootMapId;
  return rest;
}

export function toPublicMap(map: SkillMap, build?: CourseBuildState | null): PublicSkillMap {
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
    // Only on maps built from a syllabus, so an older map looks exactly as before.
    ...(map.syllabus && { syllabus: toPublicSyllabus(map.syllabus) }),
    ...(build && { build }),
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

/**
 * Saves a map and its owner index entry. A map of a catalog course (`courseId`) is saved without
 * `syllabus` and `rating`: the syllabus is canonical and attached on read, so a learner's map
 * never holds a stale copy of it.
 */
export async function saveSkillMap(map: SkillMap): Promise<void> {
  await putDoc(`maps/${map.id}`, storedForm(map));
  await indexMap(map);
}

function storedForm(map: SkillMap): SkillMap {
  if (!map.courseId) return map;
  const { syllabus, rating, ...rest } = map;
  void syllabus;
  void rating;
  return rest;
}

/**
 * Returns the full map, or null. The id comes from a URL, so it must look like one of ours.
 * A map of a catalog course gets its syllabus attached from `catalog/syllabi/<courseId>` (or,
 * while that is still being written, from its partial doc with `planning: true`), shaped for this
 * learner by `syllabusForLearner`. While no syllabus exists at all, the map has none.
 */
export async function getSkillMap(id: string): Promise<SkillMap | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const stored = await getDoc<SkillMap>(`maps/${id}`);
  if (!stored) return null;
  const map = stored.courseId ? await withCatalogSyllabus(stored, stored.courseId) : stored;
  if (map.audience !== undefined) return map;
  // Saved before audiences existed: a grade or age its title or program names still counts.
  const audience = audienceForMap(map);
  return audience ? { ...map, audience } : map;
}

async function withCatalogSyllabus(map: SkillMap, courseId: string): Promise<SkillMap> {
  const { syllabus: stale, ...rest } = map;
  void stale;
  const read = await readCatalogSyllabus(courseId);
  if (read.state === "idle") return rest;
  return { ...rest, syllabus: syllabusForLearner(read.syllabus, map.nodes, courseId, read.state === "planning") };
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

/*
 * Units. Each unit's validated nodes are canonical: `unit-nodes/<contentIdOf(map)>/<unitId>`,
 * written once under `startOnce` (see canonical.ts), so every learner map of one course gets the
 * same nodes and ids. Appending them to one learner map holds `unit-claims/<mapId>` for the few
 * store operations it takes, so the append is a safe read, change, write.
 */

/** What `unit-nodes/<contentId>/<unitId>` holds. No owner, no map id, no source text. */
export type UnitCacheEntry = { contentId: string; unitId: string; nodes: SkillNode[]; builtAt: string };

/** What `unit-claims/<mapId>` holds while a unit is appended to that map. */
export type UnitClaim = { unitId: string; claimedAt: string };

export const unitNodesKey = (contentId: string, unitId: string) => `unit-nodes/${contentId}/${unitId}`;
const unitClaimKey = (mapId: string) => `unit-claims/${mapId}`;

export async function getUnitCache(contentId: string, unitId: string): Promise<UnitCacheEntry | null> {
  return getDoc<UnitCacheEntry>(unitNodesKey(contentId, unitId));
}

export async function claimUnitAppend(mapId: string, claim: UnitClaim): Promise<boolean> {
  return claimDoc(unitClaimKey(mapId), claim);
}

export async function getUnitClaim(mapId: string): Promise<UnitClaim | null> {
  return getDoc<UnitClaim>(unitClaimKey(mapId));
}

export async function releaseUnitAppend(mapId: string): Promise<void> {
  await deleteDoc(unitClaimKey(mapId));
}

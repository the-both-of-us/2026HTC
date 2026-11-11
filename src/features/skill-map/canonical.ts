import { deleteDoc } from "@/shared/store";
import { readOnce } from "@/shared/store/once";
import type { SkillMap } from "@/shared/types";
import { unitNodesKey, type UnitCacheEntry } from "./storage";
import type { CourseBuildState } from "./types";
import { appendUnit } from "./units";

/*
 * Wave 2: canonical content shared by every learner map of one catalog course.
 */

export { ensureUnitNodes } from "./units";

/**
 * The id every shared content key uses: unit nodes, lessons, quiz, flashcards, catch rounds,
 * resources. The catalog courseId for a topic map, the map id for a posting or PDF map.
 * Deletes ("Delete my data", deleting a map) keep taking map ids, never this.
 */
export function contentIdOf(map: Pick<SkillMap, "id" | "courseId">): string {
  return map.courseId ?? map.id;
}

/**
 * For a map with a courseId (read with `getSkillMap`, so its syllabus is attached): when the map
 * has no unit 1 nodes yet and `unit-nodes/<courseId>/u1` exists, appends unit 1 and saves (zero
 * model calls; the append then starts unit 2's canonical build, pre-generation rule 3). Returns
 * the map as it now is and its build state. A map without a courseId comes back unchanged with
 * `build: null`. Called by `GET /api/maps/[id]` (the map page polls it; the page itself starts no work). `deadline` is for a
 * caller already running in the background (its own deadline, not a fresh request's).
 */
export async function syncCourseMap(map: SkillMap, deadline?: number): Promise<{ map: SkillMap; build: CourseBuildState | null }> {
  if (!map.courseId) return { map, build: null };
  const syllabus: CourseBuildState["syllabus"] = map.syllabus ? (map.syllabus.planning ? "running" : "ready") : "idle";
  const firstUnit = map.syllabus?.units[0];
  if (firstUnit?.built) return { map, build: { syllabus, unit1: "ready" } };

  const read = await readOnce<UnitCacheEntry>(unitNodesKey(map.courseId, "u1"));
  if (read.state !== "ready") return { map, build: { syllabus, unit1: read.state } };
  // Unit 1's nodes exist but the syllabus read found no unit yet (it is being re-read): ask again.
  if (!firstUnit) return { map, build: { syllabus, unit1: "running" } };

  // Another request appending to this map right now (null) reads as still running: the next poll
  // sees it. An append that fails outright reads as idle, so the page stops polling and offers Try again.
  let failed = false;
  const updated = await appendUnit(map.id, firstUnit.id, read.value.nodes, deadline).catch((error: unknown) => {
    console.warn(`[skill-map] unit 1 not appended: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
    return null;
  });
  if (updated) return { map: updated, build: { syllabus, unit1: "ready" } };
  return { map, build: { syllabus, unit1: failed ? "idle" : "running" } };
}

/**
 * Removes a catalog course's canonical unit nodes. Only for a unit built ahead from a syllabus that
 * then failed (unit 1 is pipelined while the syllabus streams): the next syllabus may plan other
 * topics, so the nodes must be rebuilt from it.
 */
export async function discardUnitNodes(courseId: string, unitId: string): Promise<void> {
  await deleteDoc(unitNodesKey(courseId, unitId));
}

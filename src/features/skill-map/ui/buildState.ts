import type { PublicSkillMap } from "../storage";

/** How often the map page asks again while the canonical syllabus or unit 1 is being written. */
export const MAP_POLL_MS = 1500;

/**
 * What the canvas shows in place of the graph while a catalog course is being built. Only a map
 * with no nodes yet waits; once unit 1 is in, the graph shows and the rail keeps filling in.
 * - "syllabus": no unit is planned yet;
 * - "unit1": the syllabus has unit 1 (or is final) and its nodes are being written;
 * - "failed-syllabus" / "failed-unit1": nobody is writing it any more: offer "Try again".
 */
export type CanvasWait = "syllabus" | "unit1" | "failed-syllabus" | "failed-unit1";

export function canvasWait(map: Pick<PublicSkillMap, "build" | "nodes" | "syllabus">): CanvasWait | null {
  const build = map.build;
  if (!build || map.nodes.length > 0) return null;
  const units = map.syllabus?.units.length ?? 0;
  if (build.syllabus === "idle") return "failed-syllabus";
  if (build.syllabus === "running") return units === 0 ? "syllabus" : "unit1";
  // The syllabus is final.
  if (build.unit1 === "idle") return "failed-unit1";
  return "unit1";
}

/**
 * Whether to keep polling `GET /api/maps/[id]`: something is being written, or unit 1 is ready on
 * the server and the next read will copy it into the map. Failed builds do not poll: they wait for "Try again".
 */
export function needsMapPoll(map: Pick<PublicSkillMap, "build" | "nodes" | "syllabus">): boolean {
  const build = map.build;
  if (!build) return false;
  if (build.syllabus === "running" || build.unit1 === "running") return true;
  const wait = canvasWait(map);
  return wait === "syllabus" || wait === "unit1";
}

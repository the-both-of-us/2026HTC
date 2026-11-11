import { contentIdOf, getSkillMap, inBackground, routeDeadline } from "@/features/skill-map";
import type { SkillMap } from "@/shared/types";
import { ensureLessonOnMap, lessonStarted } from "./lessons";

/*
 * Pre-generation of lessons. Lessons are canonical (one per catalog course and topic), so a
 * lesson written ahead for one learner is ready for every learner of the course. Each step skips
 * a lesson that is saved or being written, and starts only when the deadline leaves room for it.
 */

/** Rule 4: when a lesson is served, at most this many unwritten lessons of the same unit are started. */
export const LESSONS_AHEAD = 2;

/**
 * Starts writing the lesson for a new map's first open topic once the response has been sent,
 * so the Read tab is ready when the learner opens it. Call it from a route handler right after a
 * posting or PDF map is built (a catalog course map starts with no nodes; its unit 1 lessons are
 * written ahead when its syllabus finishes). One model call at most, none when it is saved or a sample.
 */
export function writeFirstLessonSoon(mapId: string): void {
  const deadline = routeDeadline();
  inBackground("first lesson", () => writeFirstLesson(mapId, deadline));
}

/** The work behind writeFirstLessonSoon. Never throws: this is only a head start. */
export async function writeFirstLesson(mapId: string, deadline: number = routeDeadline()): Promise<void> {
  try {
    const map = await getSkillMap(mapId);
    // On a new map nothing is proven, so the open topics are the ones with no prerequisites.
    const node = map?.nodes.find((candidate) => candidate.prerequisites.length === 0);
    if (!map || !node) return;
    await ensureLessonOnMap(map, node, deadline);
  } catch (error) {
    console.warn(`[lessons] first lesson not written ahead: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

/**
 * Rule 4 (replaces "write the next lesson"): when a learner is served one lesson, starts up to
 * LESSONS_AHEAD unwritten lessons of the same unit, after it in the map's order, in parallel,
 * after the response. A map with no units (a posting or PDF map) counts as one unit.
 */
export function writeUnitLessonsSoon(mapId: string, nodeId: string): void {
  const deadline = routeDeadline();
  inBackground("unit lessons ahead", () => writeUnitLessons(mapId, nodeId, deadline));
}

/** The work behind writeUnitLessonsSoon. Never throws: this is only a head start. */
export async function writeUnitLessons(mapId: string, nodeId: string, deadline: number = routeDeadline()): Promise<void> {
  try {
    const map = await getSkillMap(mapId);
    if (!map) return;
    const next = await nextUnwritten(map, nodeId);
    await Promise.all(
      next.map((node) =>
        ensureLessonOnMap(map, node, deadline).catch((error: unknown) => {
          console.warn(`[lessons] a lesson was not written ahead: ${error instanceof Error ? error.message : "unknown error"}`);
        }),
      ),
    );
  } catch (error) {
    console.warn(`[lessons] unit lessons not written ahead: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function nextUnwritten(map: SkillMap, nodeId: string) {
  const index = map.nodes.findIndex((candidate) => candidate.id === nodeId);
  if (index < 0) return [];
  const unitId = map.nodes[index].unitId;
  const after = map.nodes.slice(index + 1).filter((node) => node.unitId === unitId);
  const picked = [];
  for (const node of after) {
    if (picked.length >= LESSONS_AHEAD) break;
    if (!(await lessonStarted(contentIdOf(map), node.id, map.audience))) picked.push(node);
  }
  return picked;
}

import { after } from "next/server";
import { getSkillMap } from "@/features/skill-map";
import { isNodeLockedFor } from "@/features/teachback";
import { getOrCreateLesson } from "./lessons";

/**
 * Starts writing the lesson for a new map's first open topic once the response has been sent,
 * so the Read tab is ready when the learner opens it (a new lesson takes about 17 s). Call it
 * from a route handler right after a map is built. It costs one model call at most, through
 * the usual chain (gpt-oss-120b, or Sonnet when the router says so), and none when the lesson is already saved or is a sample.
 * If the learner opens the tab while it is still being written, they wait on the same call.
 */
export function writeFirstLessonSoon(mapId: string): void {
  after(() => writeFirstLesson(mapId));
}

/** The work behind writeFirstLessonSoon. Never throws: this is only a head start. */
export async function writeFirstLesson(mapId: string): Promise<void> {
  try {
    const map = await getSkillMap(mapId);
    // On a new map nothing is proven, so the open topics are the ones with no prerequisites.
    // The map page suggests the first of them, in the map's order.
    const node = map?.nodes.find((candidate) => candidate.prerequisites.length === 0);
    if (!map || !node) return;
    await getOrCreateLesson(map.id, node.id, map.ownerId);
  } catch (error) {
    console.warn(`[lessons] first lesson not written ahead: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

/**
 * When a learner opens one lesson, starts writing the next one they can open (the first skill
 * after it, in the map's order, that is not locked for them), so clicking on is instant. At most
 * one model call, and none when that lesson is already saved. Runs after the response is sent.
 */
export function writeNextLessonSoon(mapId: string, nodeId: string, viewerId: string): void {
  after(() => writeNextLesson(mapId, nodeId, viewerId));
}

/** The work behind writeNextLessonSoon. Never throws: this is only a head start. */
export async function writeNextLesson(mapId: string, nodeId: string, viewerId: string): Promise<void> {
  try {
    const map = await getSkillMap(mapId);
    const index = map?.nodes.findIndex((candidate) => candidate.id === nodeId) ?? -1;
    if (!map || index < 0) return;
    for (const next of map.nodes.slice(index + 1)) {
      if (await isNodeLockedFor(map, viewerId, next.id)) continue;
      // The same access check and in-flight sharing as a real open.
      await getOrCreateLesson(map.id, next.id, viewerId);
      return;
    }
  } catch (error) {
    console.warn(`[lessons] next lesson not written ahead: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

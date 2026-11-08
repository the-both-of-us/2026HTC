import { after } from "next/server";
import { getSkillMap } from "@/features/skill-map";
import { getOrCreateLesson } from "./lessons";

/**
 * Starts writing the lesson for a new map's first open topic once the response has been sent,
 * so the Read tab is ready when the learner opens it (a new lesson takes about 17 s). Call it
 * from a route handler right after a map is built. It costs one model call at most, through
 * the usual chain with Gemini first, and none when the lesson is already saved or is a sample.
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

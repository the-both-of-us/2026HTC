import { isPublished } from "@/features/courses";
import { getSkillMap } from "@/features/skill-map";
import { audienceKey } from "@/shared/audience";
import { isNodeLockedFor } from "@/features/teachback";
import { HttpError } from "@/shared/http";
import { deleteDoc, getDoc, listKeys, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import { findSampleLesson } from "./fixtures";
import { askModelForLesson } from "./generate";
import type { Lesson } from "./types";
import { toLesson } from "./validate";

/** The whole model call gives up after this, inside the route's 60 second maxDuration. */
export const GENERATION_DEADLINE_MS = 50_000;

/** What is stored at lessons/<mapId>/<nodeId>, or lessons/<mapId>/<nodeId>/<audience> for a map pitched at one. */
type SavedLesson = { lesson: Lesson; createdAt: string };

/** Generation in progress, by store key, so two quick opens cost one model call. Per server instance. */
const inFlight = new Map<string, Promise<Lesson>>();

const MAP_NOT_FOUND = "We could not find that map. Check the link, or build a new one.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The map and node, checked to exist and to be readable by this viewer: its owner, or anyone
 * once it is published as a course. A private map gets the same 404 as a missing one.
 */
async function resolveNode(mapId: string, nodeId: string, viewerId: string) {
  const map = await getSkillMap(mapId);
  const mayRead = map && ((viewerId !== "" && map.ownerId === viewerId) || (await isPublished(map.id)));
  if (!map || !mayRead) throw new HttpError(MAP_NOT_FOUND, 404);
  const node = map.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new HttpError("We could not find that skill on this map.", 404);
  // The audience is part of the key, so a map whose audience was only just worked out never gets its adult lesson.
  const audience = map.audience ? `/${audienceKey(map.audience)}` : "";
  return { map, node, key: `lessons/${map.id}/${node.id}${audience}` };
}

/**
 * The saved lesson for a skill, or a new one written and saved now. Sample maps use the
 * lessons saved with the code, so the demo needs no model call. Throws a 404 HttpError for an
 * unknown map or node, or a private map that is not the viewer's.
 */
export async function getOrCreateLesson(mapId: string, nodeId: string, viewerId: string): Promise<Lesson> {
  // Checked before joining a generation in flight, so nobody can wait on a private one.
  const { map, node, key } = await resolveNode(mapId, nodeId, viewerId);
  // Nothing is written for a skill that is still locked: it may never be opened.
  if (await isNodeLockedFor(map, viewerId, node.id)) {
    throw new HttpError("This skill is still locked. Prove the skills it depends on first, or unlock it on the map.", 403);
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = loadOrGenerate(key, map, node).finally(() => {
    if (inFlight.get(key) === task) inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

async function loadOrGenerate(key: string, map: SkillMap, node: SkillNode): Promise<Lesson> {
  const saved = await getDoc<SavedLesson>(key);
  if (saved?.lesson) return saved.lesson;

  const raw = findSampleLesson(map, node) ?? (await withDeadline(askModelForLesson(map, node)));
  const lesson = toLesson(raw);
  await putDoc(key, { lesson, createdAt: new Date().toISOString() } satisfies SavedLesson);
  return lesson;
}

/** Stops waiting at GENERATION_DEADLINE_MS. A late reply is ignored and nothing is saved. */
function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new HttpError("Writing this lesson took too long. Please try again in a moment.", 503)),
      GENERATION_DEADLINE_MS,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Deletes the saved lessons for these maps, for "Delete my data". Ids that are not UUIDs are
 * ignored, so nothing outside these maps can be reached. Running it twice is harmless.
 */
export async function deleteLessonsForMaps(mapIds: string[]): Promise<number> {
  const safe = [...new Set(mapIds)].filter((id) => UUID_PATTERN.test(id));
  const keys = (await Promise.all(safe.map((id) => listKeys(`lessons/${id}/`)))).flat();
  await Promise.all(keys.map((key) => deleteDoc(key)));
  return keys.length;
}

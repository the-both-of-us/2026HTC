import { isPublished } from "@/features/courses";
import { getSkillMap } from "@/features/skill-map";
import { isNodeLockedFor } from "@/features/teachback";
import { HttpError } from "@/shared/http";
import { claimDoc, getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import { topicKey } from "./key";
import type { Reel, SavedReels } from "./types";
import { reelQuery, searchReels } from "./youtube";

const DAY_MS = 86_400_000;
/** A list with videos is looked up again after this long, in case better ones appeared. */
export const FRESH_DAYS = 30;
/** An empty list is tried again sooner: the search may have been unlucky. */
export const EMPTY_RETRY_DAYS = 3;

const listKey = (key: string) => `skill-reels/${key}`;
const hourStamp = (now: number) => new Date(now).toISOString().slice(0, 13);

/** One search per list at a time on this server; the claim below covers other servers. */
const inFlight = new Map<string, Promise<Reel[]>>();

function isFresh(saved: SavedReels, now: number): boolean {
  const age = now - Date.parse(saved.searchedAt);
  return age < (saved.reels.length > 0 ? FRESH_DAYS : EMPTY_RETRY_DAYS) * DAY_MS;
}

export type ReelOptions = { apiKey?: string; now?: number };

/**
 * The Shorts for one skill. Same access rule as its lesson: the map's owner, or anyone once it
 * is a published course; nothing for a skill that is still locked. The list is shared by every
 * map with the same skill (see topicKey), and looked up only when a skill is opened, never when
 * a map is built.
 */
export async function getSkillReels(mapId: string, nodeId: string, viewerId: string, options: ReelOptions = {}): Promise<Reel[]> {
  const { apiKey = process.env.YOUTUBE_API_KEY, now = Date.now() } = options;
  const map = await getSkillMap(mapId);
  const mayRead = map && ((viewerId !== "" && map.ownerId === viewerId) || (await isPublished(map.id)));
  if (!map || !mayRead) throw new HttpError("We could not find that map. Check the link, or build a new one.", 404);
  const node = map.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new HttpError("We could not find that skill on this map.", 404);
  if (await isNodeLockedFor(map, viewerId, node.id)) {
    throw new HttpError("This skill is still locked. Prove the skills it depends on first, or unlock it on the map.", 403);
  }

  const key = topicKey(map, node);
  const saved = await getDoc<SavedReels>(listKey(key));
  if (saved && isFresh(saved, now)) return saved.reels;
  // With no key (local development), show what is saved and search nothing.
  if (!apiKey) return saved?.reels ?? [];

  const pending = inFlight.get(key);
  if (pending) return pending;
  const task = lookUp(key, map, node, saved, apiKey, now).finally(() => {
    if (inFlight.get(key) === task) inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

/**
 * Searches and saves. At most one search per list per hour across servers, so a skill whose
 * search keeps failing (quota used up) cannot spend more each time it is opened. A failure keeps
 * the old list, if any, and saves nothing.
 */
async function lookUp(key: string, map: SkillMap, node: SkillNode, saved: SavedReels | null, apiKey: string, now: number): Promise<Reel[]> {
  if (!(await claimDoc(`skill-reels-claim/${key}/${hourStamp(now)}`, { at: new Date(now).toISOString() }))) {
    return saved?.reels ?? [];
  }
  try {
    const reels = await searchReels(node.title, map.title, map.audience, apiKey);
    await putDoc(listKey(key), {
      reels,
      query: reelQuery(node.title, map.title, map.audience),
      searchedAt: new Date(now).toISOString(),
    } satisfies SavedReels);
    return reels;
  } catch (error) {
    console.warn("[reels] YouTube search failed:", error instanceof Error ? error.message : error);
    return saved?.reels ?? [];
  }
}

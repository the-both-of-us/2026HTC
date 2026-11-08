import { isPublished } from "@/features/courses";
import { getSkillMap } from "@/features/skill-map";
import { isNodeLockedFor } from "@/features/teachback";
import { HttpError } from "@/shared/http";
import { claimDoc, getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import { topicKey } from "./key";
import type { Reel, SavedReels, ShownReel, Vote, VoteResult } from "./types";
import { isRemoved, setVote, tallyVotes, type Tally } from "./votes";
import { reelQuery, searchReels } from "./youtube";

const DAY_MS = 86_400_000;
/** At most this many on a skill at once. */
export const MAX_SHOWN = 4;
/** A list with videos is looked up again after this long, in case better ones appeared. */
export const FRESH_DAYS = 30;
/** An empty list is tried again sooner: the search may have been unlucky. */
export const EMPTY_RETRY_DAYS = 3;
/** Raised when the search or its filters change, so lists saved by the old one are looked up again. */
export const SEARCH_VERSION = 2;
/** Votes left fewer videos than this, and the list is looked up again. */
const MIN_LEFT = 2;

const listKey = (topic: string) => `skill-reels/${topic}`;
const hourStamp = (now: number) => new Date(now).toISOString().slice(0, 13);

/** One search per list at a time on this server; the claim in lookUp covers other servers. */
const inFlight = new Map<string, Promise<Reel[]>>();

export type ReelOptions = { apiKey?: string; now?: number };

/**
 * The map and skill, checked like its lesson: the map's owner, or anyone once it is a published
 * course, and never a skill that is still locked. A private map is the same 404 as a missing one.
 */
async function resolveSkill(mapId: string, nodeId: string, viewerId: string) {
  const map = await getSkillMap(mapId);
  const mayRead = map && ((viewerId !== "" && map.ownerId === viewerId) || (await isPublished(map.id)));
  if (!map || !mayRead) throw new HttpError("We could not find that map. Check the link, or build a new one.", 404);
  const node = map.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new HttpError("We could not find that skill on this map.", 404);
  if (await isNodeLockedFor(map, viewerId, node.id)) {
    throw new HttpError("This skill is still locked. Prove the skills it depends on first, or unlock it on the map.", 403);
  }
  return { map, node, topic: topicKey(map, node) };
}

/** Video ids voted off this skill for everyone. */
const removedIds = (tallies: Map<string, Tally>) => new Set([...tallies].filter(([, tally]) => isRemoved(tally)).map(([videoId]) => videoId));

/**
 * The Shorts for one skill as this viewer sees them: without videos voted off for everyone or
 * disliked by this viewer, at most MAX_SHOWN, each with its like count and their vote. The list
 * is shared by every map with the same skill (see topicKey), and looked up only when a skill is
 * opened, never when a map is built.
 */
export async function getSkillReels(mapId: string, nodeId: string, viewerId: string, options: ReelOptions = {}): Promise<ShownReel[]> {
  const { apiKey = process.env.YOUTUBE_API_KEY, now = Date.now() } = options;
  const { map, node, topic } = await resolveSkill(mapId, nodeId, viewerId);
  const [saved, tallies] = await Promise.all([getDoc<SavedReels>(listKey(topic)), tallyVotes(topic, viewerId)]);
  const removed = removedIds(tallies);
  const reels = await currentList(topic, map, node, saved, removed, apiKey, now);

  return reels
    .filter((reel) => !removed.has(reel.videoId) && tallies.get(reel.videoId)?.mine !== -1)
    .slice(0, MAX_SHOWN)
    .map((reel) => ({ ...reel, likes: tallies.get(reel.videoId)?.likes ?? 0, myVote: tallies.get(reel.videoId)?.mine ?? 0 }));
}

/** The saved list, or a new one when it is missing, old, from an older search, or mostly voted off. */
async function currentList(
  topic: string,
  map: SkillMap,
  node: SkillNode,
  saved: SavedReels | null,
  removed: ReadonlySet<string>,
  apiKey: string | undefined,
  now: number,
): Promise<Reel[]> {
  if (saved && isFresh(saved, removed, now)) return saved.reels;
  // With no key (local development), show what is saved and search nothing.
  if (!apiKey) return saved?.reels ?? [];

  const pending = inFlight.get(topic);
  if (pending) return pending;
  const task = lookUp(topic, map, node, saved, removed, apiKey, now).finally(() => {
    if (inFlight.get(topic) === task) inFlight.delete(topic);
  });
  inFlight.set(topic, task);
  return task;
}

function isFresh(saved: SavedReels, removed: ReadonlySet<string>, now: number): boolean {
  if ((saved.version ?? 1) !== SEARCH_VERSION) return false;
  const age = now - Date.parse(saved.searchedAt);
  if (saved.reels.length === 0) return age < EMPTY_RETRY_DAYS * DAY_MS;
  // Voted down to almost nothing: worth a new search, which skips the removed ones. A list that
  // simply found only one video is left alone until it is old.
  const left = saved.reels.filter((reel) => !removed.has(reel.videoId)).length;
  if (left < saved.reels.length && left < MIN_LEFT) return false;
  return age < FRESH_DAYS * DAY_MS;
}

/**
 * Searches and saves. At most one search per list per hour across servers, so a skill whose
 * search keeps failing (quota used up) cannot spend more each time it is opened. A failure keeps
 * the old list, if any, and saves nothing.
 */
async function lookUp(
  topic: string,
  map: SkillMap,
  node: SkillNode,
  saved: SavedReels | null,
  removed: ReadonlySet<string>,
  apiKey: string,
  now: number,
): Promise<Reel[]> {
  if (!(await claimDoc(`skill-reels-claim/${topic}/${hourStamp(now)}`, { at: new Date(now).toISOString() }))) {
    return saved?.reels ?? [];
  }
  // A job posting's title is a role ("Junior backend developer"), which finds career clips, not the skill.
  const context = map.sourceKind === "posting" ? "" : map.title;
  try {
    const reels = await searchReels(node.title, context, map.audience, apiKey, removed);
    await putDoc(listKey(topic), {
      reels,
      query: reelQuery(node.title, context, map.audience),
      searchedAt: new Date(now).toISOString(),
      version: SEARCH_VERSION,
    } satisfies SavedReels);
    return reels;
  } catch (error) {
    console.warn("[reels] YouTube search failed:", error instanceof Error ? error.message : error);
    return saved?.reels ?? [];
  }
}

/**
 * Likes or dislikes a video on a skill, or takes the vote back (0). Anyone who may open the skill
 * may vote, guests included, once per video. Only videos on the skill's saved list can be voted
 * on, so no request can write a vote for any other id.
 */
export async function voteOnReel(mapId: string, nodeId: string, videoId: string, viewerId: string, vote: Vote): Promise<VoteResult> {
  const { topic } = await resolveSkill(mapId, nodeId, viewerId);
  const saved = await getDoc<SavedReels>(listKey(topic));
  if (!saved?.reels.some((reel) => reel.videoId === videoId)) throw new HttpError("We could not find that video on this skill.", 404);

  await setVote(topic, videoId, viewerId, vote);
  const tally = (await tallyVotes(topic, viewerId)).get(videoId) ?? { likes: 0, dislikes: 0, mine: 0 };
  return { likes: tally.likes, myVote: vote, removed: isRemoved(tally) };
}

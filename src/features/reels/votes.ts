import { deleteDoc, listKeys, putDoc } from "@/shared/store";
import type { Vote } from "./types";

/** One video's votes, and the viewer's own. */
export type Tally = { likes: number; dislikes: number; mine: Vote };

/** Removed for everyone at this many dislikes, if they also outnumber the likes. */
export const REMOVE_AT_DISLIKES = 2;

const PREFIX = "skill-reel-votes/";
const SIDES = { 1: "up", [-1]: "down" } as const;

/**
 * One key per vote, `skill-reel-votes/<topicKey>/<videoId>/<up|down>/<userId>`, so voting twice
 * changes nothing, two people voting at once never race, and counting is one key listing with no
 * reads. User ids are UUIDs and video ids are 11 characters of [A-Za-z0-9_-], so neither holds a "/".
 */
const voteKey = (topic: string, videoId: string, side: "up" | "down", userId: string) => `${PREFIX}${topic}/${videoId}/${side}/${userId}`;

/**
 * Whether a video is gone from the course for everyone: at least REMOVE_AT_DISLIKES dislikes,
 * and more dislikes than likes. One person, or one cleared cookie, cannot remove a liked video.
 */
export const isRemoved = (tally: Tally | undefined) => !!tally && tally.dislikes >= REMOVE_AT_DISLIKES && tally.dislikes > tally.likes;

/** Every video's votes in one list, by video id. User ids are read here and never leave the server. */
export async function tallyVotes(topic: string, viewerId: string): Promise<Map<string, Tally>> {
  const sides = new Map<string, Map<string, Set<"up" | "down">>>();
  for (const key of await listKeys(`${PREFIX}${topic}/`)) {
    const [videoId, side, userId] = key.slice(PREFIX.length + topic.length + 1).split("/");
    if (!videoId || !userId || (side !== "up" && side !== "down")) continue;
    const byUser = sides.get(videoId) ?? new Map<string, Set<"up" | "down">>();
    sides.set(videoId, byUser.set(userId, (byUser.get(userId) ?? new Set()).add(side)));
  }

  const tallies = new Map<string, Tally>();
  for (const [videoId, byUser] of sides) {
    const tally: Tally = { likes: 0, dislikes: 0, mine: 0 };
    for (const [userId, voted] of byUser) {
      // Both at once only happens if two of one person's changes raced; it counts as neither.
      if (voted.size !== 1) continue;
      const vote: Vote = voted.has("up") ? 1 : -1;
      if (vote === 1) tally.likes++;
      else tally.dislikes++;
      if (userId === viewerId) tally.mine = vote;
    }
    tallies.set(videoId, tally);
  }
  return tallies;
}

/** Sets this person's vote on a video: like, dislike, or neither. */
export async function setVote(topic: string, videoId: string, userId: string, vote: Vote): Promise<void> {
  const writes: Promise<void>[] = [];
  for (const value of [1, -1] as const) {
    const key = voteKey(topic, videoId, SIDES[value], userId);
    writes.push(vote === value ? putDoc(key, { at: new Date().toISOString() }) : deleteDoc(key));
  }
  await Promise.all(writes);
}

/** Removes every vote this person cast, for "Delete my data". Returns how many. */
export async function deleteReelVotes(userId: string): Promise<number> {
  const mine = (await listKeys(PREFIX)).filter((key) => key.endsWith(`/${userId}`));
  await Promise.all(mine.map((key) => deleteDoc(key)));
  return mine.length;
}

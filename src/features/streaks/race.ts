import type { CircleView } from "@/features/circles";
import { edmontonDay, weekOf } from "./days";

/**
 * The circle race, worked out from what the circle page already shows: who proved how many
 * topics this week, and who proved the whole course first. It reads only circles' public view.
 */
export type RaceRow = { name: string; isYou: boolean; thisWeek: number };
export type Race = {
  /** Most topics proved this week first. */
  rows: RaceRow[];
  /** The circle's feed only holds its newest proofs, so a very busy week may count short. */
  partial: boolean;
  /** Everyone who proved every topic. */
  finished: string[];
  /** Who got there first, or null when nobody has, or the order can't be told. */
  first: string | null;
};

/** How many proofs the circle's feed holds at most. */
export const FEED_LIMIT = 30;

/** Only what the race reads from a circle's view. */
export type RaceInput = Pick<CircleView, "members" | "map"> & { feed: Pick<CircleView["feed"][number], "name" | "at">[] };

export function circleRace(view: RaceInput, now: Date): Race {
  const week = weekOf(edmontonDay(now));
  const thisWeek = view.feed.filter((item) => weekOf(edmontonDay(new Date(item.at))) === week);
  const counts = new Map<string, number>();
  for (const item of thisWeek) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);

  const rows = view.members
    .map((member) => ({ name: member.name, isYou: member.isYou, thisWeek: counts.get(member.name) ?? 0 }))
    .sort((a, b) => b.thisWeek - a.thisWeek);

  const total = view.map.nodes.length;
  const finished = view.members.filter((member) => total > 0 && member.proved >= total).map((member) => member.name);

  // Someone finished with their newest proof. The feed is newest first. Someone whose last proof
  // is no longer in the feed finished before everything in it: "" sorts first.
  const finishedAt = (name: string) => view.feed.find((item) => item.name === name)?.at ?? "";
  const ordered = [...finished].sort((a, b) => finishedAt(a).localeCompare(finishedAt(b)));
  const tooOldToTell = ordered.length > 1 && finishedAt(ordered[0]) === "" && finishedAt(ordered[1]) === "";

  return {
    rows,
    partial: view.feed.length >= FEED_LIMIT && thisWeek.length === view.feed.length,
    finished,
    first: ordered.length === 0 || tooOldToTell ? null : ordered[0],
  };
}

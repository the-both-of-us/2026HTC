/**
 * How the feed ranks, as pure functions. Everyone's events count for the shared items; the
 * viewer's own events decide what they have seen and which interests get more room.
 */

/** Counts for one item: how many different viewers did each thing. */
export type ItemStats = {
  /** On screen for 1 s or more. */
  views: number;
  /** Left within 1.5 s. */
  skips: number;
  /** Viewers who saw it at all (a view, a skip or both). */
  exposures: number;
  /** On screen for 8 s or more. */
  long: number;
  likes: number;
  saves: number;
  shares: number;
  deeper: number;
};

export const EMPTY_STATS: ItemStats = { views: 0, skips: 0, exposures: 0, long: 0, likes: 0, saves: 0, shares: 0, deeper: 0 };

/** What this viewer did with one item. */
export type ViewerMarks = { seen: boolean; liked: boolean; saved: boolean; long: boolean; skipped: boolean };

const PRIOR = 1.5;
const PRIOR_WEIGHT = 5;
const SKIP_PENALTY = 0.6;
const DWELL_BONUS = 0.8;
const EXPLORE = 0.6;
/** Seen items fall this far, so fresh ones come first. A saved item never falls. */
const SEEN_DROP = 3;

/**
 * Engagement: weighted actions per view, pulled towards a prior so one like on one view is not
 * a hit, minus a smoothed skip rate, plus a smoothed long-dwell rate.
 */
export function engagement(stats: ItemStats): number {
  const actions = 3 * stats.likes + 4 * stats.saves + 5 * stats.shares + 6 * stats.deeper;
  const base = (actions + PRIOR) / (stats.views + PRIOR_WEIGHT);
  const skipRate = (stats.skips + 1) / (stats.exposures + 4);
  const longRate = (stats.long + 0.5) / (stats.views + 4);
  return base - SKIP_PENALTY * skipRate + DWELL_BONUS * longRate;
}

/** UCB-style: items few people have seen get a boost that fades as views grow. */
export function exploreBoost(exposures: number, totalExposures: number): number {
  return EXPLORE * Math.sqrt(Math.log(totalExposures + 2) / (exposures + 1));
}

/** The item's place for this viewer. Higher comes first. */
export function itemScore(stats: ItemStats, marks: ViewerMarks | undefined, totalExposures: number): number {
  let score = engagement(stats) + exploreBoost(stats.exposures, totalExposures);
  if (marks?.seen && !marks.saved) score -= SEEN_DROP;
  return score;
}

/**
 * How much room each interest gets for this viewer: their likes, saves and long looks raise it,
 * skips lower it. Clamped, so one interest never drowns the others.
 */
export function interestWeight(marks: ViewerMarks[]): number {
  let weight = 1;
  for (const mark of marks) {
    if (mark.liked) weight += 0.5;
    if (mark.saved) weight += 0.7;
    if (mark.long) weight += 0.25;
    if (mark.skipped && !mark.liked && !mark.saved) weight -= 0.1;
  }
  return Math.min(2.5, Math.max(0.6, weight));
}

/** At most this many items in a row from one interest, while another has items left. */
const MAX_RUN = 2;

/**
 * Merges each interest's ranked queue into one feed. Each step takes the interest furthest
 * behind its weighted share, never more than MAX_RUN in a row while another one has items.
 */
export function interleave<T>(queues: { key: string; weight: number; items: T[] }[]): { key: string; item: T }[] {
  const taken = new Map(queues.map((queue) => [queue.key, 0]));
  const out: { key: string; item: T }[] = [];
  let lastKey = "";
  let run = 0;
  for (;;) {
    const open = queues.filter((queue) => (taken.get(queue.key) ?? 0) < queue.items.length);
    if (open.length === 0) return out;
    const allowed = open.length > 1 && run >= MAX_RUN ? open.filter((queue) => queue.key !== lastKey) : open;
    const next = allowed.reduce((best, queue) =>
      (taken.get(queue.key)! + 1) / queue.weight < (taken.get(best.key)! + 1) / best.weight ? queue : best,
    );
    const index = taken.get(next.key)!;
    out.push({ key: next.key, item: next.items[index] });
    taken.set(next.key, index + 1);
    run = next.key === lastKey ? run + 1 : 1;
    lastKey = next.key;
  }
}

/** A Short with 10 or more views, most of them skipped and no likes, stops showing. */
export function isRetiredShort(stats: ItemStats): boolean {
  return stats.views >= 10 && stats.skips / Math.max(stats.exposures, 1) > 0.7 && stats.likes === 0;
}

/**
 * Keeps an interest's pool to `cap` items. Only items with enough views to judge can go, and
 * never one that anyone saved: first the duds (mostly skipped, no likes), then the lowest
 * engagement until the pool fits. Returns what stays, in the pool's order, and what goes.
 */
export function rotatePool<T extends { id: string }>(
  items: T[],
  stats: Map<string, ItemStats>,
  cap: number,
  minViews = 8,
): { keep: T[]; removed: T[] } {
  const statsOf = (item: T) => stats.get(item.id) ?? EMPTY_STATS;
  const judgeable = items.filter((item) => statsOf(item).views >= minViews && statsOf(item).saves === 0);
  const removed = new Set<string>();
  for (const item of judgeable) {
    const s = statsOf(item);
    if (s.likes === 0 && s.skips / Math.max(s.exposures, 1) > 0.7) removed.add(item.id);
  }
  const weakestFirst = judgeable
    .filter((item) => !removed.has(item.id))
    .sort((a, b) => engagement(statsOf(a)) - engagement(statsOf(b)));
  for (const item of weakestFirst) {
    if (items.length - removed.size <= cap) break;
    removed.add(item.id);
  }
  return { keep: items.filter((item) => !removed.has(item.id)), removed: items.filter((item) => removed.has(item.id)) };
}

/** True when this viewer has seen most of an interest's pool, so it should grow. */
export function mostlySeen(itemIds: string[], marks: Map<string, ViewerMarks>, share = 0.7): boolean {
  if (itemIds.length === 0) return true;
  const seen = itemIds.filter((id) => marks.get(id)?.seen).length;
  return seen / itemIds.length >= share;
}

/** Gathers the dashboard from other features. Server only. */
import { isPublished } from "@/features/courses";
import { getReviewSummary, listReviewActivity, type ReviewSummary } from "@/features/review";
import { listMapsByOwner } from "@/features/skill-map";
import { listProvedNodes } from "@/features/teachback";
import type { SkillMap } from "@/shared/types";

/** Activity older than this is not sent to the browser: the streak never needs it. */
export const ACTIVITY_DAYS = 60;
export const RECENT_PROVEN = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export type CourseRow = {
  mapId: string;
  title: string;
  subtitle: string;
  provenCount: number;
  totalSkills: number;
  isPublic: boolean;
  /** "Your copy of a shared course": started from a course or joined from a study circle. */
  isCopy: boolean;
  /** The map this copy was started from, so "Start with a course" can leave that course out. */
  startedFrom: string | null;
  /** The latest proof on this map, or when it was made. */
  lastActivityAt: string;
};

export type ProvenItem = { mapId: string; nodeId: string; skillTitle: string; mapTitle: string; provenAt: string };

export type DashboardData = {
  courses: CourseRow[];
  provenTotal: number;
  recentProven: ProvenItem[];
  /** Null when review could not be read: the rest of the page still shows. */
  review: ReviewSummary | null;
  /** Proofs and reviews from the last 60 days, oldest first, for the streak. */
  activity: string[];
};

export type MapFacts = { map: SkillMap; proved: { nodeId: string; provenAt: string }[]; isPublic: boolean };

/** Puts the dashboard together from what was read. Pure, so it can be tested on its own. */
export function assembleDashboard(
  facts: MapFacts[],
  review: ReviewSummary | null,
  reviewActivity: string[],
  now: Date,
): DashboardData {
  const proven: ProvenItem[] = [];
  const courses = facts.map(({ map, proved, isPublic }): CourseRow => {
    const titles = new Map(map.nodes.map((node) => [node.id, node.title]));
    // Only skills still on the map, once each.
    const seen = new Set<string>();
    let lastActivityAt = map.createdAt;
    for (const record of proved) {
      const skillTitle = titles.get(record.nodeId);
      if (skillTitle === undefined || seen.has(record.nodeId)) continue;
      seen.add(record.nodeId);
      proven.push({ mapId: map.id, nodeId: record.nodeId, skillTitle, mapTitle: map.title, provenAt: record.provenAt });
      if (record.provenAt > lastActivityAt) lastActivityAt = record.provenAt;
    }
    return {
      mapId: map.id,
      title: map.title,
      subtitle: map.subtitle,
      provenCount: seen.size,
      totalSkills: map.nodes.length,
      isPublic,
      isCopy: Boolean(map.forkedFrom),
      startedFrom: map.forkedFrom ?? null,
      lastActivityAt,
    };
  });

  proven.sort((a, b) => b.provenAt.localeCompare(a.provenAt));
  const since = new Date(now.getTime() - ACTIVITY_DAYS * DAY_MS).toISOString();
  const activity = [...new Set([...proven.map((item) => item.provenAt), ...reviewActivity])]
    .filter((iso) => iso >= since)
    .sort();

  return { courses, provenTotal: proven.length, recentProven: proven.slice(0, RECENT_PROVEN), review, activity };
}

/** Logs a failed section and returns its fallback, so one broken read never blanks the page. */
async function orFallback<T>(promise: Promise<T>, fallback: T, what: string): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.error(`[dashboard] could not read ${what}`, error);
    return fallback;
  }
}

/** Everything the dashboard shows for this user. The maps are required; the rest degrades. */
export async function loadDashboard(userId: string, now = new Date()): Promise<DashboardData> {
  const since = new Date(now.getTime() - ACTIVITY_DAYS * DAY_MS);
  const [maps, review, reviewActivity] = await Promise.all([
    listMapsByOwner(userId),
    orFallback<ReviewSummary | null>(getReviewSummary(userId, now), null, "the review summary"),
    orFallback(listReviewActivity(userId, since), [], "review activity"),
  ]);
  const facts = await Promise.all(
    maps.map(async (map): Promise<MapFacts> => {
      const [proved, isPublic] = await Promise.all([
        orFallback(listProvedNodes(map.id, userId), [], "proven skills"),
        orFallback(isPublished(map.id), false, "whether a map is published"),
      ]);
      return { map, proved, isPublic };
    }),
  );
  return assembleDashboard(facts, review, reviewActivity, now);
}

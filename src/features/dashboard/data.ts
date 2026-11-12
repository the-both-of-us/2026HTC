/** Gathers the dashboard from other features. Server only. */
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
  /** "Your copy": joined from a study circle. */
  isCopy: boolean;
  /** The map this copy was made from, so the card shows that map's seal. */
  startedFrom: string | null;
  /** Its owner can delete it here. A course inside a program goes with the program, so it can't. */
  canDelete: boolean;
  /** The latest proof on this map, or when it was made. */
  lastActivityAt: string;
};

export type ProvenItem = {
  mapId: string;
  nodeId: string;
  skillTitle: string;
  mapTitle: string;
  provenAt: string;
  /** A pre-test pass, not an explanation: show it as "Known: passed a pre-test question". */
  pretest?: true;
};

export type DashboardData = {
  /** One row per course: your copy stands in for the course it came from. */
  courses: CourseRow[];
  provenTotal: number;
  /** Courses with at least one proof, counting a course and your copy of it once. */
  provenCourseCount: number;
  recentProven: ProvenItem[];
  /** Null when review could not be read: the rest of the page still shows. */
  review: ReviewSummary | null;
  /** Proofs and reviews from the last 60 days, oldest first, for the streak. */
  activity: string[];
};

export type MapFacts = { map: SkillMap; proved: { nodeId: string; provenAt: string; pretest?: true }[] };

/** A copy keeps its title and skills, so this also matches a copy whose original it was not made from. */
function courseKey(map: SkillMap): string {
  return JSON.stringify([map.title, map.nodes.map((node) => node.title).sort()]);
}

/** Of two copies of one course, the one with more proven, then the one used last. */
function betterCopy(a: CourseRow, b: CourseRow): CourseRow {
  if (a.provenCount !== b.provenCount) return a.provenCount > b.provenCount ? a : b;
  return a.lastActivityAt >= b.lastActivityAt ? a : b;
}

/**
 * Drops the extra rows for a course held more than once: the best copy stays, and the
 * original and other copies go. Maps with no copy all stay, even with matching titles.
 */
function onePerCourse(rows: { key: string; row: CourseRow }[]): CourseRow[] {
  const copies = new Map<string, CourseRow>();
  for (const { key, row } of rows) {
    if (!row.isCopy) continue;
    const other = copies.get(key);
    copies.set(key, other ? betterCopy(other, row) : row);
  }
  return rows.filter(({ key, row }) => (copies.get(key) ?? row) === row).map(({ row }) => row);
}

/** Puts the dashboard together from what was read. Pure, so it can be tested on its own. */
export function assembleDashboard(
  facts: MapFacts[],
  review: ReviewSummary | null,
  reviewActivity: string[],
  now: Date,
): DashboardData {
  const proven: ProvenItem[] = [];
  const rows = facts.map(({ map, proved }): { key: string; row: CourseRow } => {
    const titles = new Map(map.nodes.map((node) => [node.id, node.title]));
    // Only skills still on the map, once each.
    const seen = new Set<string>();
    let lastActivityAt = map.createdAt;
    for (const record of proved) {
      const skillTitle = titles.get(record.nodeId);
      if (skillTitle === undefined || seen.has(record.nodeId)) continue;
      seen.add(record.nodeId);
      proven.push({
        mapId: map.id,
        nodeId: record.nodeId,
        skillTitle,
        mapTitle: map.title,
        provenAt: record.provenAt,
        ...(record.pretest && { pretest: true as const }),
      });
      if (record.provenAt > lastActivityAt) lastActivityAt = record.provenAt;
    }
    const row: CourseRow = {
      mapId: map.id,
      title: map.title,
      subtitle: map.subtitle,
      provenCount: seen.size,
      totalSkills: map.nodes.length,
      isCopy: Boolean(map.forkedFrom),
      startedFrom: map.forkedFrom ?? null,
      canDelete: !map.program,
      lastActivityAt,
    };
    return { key: courseKey(map), row };
  });

  proven.sort((a, b) => b.provenAt.localeCompare(a.provenAt));
  const since = new Date(now.getTime() - ACTIVITY_DAYS * DAY_MS).toISOString();
  const activity = [...new Set([...proven.map((item) => item.provenAt), ...reviewActivity])]
    .filter((iso) => iso >= since)
    .sort();

  return {
    courses: onePerCourse(rows),
    provenTotal: proven.length,
    provenCourseCount: new Set(rows.filter(({ row }) => row.provenCount > 0).map(({ key }) => key)).size,
    recentProven: proven.slice(0, RECENT_PROVEN),
    review,
    activity,
  };
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
      const proved = await orFallback(listProvedNodes(map.id, userId), [], "proven skills");
      return { map, proved };
    }),
  );
  return assembleDashboard(facts, review, reviewActivity, now);
}

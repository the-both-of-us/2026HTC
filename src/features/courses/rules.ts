/** Plain rules with no store access, so they are easy to test. */
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import type { SkillNode } from "@/shared/types";
import { CoursesError } from "./errors";
import type { CourseListing, CourseSort } from "./types";

export const DEFAULT_AUTHOR_NAME = "Anonymous learner";
export const MAX_AUTHOR_NAME_LENGTH = 40;
export const MAX_QUERY_LENGTH = 100;
/** The name on the seeded sample courses. Learners can't publish under it. */
export const SEED_AUTHOR_NAME = "OryxLearn team";

const RESERVED_NAME =
  "That name is kept for OryxLearn's own sample courses. Please choose a different name, or leave it empty.";

/** Lower case letters and digits only, so "Oryx Learn-Team" and "oryxlearn team" compare equal. */
function nameKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * The name shown on a published course. Whitespace is collapsed and control characters
 * removed. Empty means "Anonymous learner". Longer than 40 characters is refused, and so is
 * the sample courses' name, "OryxLearn team", in any spelling: a learner's course must never
 * pass for an official one. Seeding sets that name directly, without coming through here.
 */
export function normalizeAuthorName(input: string | null | undefined): string {
  const name = (input ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return DEFAULT_AUTHOR_NAME;
  // Count characters, not UTF-16 units, so an emoji counts as one.
  if ([...name].length > MAX_AUTHOR_NAME_LENGTH) {
    throw new CoursesError(`Please keep the name to ${MAX_AUTHOR_NAME_LENGTH} characters or fewer.`, 400);
  }
  if (nameKey(name) === nameKey(SEED_AUTHOR_NAME)) throw new CoursesError(RESERVED_NAME, 400);
  return name;
}

/**
 * True when a map was built from one of the sample postings. They are fictional, so any
 * course made from one is labelled "Sample", whoever published it. Matches the way
 * skill-map finds a sample's saved output: the exact text, ignoring outer whitespace.
 */
export function isSamplePostingText(text: string | null | undefined): boolean {
  const posting = (text ?? "").trim();
  return posting !== "" && SAMPLE_POSTINGS.some((sample) => sample.text.trim() === posting);
}

/** A search query: trimmed, lower case, at most 100 characters. Empty means no filter. */
export function normalizeQuery(input: string | null | undefined): string {
  return (input ?? "").trim().slice(0, MAX_QUERY_LENGTH).toLowerCase();
}

/** True when the title, subtitle or author name contains the (normalized) query. */
export function matchesQuery(listing: CourseListing, query: string): boolean {
  if (!query) return true;
  return [listing.title, listing.subtitle, listing.authorName].some((field) =>
    field.toLowerCase().includes(query),
  );
}

/** Popular: most likes first, then newest. New: newest first. Ties fall back to the title. */
export function sortListings(listings: CourseListing[], sort: CourseSort): CourseListing[] {
  const newestFirst = (a: CourseListing, b: CourseListing) =>
    b.publishedAt.localeCompare(a.publishedAt) || a.title.localeCompare(b.title);
  const compare =
    sort === "popular"
      ? (a: CourseListing, b: CourseListing) => b.likeCount - a.likeCount || newestFirst(a, b)
      : newestFirst;
  return [...listings].sort(compare);
}

/**
 * The skills in learning order: each one comes after the skills it needs. Among skills
 * that are ready at the same time, the map's own order is kept. A prerequisite that is not
 * on the map is ignored, and any skill left over (a cycle, which validation already
 * prevents) goes at the end rather than being lost.
 */
export function learningOrder(nodes: SkillNode[]): SkillNode[] {
  const ids = new Set(nodes.map((node) => node.id));
  const placed = new Set<string>();
  const ordered: SkillNode[] = [];

  let progressed = true;
  while (progressed && ordered.length < nodes.length) {
    progressed = false;
    for (const node of nodes) {
      if (placed.has(node.id)) continue;
      const ready = node.prerequisites.every((id) => !ids.has(id) || placed.has(id));
      if (ready) {
        placed.add(node.id);
        ordered.push(node);
        progressed = true;
      }
    }
  }
  return [...ordered, ...nodes.filter((node) => !placed.has(node.id))];
}

/** Matching by proven skills, as plain functions with no store access, so they are easy to test. */
import type { Match, ProvenSkill, PublicProfile, SkillSet } from "./types";

/** Two titles with this much word overlap count as the same skill. */
export const SIMILARITY_THRESHOLD = 0.6;

/** Words that say nothing about the skill, so "SQL joins" and "SQL joins and unions" can match. */
const STOP_WORDS = new Set(["a", "an", "and", "the", "of", "for", "to", "in", "on", "with", "using", "your"]);

/**
 * Lower case, punctuation gone, spaces collapsed: "Time‑series data, cleaning!" becomes
 * "time series data cleaning". `+` and `#` become words first, so C++ and C# stay apart.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/#/g, " sharp ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A rough singular, so "SQL queries" and "SQL query writing" share "query". Short words are left alone. */
function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** The meaningful words of a title, singular. */
export function titleTokens(title: string): Set<string> {
  const words = normalizeTitle(title).split(" ").filter((word) => word && !STOP_WORDS.has(word));
  return new Set(words.map(stem));
}

/** Shared words over all words. 0 when either title has no meaningful words. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** True when two skill titles name the same skill: equal once normalised, or 60% of their words shared. */
export function skillsMatch(a: string, b: string): boolean {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return jaccard(titleTokens(a), titleTokens(b)) >= SIMILARITY_THRESHOLD;
}

/** Keeps the first of each title, ignoring case and punctuation. */
export function dedupeTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  return titles.filter((title) => {
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One entry per proven title. A copy with an evidence page wins over one without. */
export function dedupeProven(skills: ProvenSkill[]): ProvenSkill[] {
  const byKey = new Map<string, ProvenSkill>();
  for (const skill of skills) {
    const key = normalizeTitle(skill.title);
    if (!key) continue;
    const existing = byKey.get(key);
    // Replacing a value keeps its place, so the order is the order titles were first seen in.
    if (!existing || (!existing.evidenceUrl && skill.evidenceUrl)) byKey.set(key, skill);
  }
  return [...byKey.values()];
}

/**
 * Builds a skill set: proven skills deduplicated, and learning without anything already
 * proved (on this map or another, in any close wording).
 */
export function toSkillSet(proven: ProvenSkill[], learning: string[], hasMaps: boolean): SkillSet {
  const provenSkills = dedupeProven(proven);
  const stillLearning = dedupeTitles(learning).filter(
    (title) => !provenSkills.some((skill) => skillsMatch(skill.title, title)),
  );
  return { proven: provenSkills, learning: stillLearning, hasMaps };
}

/** A list of names in words: "A", "A and B", "A, B and C". */
export function listInWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Up to three names, then "and 2 more". */
function shortList(items: string[]): string {
  if (items.length <= 3) return listInWords(items);
  return `${items.slice(0, 3).join(", ")} and ${items.length - 3} more`;
}

/** Why someone matches, as sentences. */
export function matchReasons(mentorFor: string[], sharedLearning: string[], sharedProven: string[]): string[] {
  const reasons: string[] = [];
  if (mentorFor.length > 0) {
    reasons.push(`Proved ${shortList(mentorFor)}, which you're learning.`);
  }
  if (sharedLearning.length > 0) reasons.push(`Also learning ${shortList(sharedLearning)}.`);
  if (sharedProven.length > 0) reasons.push(`Also proved ${shortList(sharedProven)}, like you.`);
  return reasons;
}

/**
 * How another person matches the viewer. mentorFor counts 3, sharedLearning 2 and
 * sharedProven 1, so someone who can teach you comes first.
 */
export function matchProfile(viewer: SkillSet, other: SkillSet, profile: PublicProfile): Match {
  const viewerLearns = (title: string) => viewer.learning.some((mine) => skillsMatch(mine, title));
  const mentorFor = other.proven.map((skill) => skill.title).filter(viewerLearns);
  const sharedLearning = other.learning.filter(viewerLearns);
  const sharedProven = other.proven
    .map((skill) => skill.title)
    .filter((title) => viewer.proven.some((mine) => skillsMatch(mine.title, title)));
  return {
    profile,
    score: 3 * mentorFor.length + 2 * sharedLearning.length + sharedProven.length,
    mentorFor,
    sharedLearning,
    sharedProven,
    reasons: matchReasons(mentorFor, sharedLearning, sharedProven),
  };
}

/** Best score first, then real people before demo profiles, then name. */
export function sortMatches(matches: Match[]): Match[] {
  return [...matches].sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.profile.isDemo) - Number(b.profile.isDemo) ||
      a.profile.displayName.localeCompare(b.profile.displayName),
  );
}

/** Splits matches into the page's sections. Each person shows up once, in the first section they fit. */
export function groupMatches(matches: Match[]): { mentors: Match[]; peers: Match[]; rest: Match[] } {
  const mentors = sortMatches(matches.filter((match) => match.mentorFor.length > 0));
  const peers = sortMatches(
    matches.filter((match) => match.mentorFor.length === 0 && match.sharedLearning.length > 0),
  );
  const rest = matches.filter((match) => match.mentorFor.length === 0 && match.sharedLearning.length === 0);
  return { mentors, peers, rest };
}

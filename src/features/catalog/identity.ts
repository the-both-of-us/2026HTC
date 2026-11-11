import { createHash } from "node:crypto";
import { audienceKey } from "@/shared/audience";
import type { ProgramDepth } from "@/shared/types";
import type { AudienceKey } from "./types";

/** The audience part of every name and alias key: `audienceKey(audience)`, or "general". */
export function audKey(audience: string | undefined): AudienceKey {
  return audienceKey(audience) || "general";
}

/** Every catalog store key, so no other code spells one by hand. */
export const catalogKeys = {
  course: (courseId: string) => `catalog/courses/${courseId}`,
  program: (programId: string) => `catalog/programs/${programId}`,
  /**
   * What a program is while its frame is still being planned: `CatalogProgramSeed`, written once
   * by `claimProgram`. The final frame (`program`) is written by the planner under `startOnce`.
   */
  programSeed: (programId: string) => `catalog/program-seeds/${programId}`,
  syllabus: (courseId: string) => `catalog/syllabi/${courseId}`,
  courseNamesPrefix: (aud: AudienceKey) => `catalog/names/course/${aud}/`,
  courseName: (aud: AudienceKey, titleKey: string) => `catalog/names/course/${aud}/${titleKey}`,
  programNamesPrefix: (aud: AudienceKey, depth: ProgramDepth) => `catalog/names/program/${aud}/${depth}/`,
  programName: (aud: AudienceKey, depth: ProgramDepth, titleKey: string) =>
    `catalog/names/program/${aud}/${depth}/${titleKey}`,
  courseAlias: (aud: AudienceKey, hash: string) => `catalog/alias/course/${aud}/${hash}`,
  programAlias: (aud: AudienceKey, depth: ProgramDepth, hash: string) => `catalog/alias/program/${aud}/${depth}/${hash}`,
} as const;

const DROPPED = new Set(["a", "an", "the", "of", "to", "for", "in", "on", "and", "with"]);

/**
 * Lowercase, accents stripped, `&` to "and", non-alphanumerics to spaces, drops
 * {a, an, the, of, to, for, in, on, and, with}, joined with "-", at most 80 characters.
 */
export function titleKey(title: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word !== "" && !DROPPED.has(word));
  return words.join("-").slice(0, 80).replace(/-+$/, "");
}

/** The first 16 hex characters of sha256(titleKey(text)). Raw request text is never stored. */
export function aliasHash(text: string): string {
  return createHash("sha256").update(titleKey(text)).digest("hex").slice(0, 16);
}

/** Words that say how a course is pitched, not what it is about: they never make two titles similar. */
const NOT_SUBJECT = new Set(["intro", "introduction", "introductory", "foundations", "fundamentals", "basics", "principles", "course", "program", "degree", "101"]);

/** The subject words of a title, for scoring candidates. */
export function subjectTokens(text: string): Set<string> {
  return new Set(
    titleKey(text)
      .split("-")
      .filter((word) => word !== "" && !NOT_SUBJECT.has(word)),
  );
}

/** Word-set Jaccard of two titles (stop words dropped), for the near-duplicate checks. */
export function titleJaccard(a: string, b: string): number {
  const left = new Set(titleKey(a).split("-").filter(Boolean));
  const right = new Set(titleKey(b).split("-").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let both = 0;
  for (const word of left) if (right.has(word)) both += 1;
  return both / (left.size + right.size - both);
}

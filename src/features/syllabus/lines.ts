import { z } from "zod";
import {
  SYLLABUS_LIMITS,
  SYLLABUS_SHAPE,
  type CourseSyllabus,
  type SyllabusOutcome,
  type SyllabusTopic,
  type SyllabusUnit,
} from "@/shared/types";
import type { SyllabusContext } from "./types";

/*
 * A syllabus arrives as JSON Lines: one head, then one line per unit. Each line is fixed or
 * rejected on its own, and a committed unit is final (its ids and topics never change), so it can
 * be saved and shown at once. Units are numbered u1, u2, ... in the order they are committed.
 */

const topicLine = z.object({
  id: z.string().default(""),
  title: z.string().default(""),
  objectives: z.array(z.string()).default([]),
  keyTerms: z.array(z.string()).default([]),
  inScope: z.string().default(""),
  outOfScope: z.string().default(""),
  buildsOn: z.array(z.string()).default([]),
});

export const syllabusHeadLine = z.object({
  kind: z.literal("head"),
  outcomes: z.array(z.object({ id: z.string().default(""), text: z.string().default("") })).default([]),
});

export const syllabusUnitLine = z.object({
  kind: z.literal("unit"),
  id: z.string().default(""),
  title: z.string().default(""),
  outcomeIds: z.array(z.string()).default([]),
  topics: z.array(topicLine).default([]),
});

/** One line of a syllabus reply, lenient on purpose: the builder does the real checks. */
export const syllabusLine = z.discriminatedUnion("kind", [syllabusHeadLine, syllabusUnitLine]);
export type SyllabusLine = z.infer<typeof syllabusLine>;
type UnitLine = z.infer<typeof syllabusUnitLine>;

/** A topic whose title overlaps a sibling course's topic this much (word Jaccard) is dropped. */
export const SIBLING_TOPIC_OVERLAP = 0.8;
/** A syllabus with fewer units than this after the repair is not accepted. */
export const MIN_UNITS = 6;
/** Usable topics a unit needs, and at most this many are kept. */
const TOPICS = SYLLABUS_SHAPE.degree.topicsPerUnit;
const MAX_OBJECTIVES = SYLLABUS_LIMITS.objectivesPerTopic.max;
const MAX_KEY_TERMS = SYLLABUS_LIMITS.keyTermsPerTopic.max;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const text = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);
function list(values: string[], max: number, cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const v = text(value, max);
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out.slice(0, cap);
}

const STOP = new Set(["the", "and", "for", "with", "into", "from", "how", "what", "why", "its", "their", "are", "that", "this", "of", "to", "in", "on", "an", "a", "as", "or", "vs"]);

/** The content words of a title. */
export function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1 && !STOP.has(word)),
  );
}

/** Size of the intersection over size of the union. Two empty sets share nothing, so 0. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const word of a) if (b.has(word)) both += 1;
  return both / (a.size + b.size - both);
}

export type HeadResult = { ok: true; outcomes: SyllabusOutcome[] } | { ok: false; problem: string };
export type UnitResult = { ok: true; unit: SyllabusUnit } | { ok: false; problem: string };

/** Turns lines into committed units, one at a time, and the final syllabus at the end. */
export class SyllabusBuilder {
  outcomes: SyllabusOutcome[] | null = null;
  readonly units: SyllabusUnit[] = [];
  private readonly outcomeIds = new Map<string, string>();
  private readonly topicIds = new Set<string>();
  private readonly rawUnitIds = new Set<string>();
  private readonly earlierRefs: Set<string>;
  private readonly siblingTitles: Set<string>[];

  constructor(private readonly ctx: SyllabusContext) {
    this.earlierRefs = new Set(
      ctx.required.flatMap((syllabus) => syllabus.units.flatMap((unit) => unit.topics.map((topic) => `${syllabus.courseSlug}:${topic.id}`))),
    );
    this.siblingTitles = ctx.siblings.flatMap((sibling) => (sibling.slug === ctx.course.slug ? [] : sibling.topics.map(titleWords)));
  }

  get hasHead(): boolean {
    return this.outcomes !== null;
  }

  /** The head: 4 to 6 outcomes (more are cut to 6). Fewer than 4 is a problem (one restart). */
  head(line: z.infer<typeof syllabusHeadLine>): HeadResult {
    const outcomes: SyllabusOutcome[] = [];
    const map = new Map<string, string>();
    for (const raw of line.outcomes) {
      const value = text(raw.text, 200);
      if (!value || outcomes.length === SYLLABUS_LIMITS.outcomes.max) continue;
      const id = `o${outcomes.length + 1}`;
      if (raw.id.trim()) map.set(raw.id.trim(), id);
      outcomes.push({ id, text: value });
    }
    if (outcomes.length < SYLLABUS_LIMITS.outcomes.min) {
      return { ok: false, problem: `The head needs ${SYLLABUS_LIMITS.outcomes.min} to ${SYLLABUS_LIMITS.outcomes.max} outcomes, but had ${outcomes.length}.` };
    }
    this.outcomes = outcomes;
    for (const [from, to] of map) this.outcomeIds.set(from, to);
    return { ok: true, outcomes };
  }

  /**
   * One unit line. Fixes: topics cut to 6, objectives to 3, key terms to 6; buildsOn kept only
   * for committed topics or earlier-course topics that exist; unknown outcome ids dropped; a topic
   * that repeats a sibling course's topic (or this course's) dropped. Rejects: no head yet, all
   * units already in, a unit id already used, or fewer than 4 usable topics. A committed unit is final.
   */
  unit(line: UnitLine): UnitResult {
    if (!this.outcomes) return { ok: false, problem: "A unit came before the head." };
    if (this.units.length >= SYLLABUS_SHAPE.degree.units) return { ok: false, problem: "All units are already in." };
    const rawId = line.id.trim().toLowerCase();
    if (rawId && this.rawUnitIds.has(rawId)) return { ok: false, problem: `The unit id "${rawId}" was already used.` };
    const title = text(line.title, 80);
    if (!title) return { ok: false, problem: "A unit had no title." };

    const inUnit = new Set<string>();
    const topics: SyllabusTopic[] = [];
    const ownTitles = this.units.flatMap((unit) => unit.topics.map((topic) => titleWords(topic.title)));
    for (const raw of line.topics) {
      if (topics.length === TOPICS.max) break;
      const id = raw.id.trim().toLowerCase();
      const topicTitle = text(raw.title, 100);
      if (!SLUG.test(id) || !topicTitle || this.topicIds.has(id) || inUnit.has(id)) continue;
      const objectives = list(raw.objectives, 200, MAX_OBJECTIVES);
      const keyTerms = list(raw.keyTerms, 60, MAX_KEY_TERMS);
      if (objectives.length === 0 || keyTerms.length === 0) continue;
      const words = titleWords(topicTitle);
      const repeats = [...this.siblingTitles, ...ownTitles, ...topics.map((t) => titleWords(t.title))].some(
        (other) => jaccard(words, other) >= SIBLING_TOPIC_OVERLAP,
      );
      if (repeats) continue;
      const buildsOn = [...new Set(raw.buildsOn.map((ref) => ref.trim()).filter(Boolean))].filter((ref) =>
        ref.includes(":") ? this.earlierRefs.has(ref) : this.topicIds.has(ref) || inUnit.has(ref),
      );
      inUnit.add(id);
      topics.push({
        id,
        title: topicTitle,
        objectives,
        keyTerms,
        inScope: text(raw.inScope, 240),
        outOfScope: text(raw.outOfScope, 240),
        buildsOn,
      });
    }
    if (topics.length < TOPICS.min) {
      return { ok: false, problem: `Unit "${title}" had ${topics.length} usable topics; it needs ${TOPICS.min} to ${TOPICS.max}.` };
    }

    const known = new Set(this.outcomes.map((outcome) => outcome.id));
    const outcomeIds = [
      ...new Set(line.outcomeIds.map((id) => this.outcomeIds.get(id.trim()) ?? id.trim()).filter((id) => known.has(id))),
    ];
    const unit: SyllabusUnit = { id: `u${this.units.length + 1}`, title, outcomeIds, built: false, topics };
    if (rawId) this.rawUnitIds.add(rawId);
    for (const topic of topics) this.topicIds.add(topic.id);
    this.units.push(unit);
    return { ok: true, unit };
  }

  /** Unit ids still missing, such as ["u7", "u8"]. */
  missing(): string[] {
    const ids: string[] = [];
    for (let n = this.units.length + 1; n <= SYLLABUS_SHAPE.degree.units; n++) ids.push(`u${n}`);
    return ids;
  }

  /** The head and committed units so far, as a planning syllabus (for unit 1's build while the rest streams). */
  current(): CourseSyllabus {
    return { ...this.base(this.outcomes ?? []), planning: true, units: this.units.map((unit) => ({ ...unit })) };
  }

  /**
   * The final syllabus, or null with fewer than MIN_UNITS units. Outcomes no unit serves are
   * removed (ids kept, so units still point at the right ones).
   */
  finish(): CourseSyllabus | null {
    if (!this.outcomes || this.units.length < MIN_UNITS) return null;
    const served = new Set(this.units.flatMap((unit) => unit.outcomeIds));
    const outcomes = this.outcomes.filter((outcome) => served.has(outcome.id));
    return { ...this.base(outcomes.length > 0 ? outcomes : this.outcomes), units: this.units.map((unit) => ({ ...unit })) };
  }

  /** The fixed fields every version of this syllabus has. */
  base(outcomes: SyllabusOutcome[]): CourseSyllabus {
    const shape = SYLLABUS_SHAPE.degree;
    return {
      version: 1,
      rootMapId: this.ctx.courseId,
      depth: "degree",
      courseSlug: this.ctx.course.slug,
      ...(this.ctx.course.level ? { level: this.ctx.course.level } : {}),
      outcomes,
      units: [],
      assessment: { unitTests: shape.unitTests, finalQuestions: shape.finalQuestions },
    };
  }
}

/**
 * The shared catalog: canonical topic courses and programs, generated once and reused by everyone.
 * Canonical documents hold no owner id, no source text and no personal data: only what the model
 * wrote for a subject and audience. Postings and PDFs never enter the catalog.
 *
 * Store keys (`aud` is `audienceKey(audience)`, or "general" for a general or adult learner):
 * - `catalog/courses/<courseId>`                                   CatalogCourse
 * - `catalog/programs/<programId>`                                 CatalogProgram (final frame, guarded by `startOnce`)
 * - `catalog/syllabi/<courseId>`                                   CourseSyllabus, final, never rewritten
 * - `catalog/names/course/<aud>/<titleKey(title)>`                 CatalogNameEntry `{ courseId }`, claimDoc, first wins
 * - `catalog/names/program/<aud>/<titleKey(title)>`                CatalogNameEntry `{ programId }`
 * - `catalog/alias/course/<aud>/<aliasHash(text)>`                 CatalogNameEntry `{ courseId }`, claimed before generation
 * - `catalog/alias/program/<aud>/<aliasHash(text)>`                CatalogNameEntry `{ programId }`
 * While a canonical key K is being written, `partial/K` holds its parts (see `@/shared/store/once`):
 * ProgramPart for a program frame, SyllabusPart for a syllabus.
 */
import type {
  CourseLevel,
  CourseSyllabus,
  SyllabusOutcome,
  SyllabusUnit,
} from "@/shared/types";

/** `audienceKey(audience)`, or "general". Part of every name and alias key: Grade 1 math is not university math. */
export type AudienceKey = string;

/** One canonical course. `courseId` is a `randomUUID()` and never a map id. */
export type CatalogCourse = {
  id: string;
  title: string;
  /** One sentence on what the learner can do after it. */
  summary: string;
  /** Who it is pitched at, such as "Grade 1 students (about 6 years old)"; "" for a general or adult learner. */
  audience: string;
  level?: CourseLevel;
  area?: string;
  /** The program whose context its syllabus is built in. Absent for a course first asked for alone. */
  homeProgramId?: string;
  /** Its slug in the home program. Set together with homeProgramId. */
  homeSlug?: string;
  createdAt: string;
};

/** One course line of a canonical program. */
export type CatalogProgramCourse = {
  /** kebab-case, unique within the program. */
  slug: string;
  title: string;
  summary: string;
  /** Slugs of earlier courses (an earlier term for a degree). */
  requires: string[];
  year?: 1 | 2 | 3 | 4;
  term?: 1 | 2;
  level?: CourseLevel;
  area?: string;
  /** Set once the line is registered (matched to an existing course or created). Start needs it. */
  courseId?: string;
};

/** One canonical program. Learner Programs point at it with `catalogId`. */
export type CatalogProgram = {
  id: string;
  title: string;
  summary: string;
  audience: string;
  /** The stored doc is always "ready" (the final frame). "planning" exists only on a read assembled from the partial doc. */
  status: "planning" | "ready";
  courses: CatalogProgramCourse[];
  createdAt: string;
};

/**
 * `catalog/program-seeds/<programId>`: what is known of a program before its frame is planned,
 * from the resolution. Written once by `claimProgram`; the planner plans from it (never from the
 * learner's own words, which are not stored).
 */
export type CatalogProgramSeed = {
  id: string;
  title: string;
  summary: string;
  audience: string;
  createdAt: string;
};

/**
 * `readCatalogProgram(id)`: the program and where its frame stands.
 * - "ready": the final frame.
 * - "planning": a live claim is writing it; `program` is assembled from the parts so far.
 * - "stalled": no final frame and no live claim (never started, failed or died); `program` is the seed.
 */
export type CatalogProgramRead = { state: "ready" | "planning" | "stalled"; program: CatalogProgram };

/** What a name or alias key holds: exactly one of the two ids. */
export type CatalogNameEntry = { courseId: string } | { programId: string };

/**
 * Parts of a program frame while it streams (`partial/catalog/programs/<id>`), in order.
 * "registered" arrives later than its course line, once the resolver set the line's courseId.
 */
export type ProgramPart =
  | { kind: "head"; title: string; summary: string }
  | { kind: "course"; course: CatalogProgramCourse }
  | { kind: "registered"; slug: string; courseId: string };

/**
 * Parts of a syllabus while it streams (`partial/catalog/syllabi/<courseId>`), in order: one head,
 * then committed units. Committed units are final: their ids and topics never change. Units have
 * `built: false`; `built` on a learner's attached syllabus comes from the learner's own nodes.
 */
export type SyllabusPart =
  | {
      kind: "head";
      outcomes: SyllabusOutcome[];
      /** The fixed fields of the final syllabus, known before any unit. */
      courseSlug: string;
      level?: CourseLevel;
      assessment: CourseSyllabus["assessment"];
    }
  | { kind: "unit"; unit: SyllabusUnit };

/**
 * `readCatalogSyllabus(courseId)`: the final syllabus, or one assembled from the partial doc with
 * `planning: true` (units committed so far, possibly none), or "idle" when neither exists and no
 * claim is live (never started, failed, or died).
 */
export type CatalogSyllabusRead =
  | { state: "ready"; syllabus: CourseSyllabus }
  | { state: "planning"; syllabus: CourseSyllabus }
  | { state: "idle" };

/** What the resolver is asked: the learner's words and the audience decided in code before any call. */
export type ResolveRequest = {
  /** The learner's request text. Never stored, not even in a key (only its aliasHash is). */
  text: string;
  /** `cleanAudience(inferAudience(text))`, decided in code. "" means general. */
  audience: string;
  /** Epoch ms by which the resolve must be done. The check call is skipped if it cannot fit. */
  deadline: number;
};

/**
 * What a resolve returns. "found": an existing canonical entry, the alias for this phrasing is
 * claimed. "new": nothing matched; `title` and `summary` name the new entry (subject only, never
 * a person), and the caller claims the alias with a new id (`claimCourse` / `claimProgram`).
 */
export type CourseResolution =
  | { status: "found"; courseId: string }
  | { status: "new"; title: string; summary: string };

export type ProgramResolution =
  | { status: "found"; programId: string }
  | { status: "new"; title: string; summary: string };

/** Shape "auto": one call over program and course candidates; `broad` says whether a program fits. */
export type AutoResolution =
  | { shape: "program"; resolution: ProgramResolution }
  | { shape: "course"; resolution: CourseResolution };

/**
 * `claimCourse` / `claimProgram` result. `created` is true when this request's new id won the
 * alias claim (so it must generate); false when another request got there first and `id` is theirs.
 */
export type CatalogClaim = { id: string; created: boolean };

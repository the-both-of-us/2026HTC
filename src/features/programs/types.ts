import type { CourseLevel, SourceKind } from "@/shared/types";

export type { CourseLevel } from "@/shared/types";

/** One course in a program. Its map is built the first time the learner opens it. */
export type ProgramCourse = {
  /** kebab-case, unique within the program */
  slug: string;
  title: string;
  /** One sentence on what the learner can do after it. */
  summary: string;
  /** Slugs of earlier courses that open this one. */
  requires: string[];
  mapId?: string;
  /*
   * Absent on programs planned before the degree frame, which show one flat list. Code checks
   * them when the frame is planned: requires points to an earlier term only, and the
   * level never goes down from one year to the next.
   */
  /** Year 1 to 4. */
  year?: 1 | 2 | 3 | 4;
  /** Term 1 or 2 of that year. */
  term?: 1 | 2;
  /** Our planning label, not a university's course number. */
  level?: CourseLevel;
  /** Subject area, such as "Research methods" or "Social". Groups courses for the area rules. */
  area?: string;
  /** @deprecated Wave 1 drafts. Never written now: a catalog course's syllabus is at `catalog/syllabi/<courseId>`. */
  hasSyllabus?: boolean;
  /**
   * Wave 2: the canonical catalog course (`catalog/courses/<courseId>`). Absent while the course
   * line is not registered yet; the course cannot be started until it is set. On a stored Program
   * with `catalogId`, courses keep only `{slug, mapId?}`: `getProgram` merges the rest (title,
   * summary, requires, year, term, level, area, courseId) from the catalog program.
   */
  courseId?: string;
};

/** Stored at programs/<id>. ownerId never leaves the server. */
export type Program = {
  id: string;
  ownerId: string;
  title: string;
  summary: string;
  sourceKind: Exclude<SourceKind, "pdf">;
  sourceText: string;
  /** Who the program is pitched at, such as "Grade 1 students (about 6 years old)". Every course inherits it. */
  audience?: string;
  courses: ProgramCourse[];
  createdAt: string;
  /**
   * Wave 2: the canonical catalog program (`catalog/programs/<catalogId>`) this learner program
   * follows. Set on every topic program; title, summary, audience and the course list come
   * from it (see ProgramCourse.courseId). Two learners of the same program share one catalogId.
   */
  catalogId?: string;
};

/** "How broad should this be?" from the landing toggle. Auto lets the model decide. */
export type ProgramShape = "auto" | "program" | "course";

export type CourseState = "locked" | "open" | "done";

/**
 * Where a unit test or a course final stands for this learner. "locked" until its topics are
 * proved (every topic of the unit, or of the course), then "open" until it is passed.
 */
export type AssessmentState = "locked" | "open" | "passed";

/** One syllabus unit as the program page and the map's unit rail show it. */
export type UnitSummary = {
  /** "u1", "u2" and so on. */
  id: string;
  /** 1-based. */
  number: number;
  title: string;
  /** Topics the syllabus plans for this unit. */
  plannedTopics: number;
  /** True once its nodes are in the map. */
  built: boolean;
  /** Topics of this unit the learner proved. */
  proved: number;
  /** Unit k+1 opens once half of unit k is proved. "done" means every topic is proved and its test (if any) passed. */
  state: CourseState;
  /** The unit test, or null when the course has none. */
  test: AssessmentState | null;
};

/**
 * One reading-time figure. Every number is computed in code: never from the model.
 * - planned: planned topics x target lesson words / 200 words a minute;
 * - written: words of the lessons actually written / 200 words a minute;
 * - measured: the sum of gaps under 10 minutes between this learner's attempt timestamps.
 */
export type HoursFigure = {
  kind: "planned" | "written" | "measured";
  /** Hours, rounded to one decimal. Null when there is nothing to compute from yet. */
  hours: number | null;
  /** Set when the figure is a range (courses with no syllabus yet plan 4 to 6 topics a unit). */
  hoursMax?: number;
  /** The word shown next to the number: "planned", "written" or "measured". */
  label: string;
  /** One sentence on how it was computed, for a footnote. */
  basis: string;
};

export type HoursBreakdown = { planned: HoursFigure; written: HoursFigure; measured: HoursFigure };

/** Practice is shown as counts of items, never as minutes. Computed from planned topics and the fixed per-topic numbers. */
export type PracticeCounts = {
  /** One teach-back per topic. */
  teachBacks: number;
  /** Topics x the quiz's fixed question count. */
  quizQuestions: number;
  /** Topics x the lesson's practice cases (0 for a young reader's shorter lessons). */
  practiceCases: number;
  /** Units x the unit test's question count. */
  unitTestQuestions: number;
  /** Course finals x their question count. */
  finalQuestions: number;
};

/** One course as the program page shows it. */
export type CourseView = {
  slug: string;
  number: number;
  title: string;
  summary: string;
  mapId: string | null;
  proven: number;
  /** Topics in the course, or null before it is built. */
  total: number | null;
  state: CourseState;
  /** The course badge: its final interview was passed. Proving every topic opens that interview. */
  badge: boolean;
  /** What stands between a locked course and opening it. */
  blockers: { title: string; needed: number | null }[];
  /*
   * Added with syllabi. All optional: a view without them is an older program, shown as before.
   */
  year?: 1 | 2 | 3 | 4;
  term?: 1 | 2;
  level?: CourseLevel;
  area?: string;
  /**
   * Wave 2: false while this course line is still being registered in the catalog (no courseId
   * yet), so its Start button stays off. Absent means it can be started (older views).
   */
  startable?: boolean;
  /** Topics the syllabus plans, across all units. Absent before a syllabus exists: then show `total`, or no count. */
  plannedTopics?: number;
  /** True once a syllabus (draft or on the map) exists, so the page can link to it. */
  hasSyllabus?: boolean;
  /** The syllabus units, in order. Absent for a course with no syllabus. */
  units?: UnitSummary[];
  /** The course final. Absent on older views; "passed" equals `badge`. */
  final?: AssessmentState;
};

/** What a browser gets: no ownerId, no source text. */
export type ProgramView = {
  id: string;
  title: string;
  summary: string;
  sourceKind: Program["sourceKind"];
  courses: CourseView[];
  /** Reading time for the whole program, computed in code, each figure with its label. */
  hours?: HoursBreakdown;
  /** Wave 2: where planning of the course list stands. Absent on a program planned before wave 2 (ready). */
  planning?: ProgramPlanning;
};

/**
 * Wave 2: the program's course list as it streams in. Counts only; every number is real.
 * - "planning": a live claim is writing course lines. Poll again in 1.5 s.
 * - "ready": the frame is final. Stop polling once every course is also `startable`.
 * - "stalled": no final frame and no live claim (the writer failed or died). The page offers
 *   "Try again", which is `POST /api/programs/[id]/plan`.
 */
export type ProgramPlanning = {
  state: "planning" | "ready" | "stalled";
  /** Course lines committed so far. */
  planned: number;
  /** Always DEGREE_FRAME.courses (40). */
  expected: number;
};

/** A number from a published source, shown beside ours. Lives in programs/norms.ts. */
export type SourcedNorm = {
  /** Stable key, such as "calgary-ba-courses". */
  id: string;
  /** What it counts, in a short phrase: "Courses in a Calgary BA (Psychology)". */
  label: string;
  value: number;
  /** Upper end when the source gives a range, such as 15 to 20 psychology courses. */
  valueMax?: number;
  /** "courses", "hours", "chapters". */
  unit: string;
  /** Who published it: "University of Calgary". */
  source: string;
  url: string;
  /** ISO date the page was read, such as "2026-11-11". */
  retrievedOn: string;
  /** Set when the number is our arithmetic on sourced numbers: says how, such as "120 units / 3 units a course". */
  derived?: string;
};

/** A published course outline to set our unit titles beside, such as the OpenStax Psychology 2e chapters. */
export type SourcedReference = {
  title: string;
  url: string;
  retrievedOn: string;
  /** Chapter or section titles, in order. */
  items: string[];
};

/** One course of ours set beside a typical university course. */
export type CourseComparison = {
  slug: string;
  title: string;
  /** Our unit titles in order, or the topic titles of a course with no units. */
  unitTitles: string[];
  topics: { planned: number | null; built: number; proved: number };
  hours: HoursBreakdown;
  practice: PracticeCounts;
  /** A sourced outline for the same subject, or null when we know none. Never a match score. */
  reference: SourcedReference | null;
};

/**
 * What `GET /api/programs/[id]/comparison` returns: our computed numbers next to sourced
 * university norms. There is no match score, and `notEquivalent` is always shown.
 */
export type ComparisonView = {
  programId: string;
  programTitle: string;
  ours: {
    courses: number;
    coursesBuilt: number;
    /** Planned units across the program: null when a course has no syllabus yet and no shape to count from. */
    units: { planned: number | null; built: number };
    topics: { planned: number | null; built: number; proved: number };
    hours: HoursBreakdown;
    practice: PracticeCounts;
  };
  /** The first course (or the one asked for), compared on its own. Null before any course is built. */
  course: CourseComparison | null;
  norms: SourcedNorm[];
  /** Always NOT_EQUIVALENT. */
  notEquivalent: readonly string[];
};

/** The "Not equivalent" box. Shown every time a comparison is shown, word for word. */
export const NOT_EQUIVALENT = [
  "No accreditation and no transfer credit.",
  "No labs, thesis, proctored exams or instructor.",
  "The lessons, questions and grading are written by AI.",
  "Levels 100 to 400 are our planning labels, not a university's course numbers.",
] as const;

/** One planned topic on the syllabus page. Objectives and key terms are not an answer key, so they are shown. */
export type SyllabusTopicView = {
  id: string;
  title: string;
  objectives: string[];
  keyTerms: string[];
  inScope: string;
  outOfScope: string;
  /** Resolved for display: a topic earlier in this course, or one in an earlier course. */
  buildsOn: { title: string; courseTitle: string | null }[];
  /** True once its node is in the map. */
  built: boolean;
  proved: boolean;
};

export type SyllabusUnitView = UnitSummary & {
  /** Texts of the course outcomes this unit serves. */
  outcomes: string[];
  topics: SyllabusTopicView[];
};

/**
 * What `GET /api/programs/[id]/courses/[slug]/syllabus` returns, and what the page
 * `/program/[id]/courses/[slug]` renders as a plain printed-calendar syllabus.
 */
export type SyllabusView = {
  programId: string;
  programTitle: string;
  course: {
    slug: string;
    number: number;
    title: string;
    summary: string;
    year?: 1 | 2 | 3 | 4;
    term?: 1 | 2;
    level?: CourseLevel;
    area?: string;
    /** Courses this one requires, by title. */
    requires: { slug: string; title: string }[];
    /** Null before the course is started. */
    mapId: string | null;
  };
  /** "none": no syllabus yet (it is written when the course is started). "draft": written, unit 1 not on the map yet. "built": unit 1 is on the map. */
  status: "none" | "draft" | "built";
  /** Wave 2: true while the catalog syllabus is still being written (units so far only; poll again). */
  planning?: boolean;
  outcomes: { id: string; text: string }[];
  units: SyllabusUnitView[];
  assessment: {
    unitTests: boolean;
    unitTestQuestions: number;
    unitTestPassMark: number;
    finalQuestions: number;
    finalPassMark: number;
    final: AssessmentState;
  };
  hours: HoursBreakdown;
  practice: PracticeCounts;
};

/*
 * Routes. Paths and shapes are fixed here; each handler parses input and calls a programs
 * function. Every request makes at most one model call plus one repair call, and every
 * per-request timeout (repair included) fits the route's 120 s maxDuration.
 */

/**
 * `POST /api/programs`. Wave 2:
 * - `kind: "posting"` (and PDFs, through `/api/maps/pdf`) always builds one private map, whatever
 *   `shape` says: reply 201 `{ mapId }`. The program shape is for topics only.
 * - A topic resolves through the catalog first (at most one check call), so the reply comes in
 *   about 2 s: 201 `{ programId }` for a program (the frame streams in `after()`; poll
 *   `GET /api/programs/[id]`), or 201 `{ mapId }` for one course (its syllabus streams in
 *   `after()`; poll `GET /api/maps/[id]`).
 * - A program is always a full degree: 40 courses in 4 years of 2 terms.
 * Errors: 400/422 with `{ error }`, a sentence.
 */
export type CreateProgramRequest = {
  text: string;
  kind?: "posting" | "topic";
  shape?: ProgramShape;
};

/** `POST /api/programs` reply 201. */
export type CreateProgramResponse = { programId: string } | { mapId: string };

/**
 * `GET /api/programs/[id]` (new). The program page polls it every 1.5 s while
 * `program.planning.state` is "planning" or a course is not `startable`. No model call.
 * 200 `ProgramPollResponse`, 404 `{ error }` when the program is not the viewer's.
 */
export type ProgramPollResponse = { program: ProgramView };

/**
 * `POST /api/programs/[id]/plan` (new, no body). Owner only (404 otherwise). Restarts planning
 * of a stalled program: 202 `{ status: "planning" }` once the frame is being written (also when
 * another request already is), 200 `{ status: "ready" }` when the frame is already final.
 */
export type ResumePlanningResponse = { status: "planning" } | { status: "ready" };

/**
 * `POST /api/programs/[id]/courses/[slug]` (no body). Wave 2: opening a course makes zero model
 * calls in the request. It claims `program-courses/<programId>/<slug>`, creates the learner map
 * with `courseId` and `nodes: []`, saves its mapId on the program, starts the canonical syllabus
 * (and unit 1) in `after()`, and replies 200 `{ status: "ready", mapId }` at once. The map page
 * then polls `GET /api/maps/[id]` while its syllabus is `planning`.
 * 202 `{ status: "building", building: true }` while another request holds the course claim: ask
 * again shortly. Locked: 409. Not yours, or no courseId yet: 404 / 409 with `{ error }`.
 */
export type OpenCourseResponse =
  | { status: "ready"; mapId: string }
  | { status: "building"; building: true };

/** What `openCourse` returns; the route adds `building: true` on 202. */
export type OpenCourseResult = { status: "ready"; mapId: string } | { status: "building" };


/**
 * `POST /api/maps/[id]/units/[unitId]` (no body). Wave 2: zero model calls in the request.
 * - The canonical cache `unit-nodes/<contentIdOf(map)>/<unitId>` holds the unit: it is appended
 *   to the learner map and the reply is 200 `{ status: "ready", mapId, unitId }` (also when the
 *   map already had it).
 * - A claim on that cache is live: 202 `{ status: "building", building: true }`.
 * - Otherwise the canonical build starts in `after()` (and, for a course map whose syllabus is
 *   neither final nor being written, the syllabus build restarts first): 202 as above.
 * The client asks again every 2 s. 409 while unit k-1 is less than half proved, 404 for a map
 * that is not the viewer's or a unit its syllabus does not have (yet).
 */
export type StartUnitResponse =
  | { status: "ready"; mapId: string; unitId: string }
  | { status: "building"; building: true };

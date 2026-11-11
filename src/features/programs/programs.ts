import { randomUUID } from "node:crypto";
import {
  claimCourse,
  claimProgram,
  getCatalogCourse,
  getFinalSyllabus,
  readCatalogProgram,
  readCatalogSyllabus,
  resolveAuto,
  resolveCourse,
  resolveProgram,
  type CatalogCourse,
  type CourseResolution,
  type ProgramResolution,
} from "@/features/catalog";
import { lessonWordCounts, targetWords, wantsPractice } from "@/features/lessons";
import {
  checkPostingText,
  checkTopicText,
  contentIdOf,
  generateSkillMap,
  generateUnit,
  getSkillMap,
  isUnitBuilt,
  saveSkillMap,
  unitRail,
  unitStartRule,
  type UnitRailItem,
} from "@/features/skill-map";
import { activityTimes, getPassedFinal, getPassedUnitTests, getProgress } from "@/features/teachback";
import { cleanAudience, inferAudience } from "@/shared/audience";
import { HttpError } from "@/shared/http";
import {
  SYLLABUS_SHAPE,
  type CourseSyllabus,
  type MapProgress,
  type NodeState,
  type ProgramDepth,
  type ProgramLink,
  type SkillMap,
} from "@/shared/types";
import { hoursBreakdown, type CourseFacts } from "./hours";
import { deadlineFrom, scheduleCourseBuild, scheduleNextCourse, scheduleProgramPlanning } from "./pregen";
import {
  claimCourse as claimProgramCourse,
  getCourseClaim,
  getProgramWithPlanning,
  getStoredProgram,
  releaseCourse,
  saveCourseMapId,
  saveProgram,
  withClaims,
} from "./storage";
import type {
  AssessmentState,
  CourseView,
  OpenCourseResult,
  Program,
  ProgramCourse,
  ProgramPlanning,
  ProgramShape,
  ProgramView,
  ResumePlanningResponse,
  UnitSummary,
} from "./types";
import { courseStates } from "./unlock";

/**
 * The audience every course inherits. A program saved before audiences existed uses the
 * grade or age its title or topic plainly names, so its courses not yet built still benefit.
 */
export function programAudience(program: Pick<Program, "audience" | "title" | "sourceText" | "sourceKind">): string {
  if (program.audience !== undefined) return program.audience;
  if (program.sourceKind === "posting") return "";
  return inferAudience(`${program.title} ${program.sourceText}`);
}

/** Where the course at `index` sits in its program, for the map header. */
export function programLink(program: Pick<Program, "id" | "title" | "courses">, index: number): ProgramLink {
  const slug = program.courses[index].slug;
  return {
    id: program.id,
    title: program.title,
    courseNumber: index + 1,
    courseCount: program.courses.length,
    unlocks: program.courses.filter((other) => other.requires.includes(slug)).map((other) => other.title),
  };
}

/** After this long, a claim whose map never appeared counts as a build that died. */
export const STALE_CLAIM_MS = 3 * 60_000;
/** For a missing program, and for a private one to anyone but its owner. */
export const PROGRAM_NOT_FOUND =
  "We could not find that program. It may have been made private, or the link is incomplete.";
export const COURSE_STILL_PLANNING = "This course is still being planned. Try again in a moment.";

/*
 * Creating. A topic resolves through the catalog first (at most one check call), so the reply
 * comes in about 2 s; the frame or the syllabus then streams in `after()`. Postings (and PDFs,
 * through their own route) always build one private map: the program shape is for topics only.
 */

/** A learner map of a catalog course: no nodes yet (unit 1 is appended once it is built), no syllabus (attached on read). */
export function newCourseMap(input: { id?: string; ownerId: string; course: CatalogCourse; program?: ProgramLink }): SkillMap {
  return {
    id: input.id ?? randomUUID(),
    ownerId: input.ownerId,
    title: input.course.title,
    subtitle: "",
    sourceKind: "topic",
    sourceText: input.course.title,
    nodes: [],
    createdAt: new Date().toISOString(),
    courseId: input.course.id,
    ...(input.course.audience && { audience: input.course.audience }),
    ...(input.program && { program: input.program }),
  };
}

/** The courseId a course resolution points at, claiming a new one when nothing matched. */
async function courseIdFor(resolution: CourseResolution, text: string, audience: string): Promise<string> {
  if (resolution.status === "found") return resolution.courseId;
  return (await claimCourse({ text, audience, title: resolution.title, summary: resolution.summary })).id;
}

async function programIdFor(resolution: ProgramResolution, text: string, audience: string, depth: ProgramDepth): Promise<string> {
  if (resolution.status === "found") return resolution.programId;
  return (await claimProgram({ text, audience, depth, title: resolution.title, summary: resolution.summary })).id;
}

/**
 * One catalog course as the learner's own map: zero model calls here; the syllabus and unit 1
 * are built (once, for everyone) in `after()`. Used by `POST /api/maps` and the course shape of
 * `POST /api/programs`.
 */
export async function createCourseMap(input: {
  text: string;
  ownerId: string;
  deadline?: number;
  resolution?: CourseResolution;
  audience?: string;
}): Promise<{ mapId: string }> {
  const text = checkTopicText(input.text);
  const audience = input.audience ?? cleanAudience(inferAudience(text));
  const deadline = input.deadline ?? deadlineFrom();
  const resolution = input.resolution ?? (await resolveCourse({ text, audience, deadline }));
  const courseId = await courseIdFor(resolution, text, audience);
  const course = await getCatalogCourse(courseId);
  if (!course) throw new HttpError("We could not set up that course. Please try again.", 500);
  const map = newCourseMap({ ownerId: input.ownerId, course });
  await saveSkillMap(map);
  scheduleCourseBuild(courseId, deadline, map.id);
  return { mapId: map.id };
}

/** A learner program following a catalog program; planning starts in `after()` unless it is final or running. */
async function createCatalogProgram(input: {
  text: string;
  audience: string;
  depth: ProgramDepth;
  ownerId: string;
  deadline: number;
  resolution?: ProgramResolution;
}): Promise<{ programId: string }> {
  const resolution = input.resolution ?? (await resolveProgram({ text: input.text, audience: input.audience, depth: input.depth, deadline: input.deadline }));
  const catalogId = await programIdFor(resolution, input.text, input.audience, input.depth);
  const read = await readCatalogProgram(catalogId);
  if (!read) throw new HttpError("We could not set up that program. Please try again.", 500);
  const program: Program = {
    id: randomUUID(),
    ownerId: input.ownerId,
    title: read.program.title,
    summary: read.program.summary,
    sourceKind: "topic",
    sourceText: input.text,
    courses: [],
    createdAt: new Date().toISOString(),
    catalogId,
    ...(input.depth === "degree" && { depth: "degree" as const }),
    ...(read.program.audience && { audience: read.program.audience }),
  };
  await saveProgram(program);
  // A new program reads as "planning" before its planner starts (the start grace), so anything
  // short of the final frame is scheduled; startOnce makes a second planner a no-op.
  if (read.state !== "ready") scheduleProgramPlanning(catalogId, input.deadline);
  return { programId: program.id };
}

/**
 * Where `POST /api/programs` goes. A posting builds one private map whatever the shape. A topic:
 * "program" (or a degree) makes a catalog program, "course" one catalog course, and "auto" lets
 * one check call decide (it also resolves against existing programs and courses).
 */
export async function createProgramOrMap(input: {
  text: string;
  kind: "posting" | "topic";
  shape: ProgramShape;
  ownerId: string;
  depth?: ProgramDepth;
}): Promise<{ programId: string } | { mapId: string }> {
  if (input.kind === "posting") {
    const text = checkPostingText(input.text);
    return { mapId: (await generateSkillMap({ text, kind: "posting", ownerId: input.ownerId })).id };
  }

  const text = checkTopicText(input.text);
  const audience = cleanAudience(inferAudience(text));
  const deadline = deadlineFrom();
  const depth: ProgramDepth = input.depth ?? "quick";
  if (input.depth === "degree" || input.shape === "program") {
    return createCatalogProgram({ text, audience, depth, ownerId: input.ownerId, deadline });
  }
  if (input.shape === "course") return createCourseMap({ text, ownerId: input.ownerId, deadline, audience });

  const auto = await resolveAuto({ text, audience, depth, deadline });
  return auto.shape === "program"
    ? createCatalogProgram({ text, audience, depth, ownerId: input.ownerId, deadline, resolution: auto.resolution })
    : createCourseMap({ text, ownerId: input.ownerId, deadline, audience, resolution: auto.resolution });
}

/**
 * Restarts planning of a stalled program (owner only). "ready" when the frame is final,
 * "planning" once it is being written (also when another request already is).
 */
export async function resumePlanning(programId: string, viewerId: string | null): Promise<ResumePlanningResponse> {
  const stored = await getStoredProgram(programId);
  if (!stored || !viewerId || stored.ownerId !== viewerId) throw new HttpError(PROGRAM_NOT_FOUND, 404);
  if (!stored.catalogId) return { status: "ready" };
  const read = await readCatalogProgram(stored.catalogId);
  if (!read) throw new HttpError(PROGRAM_NOT_FOUND, 404);
  if (read.state === "ready") return { status: "ready" };
  if (read.state === "stalled") scheduleProgramPlanning(stored.catalogId, deadlineFrom());
  return { status: "planning" };
}

/*
 * Loading a program with its owner's progress. Every number below is counted from the maps,
 * the syllabi and the store: planned topics come from the syllabus, never from a model's claim.
 */

/** Node states from stored proofs only: what the unit rail needs (it only asks "proven or not"). */
export function provedStates(map: Pick<SkillMap, "nodes">, progress: MapProgress | null): Record<string, NodeState> {
  return Object.fromEntries(map.nodes.map((node) => [node.id, progress?.proven[node.id] ? "proven" : "available"]));
}

/** One course of a program, loaded. */
export type LoadedCourse = {
  course: ProgramCourse;
  index: number;
  map: SkillMap | null;
  /** The syllabus on the map (attached from the catalog on read), else the catalog's final one, else null. */
  syllabus: CourseSyllabus | null;
  progress: MapProgress | null;
  /** Started courses only. */
  built: {
    mapId: string;
    proven: number;
    /** Nodes in the map. */
    total: number;
    /** Topics the course is counted against: the syllabus's planned topics, else `total`. */
    planned: number;
    badge: boolean;
    /** Degree courses only: every topic, unit test and the final passed. Undefined means "every topic proved". */
    complete?: boolean;
  } | null;
  rail: UnitRailItem[] | null;
  units: UnitSummary[] | null;
  final: AssessmentState | null;
};

function unitSummaries(rail: UnitRailItem[], unitTests: boolean, passed: Record<string, unknown>): UnitSummary[] {
  return rail.map((unit) => {
    const proved = unit.built && unit.plannedTopics > 0 && unit.proved >= unit.plannedTopics;
    const test: AssessmentState | null = unitTests ? (passed[unit.id] ? "passed" : proved ? "open" : "locked") : null;
    const state = unit.status === "locked" ? "locked" : proved && (test === null || test === "passed") ? "done" : "open";
    return { id: unit.id, number: unit.number, title: unit.title, plannedTopics: unit.plannedTopics, built: unit.built, proved: unit.proved, state, test };
  });
}

/**
 * Loads one course. `catalogSyllabus` is the catalog's syllabus for a course not started yet
 * (null when there is none or it was not read).
 */
async function loadCourse(course: ProgramCourse, index: number, catalogSyllabus: CourseSyllabus | null, ownerId: string): Promise<LoadedCourse> {
  const map = course.mapId ? await getSkillMap(course.mapId) : null;
  const empty = { course, index, map: null, syllabus: catalogSyllabus, progress: null, built: null, final: null };
  if (!map) {
    // Not started: show the plan, nothing proved.
    const rail = catalogSyllabus ? unitRail(catalogSyllabus, [], {}) : null;
    return { ...empty, rail, units: rail ? unitSummaries(rail, catalogSyllabus!.assessment.unitTests, {}) : null };
  }

  const progress = await getProgress(map.id, ownerId);
  const proven = map.nodes.filter((node) => progress?.proven[node.id]).length;
  const total = map.nodes.length;
  if (!map.syllabus) {
    // A course map with no syllabus yet (still planning), or a map built before syllabi.
    const passedFinal = total > 0 && proven === total && (await getPassedFinal(map.id)) !== null;
    const final: AssessmentState = passedFinal ? "passed" : proven === total && total > 0 ? "open" : "locked";
    return {
      ...empty,
      syllabus: null,
      map,
      progress,
      built: { mapId: map.id, proven, total, planned: total, badge: passedFinal, ...(map.courseId && { complete: false }) },
      rail: null,
      units: null,
      final,
    };
  }

  const syllabus = map.syllabus;
  // Topics known from the pre-test count even in units not built yet (unlocking the next course).
  const rail = unitRail(syllabus, map.nodes, provedStates(map, progress), progress?.proven);
  const planned = rail.reduce((sum, unit) => sum + unit.plannedTopics, 0);
  const provedTopics = rail.reduce((sum, unit) => sum + unit.proved, 0);
  const allBuilt = !syllabus.planning && rail.every((unit) => unit.built);
  const allProved = allBuilt && planned > 0 && provedTopics >= planned;
  const unitTests = syllabus.assessment.unitTests;
  const [passedTests, passedFinal] = await Promise.all([
    unitTests ? getPassedUnitTests(map.id) : Promise.resolve({} as Record<string, unknown>),
    allProved ? getPassedFinal(map.id) : Promise.resolve(null),
  ]);
  const testsDone = !unitTests || rail.every((unit) => passedTests[unit.id] !== undefined);
  const final: AssessmentState = passedFinal ? "passed" : allProved && testsDone ? "open" : "locked";
  const badge = allProved && passedFinal !== null;
  return {
    course,
    index,
    map,
    syllabus,
    progress,
    built: {
      mapId: map.id,
      proven: provedTopics,
      total,
      planned,
      badge,
      ...(syllabus.depth === "degree" && { complete: allProved && testsDone && passedFinal !== null }),
    },
    rail,
    units: unitSummaries(rail, unitTests, passedTests),
    final,
  };
}

/** The fewest topics a full catalog course can plan (8 units of at least 4). */
const MIN_FULL_COURSE_TOPICS = SYLLABUS_SHAPE.degree.units * SYLLABUS_SHAPE.degree.topicsPerUnit.min;

/**
 * Topics a started course is counted against for unlocking the courses after it: its planned
 * topics once its syllabus is final. While a catalog course's syllabus is still being written,
 * at least the fewest a full course plans, so opening a course never opens the next one by itself.
 */
function unlockTotal(loaded: LoadedCourse): number {
  const planned = loaded.built?.planned ?? 0;
  const final = loaded.syllabus && !loaded.syllabus.planning;
  return loaded.map?.courseId && !final ? Math.max(planned, MIN_FULL_COURSE_TOPICS) : planned;
}

/**
 * The program and its owner's progress, or null when it is missing or someone else's: the
 * same answer, so nobody can tell a private program exists. Public ones go through sharing.ts.
 * `syllabi`: "final" reads the catalog's final syllabus of each course not started yet (one read
 * each, skipped while the course list is still planning); "none" reads none.
 */
export async function loadOwnProgram(programId: string, userId: string | null, options: { syllabi?: "final" | "none" } = {}) {
  const found = await getProgramWithPlanning(programId);
  if (!found || found.program.ownerId !== userId) return null;
  const program = await withClaims(found.program);
  const readSyllabi = (options.syllabi ?? "final") === "final" && found.planning?.state !== "planning";
  const catalogSyllabi = await Promise.all(
    program.courses.map((course) => (readSyllabi && course.courseId && !course.mapId ? getFinalSyllabus(course.courseId) : Promise.resolve(null))),
  );
  const courses = await Promise.all(
    program.courses.map((course, index) => loadCourse(course, index, catalogSyllabi[index], found.program.ownerId)),
  );
  const progress = Object.fromEntries(
    courses.map((loaded) => [
      loaded.course.slug,
      loaded.built
        ? {
            proven: loaded.built.proven,
            total: unlockTotal(loaded),
            mapId: loaded.built.mapId,
            ...(loaded.built.complete !== undefined && { complete: loaded.built.complete }),
          }
        : undefined,
    ]),
  );
  // Every catalog course is a full course: a quarter of each required course opens the next.
  const rule: ProgramDepth = program.catalogId ? "degree" : (program.depth ?? "quick");
  return { program, planning: found.planning, courses, progress, states: courseStates(program.courses, progress, rule) };
}

export type LoadedProgram = NonNullable<Awaited<ReturnType<typeof loadOwnProgram>>>;

/** The depth a course's lessons are written to: its syllabus's, else its program's. */
function courseDepth(program: Program, loaded: LoadedCourse): ProgramDepth {
  if (loaded.syllabus) return loaded.syllabus.depth;
  if (program.catalogId) return "degree";
  return loaded.map ? "quick" : (program.depth ?? "quick");
}

/** What the hours need to know about one course, without the store reads (written words and activity come later). */
export function courseFacts(program: Program, loaded: LoadedCourse, writtenWords: number[] = [], activity: string[] = []): CourseFacts {
  const depth = courseDepth(program, loaded);
  const audience = loaded.map ? (loaded.map.audience ?? "") : programAudience(program);
  const plan = loaded.syllabus
    ? {
        topics: loaded.built?.planned ?? loaded.syllabus.units.reduce((sum, unit) => sum + unit.topics.length, 0),
        units: loaded.syllabus.units.length,
        unitTests: loaded.syllabus.assessment.unitTests,
        finalQuestions: loaded.syllabus.assessment.finalQuestions,
      }
    : loaded.built && !loaded.map?.courseId
      ? { topics: loaded.built.total, units: 1, unitTests: false, finalQuestions: SYLLABUS_SHAPE.quick.finalQuestions }
      : null;
  return {
    depth,
    lessonWords: targetWords(audience || undefined, depth),
    practiceCasesPerTopic: wantsPractice(audience || undefined, depth) ? SYLLABUS_SHAPE.degree.practiceCases : 0,
    plan,
    writtenWords,
    activity,
  };
}

/** The facts for the hours of each course, reading the written lessons and activity of the started ones. */
export async function courseHoursFacts(program: Program, courses: LoadedCourse[]): Promise<CourseFacts[]> {
  return Promise.all(
    courses.map(async (loaded) => {
      if (!loaded.built || !loaded.map) return courseFacts(program, loaded);
      // Lessons are shared by every copy of a catalog course, so they are counted by its content id.
      const [words, activity] = await Promise.all([lessonWordCounts(contentIdOf(loaded.map)), activityTimes(loaded.built.mapId, program.ownerId)]);
      return courseFacts(program, loaded, Object.values(words), activity);
    }),
  );
}

/** The view of one course on the program page. New fields appear only when the course has a syllabus. */
function courseView(program: Program, loaded: LoadedCourse, state: { state: CourseView["state"]; blockers: CourseView["blockers"] }): CourseView {
  const { course, built } = loaded;
  return {
    slug: course.slug,
    number: loaded.index + 1,
    title: course.title,
    summary: course.summary,
    mapId: built?.mapId ?? null,
    proven: built?.proven ?? 0,
    total: built?.total ?? null,
    badge: built?.badge ?? false,
    ...state,
    ...(course.year !== undefined && { year: course.year }),
    ...(course.term !== undefined && { term: course.term }),
    ...(course.level !== undefined && { level: course.level }),
    ...(course.area !== undefined && { area: course.area }),
    // A catalog course can be started once its line is registered.
    ...(program.catalogId && { startable: Boolean(course.courseId) || Boolean(built) }),
    ...(loaded.syllabus && {
      hasSyllabus: true,
      plannedTopics: built?.planned ?? loaded.syllabus.units.reduce((sum, unit) => sum + unit.topics.length, 0),
      ...(loaded.units && { units: loaded.units }),
      final: loaded.final ?? "locked",
    }),
  };
}

/** What the program page shows, and what `GET /api/programs/[id]` polls. Null when there is no such program. */
export async function getProgramView(programId: string, userId: string | null): Promise<ProgramView | null> {
  const loaded = await loadOwnProgram(programId, userId);
  if (!loaded) return null;
  const { program, courses, states, planning } = loaded;
  const facts = await courseHoursFacts(program, courses);

  return {
    id: program.id,
    title: program.title,
    summary: program.summary,
    sourceKind: program.sourceKind,
    isSample: Boolean(program.sampleId),
    courses: courses.map((course) => courseView(program, course, states[course.course.slug])),
    ...(program.depth && { depth: program.depth }),
    hours: hoursBreakdown(facts),
    ...(planning && { planning: planning satisfies ProgramPlanning }),
  };
}

/** The sentence for a course still locked behind `title`. */
function lockedMessage(program: Program, blocker: { title: string; needed: number | null }): string {
  return program.catalogId || program.depth === "degree"
    ? `Prove a quarter of "${blocker.title}" first, and this course opens.`
    : `Prove half of "${blocker.title}" first, and this course opens.`;
}

/**
 * Opens a course of the viewer's program with zero model calls: it claims
 * `program-courses/<programId>/<slug>` (so two clicks make one map), creates the learner map with
 * the catalog `courseId` and no nodes, saves its mapId on the program, and starts the canonical
 * syllabus and unit 1 (and, rule 5, the next course's) in `after()`. The map page then shows the
 * syllabus filling in. "building" while another request holds a fresh claim with no map yet.
 */
export async function openCourse(programId: string, slug: string, userId: string | null): Promise<OpenCourseResult> {
  const loaded = await loadOwnProgram(programId, userId, { syllabi: "none" });
  if (!loaded) throw new HttpError(PROGRAM_NOT_FOUND, 404);
  const { program, progress, states } = loaded;

  const index = program.courses.findIndex((course) => course.slug === slug);
  if (index === -1) throw new HttpError("That course is not part of this program.", 404);
  const course = program.courses[index];
  const deadline = deadlineFrom();

  const built = progress[slug];
  if (built) return { status: "ready", mapId: built.mapId };
  if (!course.courseId) throw new HttpError(COURSE_STILL_PLANNING, 409);

  const { blockers } = states[slug];
  if (blockers.length > 0) throw new HttpError(lockedMessage(program, blockers[0]), 409);

  const mapId = randomUUID();
  if (!(await claimProgramCourse(program.id, slug, { mapId, claimedAt: new Date().toISOString() }))) {
    const claim = await getCourseClaim(program.id, slug);
    if (claim && (await getSkillMap(claim.mapId))) return { status: "ready", mapId: claim.mapId };
    const age = claim ? Date.now() - Date.parse(claim.claimedAt) : Infinity;
    // A claim with no map yet is an open in progress, unless it is old enough to have died.
    if (age < STALE_CLAIM_MS) return { status: "building" };
    await releaseCourse(program.id, slug);
    return openCourse(programId, slug, userId);
  }

  try {
    const catalogCourse = await getCatalogCourse(course.courseId);
    if (!catalogCourse) throw new HttpError(COURSE_STILL_PLANNING, 409);
    await saveSkillMap(newCourseMap({ id: mapId, ownerId: program.ownerId, course: catalogCourse, program: programLink(program, index) }));
  } catch (error) {
    // Free the course, so the next click tries again.
    await releaseCourse(program.id, slug);
    throw error;
  }
  await saveCourseMapId(program.id, slug, mapId);
  scheduleCourseBuild(course.courseId, deadline, mapId);
  scheduleNextCourse(program.courses, index, deadline);
  return { status: "ready", mapId };
}

const UNIT_NOT_FOUND = "We could not find that unit. It may have been removed.";

/**
 * Starts unit `unitId` of the viewer's course map. Zero model calls in the request for a catalog
 * course: the unit comes from the shared cache, or its build starts in the background ("building").
 * A catalog course whose syllabus is neither final nor being written restarts the syllabus build
 * first (the map page's "Try again"). Unit k opens once half of unit k-1 is proved (409 before
 * that). 404 for a map that is not the viewer's, or a unit its syllabus does not have.
 */
export async function startUnit(
  mapId: string,
  unitId: string,
  viewerId: string | null,
): Promise<{ status: "ready"; mapId: string; unitId: string } | { status: "building" }> {
  const map = await getSkillMap(mapId);
  if (!map || !viewerId || map.ownerId !== viewerId) throw new HttpError("We could not find that course.", 404);

  let syllabus = map.syllabus;
  if (map.courseId && (!syllabus || syllabus.planning)) {
    const read = await readCatalogSyllabus(map.courseId);
    if (read.state === "idle") {
      scheduleCourseBuild(map.courseId, deadlineFrom(), map.id);
      return { status: "building" };
    }
    syllabus = read.syllabus;
    if (read.state === "planning" && !syllabus.units.some((unit) => unit.id === unitId)) return { status: "building" };
  }
  const position = syllabus?.units.findIndex((unit) => unit.id === unitId) ?? -1;
  if (!syllabus || position === -1) throw new HttpError(UNIT_NOT_FOUND, 404);
  if (isUnitBuilt({ ...map, syllabus }, unitId)) return { status: "ready", mapId, unitId };

  if (position > 0) {
    const progress = await getProgress(map.id, viewerId);
    const rail = unitRail(syllabus, map.nodes, provedStates(map, progress), progress?.proven);
    const previous = rail[position - 1];
    const needed = unitStartRule(previous.plannedTopics);
    if (!previous.built || previous.proved < needed) {
      const left = previous.built ? needed - previous.proved : null;
      throw new HttpError(
        left === null
          ? `Start unit ${previous.number} first. This unit opens once half of it is proved.`
          : `Prove ${left} more topic${left === 1 ? "" : "s"} in unit ${previous.number} first. This unit opens once half of it is proved.`,
        409,
      );
    }
  }

  const result = await generateUnit({ ...map, syllabus }, unitId, viewerId);
  return result.status === "ready" ? { status: "ready", mapId, unitId } : { status: "building" };
}

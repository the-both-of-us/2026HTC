import { getCatalogCourse, readCatalogSyllabus, type CatalogSyllabusRead } from "@/features/catalog";
import { getSkillMap, inBackground, routeDeadline } from "@/features/skill-map";
import { getProgress, markPretestProven } from "@/features/teachback";
import { cleanAudience } from "@/shared/audience";
import { HttpError } from "@/shared/http";
import { isPretestProof, type CourseSyllabus, type SkillMap, type SyllabusTopic, type SyllabusUnit } from "@/shared/types";
import { ensureQuestionSet, readQuestionSet } from "./generate";
import { gradeUnit, MAX_PRETEST_ANSWER_CHARACTERS, type GivenAnswer } from "./grade";
import type { CourseContext } from "./prompt";
import { getQuestionSet, getRecord, saveRecord, withLock } from "./storage";
import type { PretestAnswersRequest, PretestEndReason, PretestRecord, PretestView } from "./types";

/*
 * The course pre-test: optional, once per course per learner, one short-answer question per
 * syllabus topic, asked unit by unit. A topic answered correctly is recorded as proved on the
 * learner's own map with format "pretest" (teachback's `markPretestProven`), even in a unit not
 * built yet. Unit tests and the course final are still required.
 */

const NOT_FOUND = "We could not find that course. Check the link, or open it from your dashboard.";
const NOT_A_COURSE = "A pre-test is only offered on a topic course. This map was built from a posting or a PDF.";
const NOT_READY = "This course's plan is not ready yet. Open the course again in a minute.";
const TAKEN = "You have taken this course's pre-test already. It can be taken once.";
const NOT_STARTED = "Start the pre-test first.";
const NOTHING_LEFT = "Every topic of this course is proved already, so a pre-test has nothing left to ask.";
const NOT_CURRENT = "These answers are for a unit that is not being asked now. Reload the pre-test.";
const STILL_WRITING = "This unit's questions are still being written. Give it a few seconds.";

/** Lets a route run work after its response (Next's `after()`); tests pass one they can await. */
export type PretestOptions = { background?: (label: string, task: () => Promise<unknown>) => void; deadline?: number };

type Loaded = {
  map: SkillMap;
  courseId: string;
  canonical: CatalogSyllabusRead;
  /** This learner's record of this course, when it belongs to this map (or its map is gone). */
  record: PretestRecord | null;
  /** The learner took the pre-test of this course on another map they still have. */
  takenElsewhere: PretestRecord | null;
  proven: Record<string, string>;
};

type Cursor =
  | { kind: "unit"; index: number; unit: SyllabusUnit; topics: SyllabusTopic[] }
  /** The syllabus is still being written and has no further unit yet. */
  | { kind: "wait" }
  /** No unit is left to ask. */
  | { kind: "done" };

async function loadOwn(mapId: string, viewerId: string | null): Promise<SkillMap> {
  const map = await getSkillMap(mapId);
  // Someone else's map answers like a missing one, so nobody can tell it exists.
  if (!map || !viewerId || map.ownerId !== viewerId) throw new HttpError(NOT_FOUND, 404);
  return map;
}

async function load(map: SkillMap, viewerId: string): Promise<Loaded> {
  const courseId = map.courseId as string;
  const [canonical, stored, progress] = await Promise.all([
    readCatalogSyllabus(courseId),
    getRecord(courseId, viewerId),
    getProgress(map.id, viewerId),
  ]);
  let record = stored;
  let takenElsewhere: PretestRecord | null = null;
  if (stored && stored.mapId !== map.id) {
    // A record made on a map the learner has since deleted counts for nothing.
    const other = await getSkillMap(stored.mapId);
    const live = other !== null && other.ownerId === viewerId;
    record = null;
    if (live && stored.state !== "dismissed") takenElsewhere = stored;
  }
  return { map, courseId, canonical, record, takenElsewhere, proven: progress?.proven ?? {} };
}

/** The canonical syllabus, or null when there is none (idle). */
function canonicalOf(loaded: Loaded): CourseSyllabus | null {
  return loaded.canonical.state === "idle" ? null : loaded.canonical.syllabus;
}

/**
 * The topics of a unit to ask this learner: the canonical unit's topics, cut down to those with a
 * node once the learner's unit is built (a topic its build could not write is never counted),
 * leaving out topics already proved.
 */
function askable(unit: SyllabusUnit, learner: CourseSyllabus | undefined, proven: Record<string, string>): SyllabusTopic[] {
  const mine = learner?.units.find((candidate) => candidate.id === unit.id);
  const onMap = mine?.built ? new Set(mine.topics.map((topic) => topic.id)) : null;
  return unit.topics.filter((topic) => (!onMap || onMap.has(topic.id)) && !proven[topic.id]);
}

/** The next unit to ask from `from`, skipping units with nothing left to ask. */
function cursorFrom(from: number, syllabus: CourseSyllabus, learner: CourseSyllabus | undefined, proven: Record<string, string>): Cursor {
  for (let index = from; index < syllabus.units.length; index++) {
    const unit = syllabus.units[index];
    const topics = askable(unit, learner, proven);
    if (topics.length > 0) return { kind: "unit", index, unit, topics };
  }
  return syllabus.planning ? { kind: "wait" } : { kind: "done" };
}

function topicTitles(syllabus: CourseSyllabus | null): Map<string, string> {
  return new Map((syllabus?.units ?? []).flatMap((unit) => unit.topics.map((topic) => [topic.id, topic.title] as const)));
}

/**
 * What the browser gets. Built from the store only; never holds an answer key. `scheduled` holds
 * the units whose questions this request just set to be written after the response: they read
 * as "writing", not "stalled".
 */
async function toView(loaded: Loaded, scheduled: ReadonlySet<string> = new Set()): Promise<PretestView> {
  const syllabus = canonicalOf(loaded);
  const record = loaded.record ?? loaded.takenElsewhere;
  const titles = topicTitles(syllabus);
  const base: PretestView = {
    mapId: loaded.map.id,
    offer: "none",
    state: "not-started",
    current: null,
    pendingUnitId: null,
    unitsTotal: syllabus?.units.length ?? 0,
    unitsDone: record?.graded.length ?? 0,
    results: (record?.graded ?? []).flatMap((unit) =>
      unit.results.map((result) => ({ unitId: unit.unitId, topicId: result.topicId, topicTitle: titles.get(result.topicId) ?? result.topicId, outcome: result.outcome })),
    ),
    ended: record?.ended ?? null,
    knownTopicIds: Object.keys(loaded.proven).filter((id) => isPretestProof(loaded.proven[id])),
    dismissed: record?.state === "dismissed",
    maxAnswerCharacters: MAX_PRETEST_ANSWER_CHARACTERS,
  };

  if (record && (record.state === "ended" || loaded.takenElsewhere)) return { ...base, offer: "taken", state: "ended" };
  if (!syllabus) return { ...base, offer: "none", reason: "not-ready", state: record?.state === "in-progress" ? "stalled" : "not-started" };

  if (record?.state === "in-progress") {
    const cursor = cursorFrom(record.unitIndex, syllabus, loaded.map.syllabus, loaded.proven);
    if (cursor.kind === "wait") return { ...base, offer: "in-progress", state: "writing" };
    if (cursor.kind === "done") {
      // Every unit asked (the record is closed on the next change): shown as ended.
      return { ...base, offer: "taken", state: "ended", ended: { reason: "completed", at: record.graded.at(-1)?.gradedAt ?? record.startedAt ?? "" } };
    }
    const set = await readQuestionSet(loaded.courseId, cursor.unit.id);
    if (set.state !== "ready") {
      const writing = set.state === "running" || scheduled.has(cursor.unit.id);
      return { ...base, offer: "in-progress", state: writing ? "writing" : "stalled", pendingUnitId: cursor.unit.id };
    }
    const wanted = new Set(cursor.topics.map((topic) => topic.id));
    return {
      ...base,
      offer: "in-progress",
      state: "answering",
      current: {
        unitId: cursor.unit.id,
        number: cursor.index + 1,
        title: cursor.unit.title,
        // Only the question text: the answer key (keyPoints) never leaves the server.
        questions: set.set.questions
          .filter((question) => wanted.has(question.topicId))
          .map((question) => ({ topicId: question.topicId, topicTitle: titles.get(question.topicId) ?? question.topicId, question: question.question })),
      },
    };
  }

  const first = cursorFrom(0, syllabus, loaded.map.syllabus, loaded.proven);
  if (first.kind === "done") return { ...base, offer: "none", reason: "nothing-left" };
  const fresh = Object.keys(loaded.proven).length === 0 && record?.state !== "dismissed";
  return { ...base, offer: fresh ? "suggest" : "available" };
}

/** The course as the question prompt names it: canonical, so every learner's prompt is the same. */
async function courseContext(map: SkillMap, courseId: string): Promise<CourseContext> {
  const course = await getCatalogCourse(courseId).catch(() => null);
  return { title: course?.title ?? map.title, audience: cleanAudience(course?.audience ?? map.audience) };
}

/**
 * Starts writing the question sets of the current unit (if nobody has) and of the next one ahead,
 * after the response. Returns the unit ids it started.
 */
async function writeAhead(loaded: Loaded, record: PretestRecord, options: PretestOptions): Promise<Set<string>> {
  const started = new Set<string>();
  const syllabus = canonicalOf(loaded);
  if (!syllabus || record.state !== "in-progress") return started;
  const current = cursorFrom(record.unitIndex, syllabus, loaded.map.syllabus, loaded.proven);
  if (current.kind !== "unit") return started;
  const next = cursorFrom(current.index + 1, syllabus, loaded.map.syllabus, loaded.proven);
  const units = [current, ...(next.kind === "unit" ? [next] : [])];
  const states = await Promise.all(units.map((cursor) => readQuestionSet(loaded.courseId, cursor.unit.id)));
  const course = await courseContext(loaded.map, loaded.courseId);
  const background = options.background ?? inBackground;
  const deadline = options.deadline ?? routeDeadline();
  units.forEach((cursor, index) => {
    if (states[index].state !== "idle") return;
    started.add(cursor.unit.id);
    // The whole canonical unit, so every learner of the course shares one set.
    background(`pretest ${cursor.unit.id}`, () =>
      ensureQuestionSet({ courseId: loaded.courseId, unit: cursor.unit, unitNumber: cursor.index + 1, course, deadline }),
    );
  });
  return started;
}

function requireCourse(map: SkillMap): void {
  if (!map.courseId) throw new HttpError(NOT_A_COURSE, 400);
}

/** GET: the pre-test as this learner sees it on this map. A posting or PDF map gets `offer: "none"`. */
export async function getPretestView(mapId: string, viewerId: string | null): Promise<PretestView> {
  const map = await loadOwn(mapId, viewerId);
  if (!map.courseId) {
    return {
      mapId: map.id,
      offer: "none",
      reason: "not-a-course",
      state: "not-started",
      current: null,
      pendingUnitId: null,
      unitsTotal: 0,
      unitsDone: 0,
      results: [],
      ended: null,
      knownTopicIds: [],
      dismissed: false,
      maxAnswerCharacters: MAX_PRETEST_ANSWER_CHARACTERS,
    };
  }
  return toView(await load(map, viewerId as string));
}

/**
 * Starts the pre-test, or resumes it (idempotent): creates the record and starts writing the
 * current unit's questions (and the next unit's) after the response. No model call in the request.
 */
export async function startPretest(mapId: string, viewerId: string | null, options: PretestOptions = {}): Promise<PretestView> {
  const map = await loadOwn(mapId, viewerId);
  requireCourse(map);
  const userId = viewerId as string;
  const courseId = map.courseId as string;
  const scheduled = await withLock(courseId, userId, async () => {
    const loaded = await load(map, userId);
    const syllabus = canonicalOf(loaded);
    if (loaded.takenElsewhere || loaded.record?.state === "ended") throw new HttpError(TAKEN, 409);
    if (!syllabus) throw new HttpError(NOT_READY, 409);
    let record = loaded.record;
    if (!record || record.state === "dismissed") {
      if (cursorFrom(0, syllabus, map.syllabus, loaded.proven).kind === "done") throw new HttpError(NOTHING_LEFT, 409);
      record = { version: 1, courseId, ownerId: userId, mapId: map.id, state: "in-progress", startedAt: new Date().toISOString(), unitIndex: 0, graded: [] };
      await saveRecord(record);
    }
    return writeAhead({ ...loaded, record }, record, options);
  });
  return toView(await load(map, userId), scheduled);
}

/** "Not now" on the offer: it stops being suggested, and stays available from the map. */
export async function dismissPretest(mapId: string, viewerId: string | null): Promise<PretestView> {
  const map = await loadOwn(mapId, viewerId);
  requireCourse(map);
  const userId = viewerId as string;
  const courseId = map.courseId as string;
  await withLock(courseId, userId, async () => {
    const loaded = await load(map, userId);
    if (loaded.record || loaded.takenElsewhere) return;
    await saveRecord({ version: 1, courseId, ownerId: userId, mapId: map.id, state: "dismissed", dismissedAt: new Date().toISOString(), unitIndex: 0, graded: [] });
  });
  return toView(await load(map, userId));
}

/** Ends the pre-test now ("stopped"). What was graded stays recorded. */
export async function stopPretest(mapId: string, viewerId: string | null): Promise<PretestView> {
  const map = await loadOwn(mapId, viewerId);
  requireCourse(map);
  const userId = viewerId as string;
  await withLock(map.courseId as string, userId, async () => {
    const loaded = await load(map, userId);
    if (loaded.takenElsewhere || loaded.record?.state === "ended") return;
    if (loaded.record?.state !== "in-progress") throw new HttpError(NOT_STARTED, 409);
    await saveRecord(endRecord(loaded.record, "stopped"));
  });
  return toView(await load(map, userId));
}

function endRecord(record: PretestRecord, reason: PretestEndReason, unitId?: string): PretestRecord {
  return { ...record, state: "ended", ended: { reason, at: new Date().toISOString(), ...(unitId && { unitId }) } };
}

function answersOf(request: PretestAnswersRequest): Map<string, GivenAnswer> {
  const answers = new Map<string, GivenAnswer>();
  for (const entry of request.answers) {
    if (answers.has(entry.topicId)) throw new HttpError("Each question can be answered once. Reload the pre-test.", 400);
    if ((entry.answer ?? "").length > MAX_PRETEST_ANSWER_CHARACTERS) {
      throw new HttpError(`Please keep each answer under ${MAX_PRETEST_ANSWER_CHARACTERS.toLocaleString("en-CA")} characters.`, 400);
    }
    answers.set(entry.topicId, { answer: entry.answer ?? null, dontKnow: entry.dontKnow === true });
  }
  return answers;
}

/**
 * Grades the current unit's answers with at most one check call, records each "known" topic as
 * proved ("pretest") on this map, then moves on, or ends the pre-test: "unit-missed" when no
 * answer in the unit was right, "stopped" when asked to, "completed" after the last unit.
 * A failed check (503) records nothing, so the same answers can be sent again.
 */
export async function submitPretestAnswers(
  mapId: string,
  viewerId: string | null,
  request: PretestAnswersRequest,
  options: PretestOptions = {},
): Promise<PretestView> {
  const map = await loadOwn(mapId, viewerId);
  requireCourse(map);
  const userId = viewerId as string;
  const answers = answersOf(request);
  const courseId = map.courseId as string;

  const scheduled = await withLock(courseId, userId, async () => {
    const loaded = await load(map, userId);
    const syllabus = canonicalOf(loaded);
    if (loaded.takenElsewhere || loaded.record?.state === "ended") throw new HttpError(TAKEN, 409);
    const record = loaded.record;
    if (!record || record.state !== "in-progress") throw new HttpError(NOT_STARTED, 409);
    if (!syllabus) throw new HttpError(NOT_READY, 409);

    const cursor = cursorFrom(record.unitIndex, syllabus, map.syllabus, loaded.proven);
    if (cursor.kind !== "unit" || cursor.unit.id !== request.unitId) throw new HttpError(NOT_CURRENT, 409);
    const set = await getQuestionSet(courseId, cursor.unit.id);
    if (!set) throw new HttpError(STILL_WRITING, 409);
    const asked = new Set(cursor.topics.map((topic) => topic.id));
    const questions = set.questions.filter((question) => asked.has(question.topicId));

    const results = await gradeUnit(questions, answers, cleanAudience(map.audience));
    const known = results.filter((result) => result.outcome === "known").map((result) => result.topicId);
    // Proofs first: if saving the record then fails, sending again re-asks only what was missed.
    await markPretestProven(map.id, userId, known);

    let next: PretestRecord = {
      ...record,
      unitIndex: cursor.index + 1,
      graded: [...record.graded, { unitId: cursor.unit.id, gradedAt: new Date().toISOString(), results }],
    };
    const proven = { ...loaded.proven, ...Object.fromEntries(known.map((id) => [id, "pretest"])) };
    if (known.length === 0) next = endRecord(next, "unit-missed", cursor.unit.id);
    else if (request.stop) next = endRecord(next, "stopped");
    else if (cursorFrom(next.unitIndex, syllabus, map.syllabus, proven).kind === "done") next = endRecord(next, "completed");
    await saveRecord(next);
    return writeAhead({ ...loaded, record: next, proven }, next, options);
  });
  return toView(await load(map, userId), scheduled);
}

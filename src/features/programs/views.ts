/*
 * The syllabus page and the university comparison. No model calls: every number is counted from
 * the program, its syllabi, its maps and the learner's own records, or comes from norms.ts with
 * its source. There is never a match score, and the "Not equivalent" lines always go with it.
 */
import { readCatalogSyllabus } from "@/features/catalog";
import { QUESTIONS_WANTED } from "@/features/quiz";
import { SYLLABUS_SHAPE, UNIT_TEST, type SkillNode } from "@/shared/types";
import { hoursBreakdown, plannedUnits, practiceCounts } from "./hours";
import { normsFor, referenceFor } from "./norms";
import { courseFacts, courseHoursFacts, loadOwnProgram, type LoadedCourse } from "./programs";
import {
  NOT_EQUIVALENT,
  type ComparisonView,
  type CourseComparison,
  type Program,
  type SyllabusTopicView,
  type SyllabusUnitView,
  type SyllabusView,
} from "./types";

/** "slug:topicId" and bare topic ids, resolved to titles for display. */
function topicTitles(courses: LoadedCourse[]): Map<string, { title: string; courseTitle: string }> {
  const titles = new Map<string, { title: string; courseTitle: string }>();
  for (const loaded of courses) {
    for (const unit of loaded.syllabus?.units ?? []) {
      for (const topic of unit.topics) titles.set(`${loaded.course.slug}:${topic.id}`, { title: topic.title, courseTitle: loaded.course.title });
    }
  }
  return titles;
}

/**
 * The syllabus of one course of the viewer's program: "none" before its catalog syllabus exists,
 * "draft" once written (or while it is being written, with `planning: true`) and before unit 1 is
 * on the learner's map, "built" once it is. Null when the program is not the viewer's or has no such course.
 */
export async function getSyllabusView(programId: string, slug: string, viewerId: string | null): Promise<SyllabusView | null> {
  const loaded = await loadOwnProgram(programId, viewerId);
  if (!loaded) return null;
  const { program, courses } = loaded;
  const course = courses.find((candidate) => candidate.course.slug === slug);
  if (!course) return null;

  // A course not started yet shows its catalog syllabus, also while it is still being written.
  let syllabus = course.syllabus;
  if (!syllabus && !course.map && course.course.courseId) {
    const read = await readCatalogSyllabus(course.course.courseId);
    if (read.state !== "idle") syllabus = read.syllabus;
  }
  const status: SyllabusView["status"] = !syllabus ? "none" : (course.map?.nodes.length ?? 0) > 0 ? "built" : "draft";
  const elsewhere = topicTitles(courses);
  const nodeIds = new Set(course.map?.nodes.map((node) => node.id) ?? []);

  const units: SyllabusUnitView[] = (syllabus?.units ?? []).map((unit, index) => {
    const own = new Map(unit.topics.map((topic) => [topic.id, topic.title]));
    const allOwn = new Map(syllabus!.units.flatMap((u) => u.topics.map((topic) => [topic.id, topic.title] as const)));
    const outcomes = unit.outcomeIds.flatMap((id) => syllabus!.outcomes.find((outcome) => outcome.id === id)?.text ?? []);
    const topics: SyllabusTopicView[] = unit.topics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      objectives: [...topic.objectives],
      keyTerms: [...topic.keyTerms],
      inScope: topic.inScope,
      outOfScope: topic.outOfScope,
      buildsOn: topic.buildsOn.flatMap((ref): SyllabusTopicView["buildsOn"] => {
        const local = own.get(ref) ?? allOwn.get(ref);
        if (local) return [{ title: local, courseTitle: null }];
        const other = elsewhere.get(ref);
        return other ? [{ title: other.title, courseTitle: other.courseTitle }] : [];
      }),
      built: nodeIds.has(topic.id),
      proved: Boolean(course.progress?.proven[topic.id]),
    }));
    const summary = course.units?.[index] ?? {
      id: unit.id,
      number: index + 1,
      title: unit.title,
      plannedTopics: unit.topics.length,
      built: false,
      proved: 0,
      state: index === 0 ? "open" : "locked",
      test: syllabus!.assessment.unitTests ? "locked" : null,
    };
    return { ...summary, outcomes, topics };
  });

  const facts = (await courseHoursFacts(program, [{ ...course, syllabus }]))[0];
  const requires = course.course.requires.flatMap((required) => {
    const found = program.courses.find((other) => other.slug === required);
    return found ? [{ slug: found.slug, title: found.title }] : [];
  });
  return {
    programId: program.id,
    programTitle: program.title,
    course: {
      slug: course.course.slug,
      number: course.index + 1,
      title: course.course.title,
      summary: course.course.summary,
      ...(course.course.year !== undefined && { year: course.course.year }),
      ...(course.course.term !== undefined && { term: course.course.term }),
      ...(course.course.level !== undefined && { level: course.course.level }),
      ...(course.course.area !== undefined && { area: course.course.area }),
      requires,
      mapId: course.built?.mapId ?? null,
    },
    status,
    ...(syllabus?.planning && { planning: true }),
    outcomes: syllabus?.outcomes.map((outcome) => ({ ...outcome })) ?? [],
    units,
    assessment: {
      unitTests: syllabus?.assessment.unitTests ?? SYLLABUS_SHAPE.unitTests,
      unitTestQuestions: UNIT_TEST.questions,
      unitTestPassMark: UNIT_TEST.passMark,
      finalQuestions: syllabus?.assessment.finalQuestions ?? SYLLABUS_SHAPE.finalQuestions,
      finalPassMark: SYLLABUS_SHAPE.finalPassMark,
      final: course.final ?? "locked",
    },
    hours: hoursBreakdown([facts]),
    practice: practiceCounts([facts], QUESTIONS_WANTED),
  };
}

/** A map's nodes with each after its prerequisites (a cycle or a missing one keeps the rest in place). */
function learningOrder(nodes: SkillNode[]): SkillNode[] {
  const ids = new Set(nodes.map((node) => node.id));
  const placed = new Set<string>();
  const ordered: SkillNode[] = [];
  let progressed = true;
  while (progressed && ordered.length < nodes.length) {
    progressed = false;
    for (const node of nodes) {
      if (placed.has(node.id) || !node.prerequisites.every((id) => !ids.has(id) || placed.has(id))) continue;
      placed.add(node.id);
      ordered.push(node);
      progressed = true;
    }
  }
  return [...ordered, ...nodes.filter((node) => !placed.has(node.id))];
}

/** Units built in a course: its syllabus's built units, or 1 for a course built before syllabi. */
function builtUnits(course: LoadedCourse): number {
  if (!course.built) return 0;
  return course.rail ? course.rail.filter((unit) => unit.built).length : 1;
}

/** What one course of ours looks like beside a typical university course. */
function compareCourse(program: Program, course: LoadedCourse, facts: ReturnType<typeof courseFacts>): CourseComparison {
  const syllabus = course.syllabus;
  const unitTitles =
    syllabus && syllabus.units.length > 1
      ? syllabus.units.map((unit) => unit.title)
      : syllabus
        ? syllabus.units.flatMap((unit) => unit.topics.map((topic) => topic.title))
        : course.map
          ? learningOrder(course.map.nodes).map((node) => node.title)
          : [];
  return {
    slug: course.course.slug,
    title: course.course.title,
    unitTitles,
    topics: { planned: facts.plan?.topics ?? null, built: course.built?.total ?? 0, proved: course.built?.proven ?? 0 },
    hours: hoursBreakdown([facts]),
    practice: practiceCounts([facts], QUESTIONS_WANTED),
    reference: referenceFor(program.title, course.course.title),
  };
}

/**
 * Our computed numbers next to sourced university norms, for the viewer's own program. `courseSlug`
 * picks the course compared on its own; by default the first one started. Null when the program
 * is not the viewer's.
 */
export async function getComparisonView(programId: string, viewerId: string | null, courseSlug?: string): Promise<ComparisonView | null> {
  const loaded = await loadOwnProgram(programId, viewerId);
  if (!loaded) return null;
  const { program, courses } = loaded;
  const facts = await courseHoursFacts(program, courses);

  const allPlanned = facts.every((fact) => fact.plan !== null);
  const asked = courseSlug ? courses.findIndex((course) => course.course.slug === courseSlug) : -1;
  const picked = asked >= 0 ? asked : courses.findIndex((course) => course.built !== null);

  return {
    programId: program.id,
    programTitle: program.title,
    ours: {
      courses: courses.length,
      coursesBuilt: courses.filter((course) => course.built).length,
      units: { planned: facts.reduce((sum, fact) => sum + plannedUnits(fact), 0), built: courses.reduce((sum, course) => sum + builtUnits(course), 0) },
      topics: {
        planned: allPlanned ? facts.reduce((sum, fact) => sum + (fact.plan?.topics ?? 0), 0) : null,
        built: courses.reduce((sum, course) => sum + (course.built?.total ?? 0), 0),
        proved: courses.reduce((sum, course) => sum + (course.built?.proven ?? 0), 0),
      },
      hours: hoursBreakdown(facts),
      practice: practiceCounts(facts, QUESTIONS_WANTED),
    },
    course: picked >= 0 ? compareCourse(program, courses[picked], facts[picked]) : null,
    norms: normsFor(program.title),
    notEquivalent: NOT_EQUIVALENT,
  };
}

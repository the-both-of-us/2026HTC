/*
 * Reading time and practice, computed in code from counts the app really has. Nothing here is
 * estimated by a model, and nothing is shown as minutes that cannot be counted:
 * - planned: planned topics x the lesson length each course is written to, at 200 words a minute;
 * - written: the words of the lessons actually written so far, at 200 words a minute;
 * - measured: the sum of gaps under 10 minutes between this learner's own recorded activity;
 * - practice: item counts (teach-backs, quiz questions, cases, test questions), never minutes.
 * Pure functions: programs.ts reads the store and passes the facts in.
 */
import { SYLLABUS_SHAPE, UNIT_TEST, READING_WORDS_PER_MINUTE } from "@/shared/types";
import type { HoursBreakdown, HoursFigure, PracticeCounts } from "./types";

/** Gaps longer than this between two recorded actions count as a break, not study. */
export const MEASURED_GAP_MS = 10 * 60_000;

/** One course as the hours need it. */
export type CourseFacts = {
  /** The words a lesson of this course is written to, for its audience. */
  lessonWords: { min: number; max: number };
  /** Practice cases per lesson: 2 for syllabus lessons for readers old enough, else 0. */
  practiceCasesPerTopic: number;
  /**
   * What the course plans, when it is known: from its syllabus (draft or map), or the topics of a
   * map built before syllabi. Null for a course not started yet: SYLLABUS_SHAPE gives a range.
   */
  plan: { topics: number; units: number; unitTests: boolean; finalQuestions: number } | null;
  /** Words of each lesson written so far. */
  writtenWords: number[];
  /** ISO timestamps of this learner's recorded activity on the course's map. */
  activity: string[];
};

const round1 = (hours: number) => Math.round(hours * 10) / 10;
const toHours = (words: number) => words / READING_WORDS_PER_MINUTE / 60;
const thousands = (n: number) => n.toLocaleString("en-CA");

/** Topics a course will have: exactly, once planned; else the range SYLLABUS_SHAPE allows. */
export function plannedTopicRange(course: Pick<CourseFacts, "plan">): { min: number; max: number } {
  if (course.plan) return { min: course.plan.topics, max: course.plan.topics };
  return { min: SYLLABUS_SHAPE.units * SYLLABUS_SHAPE.topicsPerUnit.min, max: SYLLABUS_SHAPE.units * SYLLABUS_SHAPE.topicsPerUnit.max };
}

/** Units a course will have: its syllabus's, else SYLLABUS_SHAPE's 8. */
export function plannedUnits(course: Pick<CourseFacts, "plan">): number {
  return course.plan?.units ?? SYLLABUS_SHAPE.units;
}

function lengthPhrase(courses: CourseFacts[]): string {
  const lengths = [...new Set(courses.map((c) => `${thousands(c.lessonWords.min)} to ${thousands(c.lessonWords.max)}`))];
  return lengths.length === 1 ? `${lengths[0]} words a lesson` : `${lengths.join(" or ")} words a lesson, by course`;
}

/** Planned topics x lesson words / 200 words a minute. A range while some course is not planned yet. */
export function plannedHours(courses: CourseFacts[]): HoursFigure {
  if (courses.length === 0) {
    return { kind: "planned", hours: null, label: "planned", basis: "There are no courses to count yet." };
  }
  let minWords = 0;
  let maxWords = 0;
  let minTopics = 0;
  let maxTopics = 0;
  for (const course of courses) {
    const topics = plannedTopicRange(course);
    minTopics += topics.min;
    maxTopics += topics.max;
    minWords += topics.min * course.lessonWords.min;
    maxWords += topics.max * course.lessonWords.max;
  }
  const hours = round1(toHours(minWords));
  const hoursMax = round1(toHours(maxWords));
  const topicPhrase = minTopics === maxTopics ? `${thousands(minTopics)} planned topics` : `${thousands(minTopics)} to ${thousands(maxTopics)} planned topics`;
  return {
    kind: "planned",
    hours,
    ...(hoursMax !== hours && { hoursMax }),
    label: "planned",
    basis: `${topicPhrase} x ${lengthPhrase(courses)}, read at ${READING_WORDS_PER_MINUTE} words a minute. Practice and tests are not in this figure.`,
  };
}

/** The words of the lessons written so far / 200 words a minute. Null before any lesson is written. */
export function writtenHours(courses: CourseFacts[]): HoursFigure {
  const lessons = courses.flatMap((c) => c.writtenWords);
  if (lessons.length === 0) {
    return { kind: "written", hours: null, label: "written", basis: "No lesson has been written yet. Each is written when it is first opened." };
  }
  const words = lessons.reduce((sum, n) => sum + n, 0);
  return {
    kind: "written",
    hours: round1(toHours(words)),
    label: "written",
    basis: `${thousands(words)} words in the ${thousands(lessons.length)} lesson${lessons.length === 1 ? "" : "s"} written so far, read at ${READING_WORDS_PER_MINUTE} words a minute.`,
  };
}

/** Sum of the gaps under 10 minutes between consecutive timestamps. Longer gaps count as breaks. */
export function measuredMs(timestamps: string[]): number {
  const times = timestamps
    .map((time) => Date.parse(time))
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > 0 && gap < MEASURED_GAP_MS) total += gap;
  }
  return total;
}

/** Time measured from this learner's own activity, course by course. Null before there are two actions to measure between. */
export function measuredHours(courses: CourseFacts[]): HoursFigure {
  const actions = courses.reduce((sum, c) => sum + c.activity.length, 0);
  const basis =
    "Your own recorded activity (teach-back attempts, proofs and test questions): the gaps under 10 minutes between them, added up. Reading before your first attempt on a topic is not recorded.";
  if (actions < 2) return { kind: "measured", hours: null, label: "measured", basis };
  const ms = courses.reduce((sum, c) => sum + measuredMs(c.activity), 0);
  return { kind: "measured", hours: round1(ms / 3_600_000), label: "measured", basis };
}

export function hoursBreakdown(courses: CourseFacts[]): HoursBreakdown {
  return { planned: plannedHours(courses), written: writtenHours(courses), measured: measuredHours(courses) };
}

/**
 * Practice as item counts, for the courses whose plan is known (a syllabus, or a built map).
 * A course not started yet has no topic count to multiply, so it adds nothing here.
 */
export function practiceCounts(courses: CourseFacts[], quizQuestionsPerTopic: number): PracticeCounts {
  const counts: PracticeCounts = { teachBacks: 0, quizQuestions: 0, practiceCases: 0, unitTestQuestions: 0, finalQuestions: 0 };
  for (const course of courses) {
    if (!course.plan) continue;
    counts.teachBacks += course.plan.topics;
    counts.quizQuestions += course.plan.topics * quizQuestionsPerTopic;
    counts.practiceCases += course.plan.topics * course.practiceCasesPerTopic;
    counts.unitTestQuestions += course.plan.unitTests ? course.plan.units * UNIT_TEST.questions : 0;
    counts.finalQuestions += course.plan.finalQuestions;
  }
  return counts;
}

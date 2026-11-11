import type { CourseLevel, CourseSyllabus } from "@/shared/types";

/*
 * The syllabus shape itself lives in the shared contract, because a learner's map carries it
 * (attached on read) and shared code never imports a feature. It is re-exported here so callers
 * can import it from `@/features/syllabus` too.
 */
export type {
  CourseLevel,
  CourseSyllabus,
  ProgramDepth,
  SyllabusOutcome,
  SyllabusTopic,
  SyllabusUnit,
} from "@/shared/types";
export { SYLLABUS_LIMITS, SYLLABUS_SHAPE, UNIT_TEST, unitTestNodeId } from "@/shared/types";

/** A course as the syllabus prompt sees it: title and summary plus its place in the program. */
export type SyllabusCourseInfo = {
  slug: string;
  title: string;
  summary: string;
  /** Slugs of earlier courses this one requires. */
  requires: string[];
  year?: 1 | 2 | 3 | 4;
  term?: 1 | 2;
  level?: CourseLevel;
  area?: string;
};

/**
 * Everything a canonical syllabus build needs. The caller (programs) loads it from the catalog;
 * the syllabus feature reads nothing from the store itself. Every topic course is a full course
 * (degree shape: 8 units of 4 to 6 topics), whether it was asked for alone or inside a program.
 */
export type SyllabusContext = {
  /** The catalog course: becomes `rootMapId`, the id every learner map's unit cache uses. */
  courseId: string;
  /** The home program's title, or the course title for a course first asked for alone. */
  programTitle: string;
  /** Who the course is for, or empty for a general or adult learner. Decided in code. */
  audience?: string;
  /** The course to plan. */
  course: SyllabusCourseInfo;
  /** Every course of the home program, in order, this one included (only this one when alone). */
  frame: SyllabusCourseInfo[];
  /**
   * Final syllabi of the courses `course.requires` names, each with `courseSlug` set to that
   * course's slug in this frame. The prompt lists their topics so `buildsOn` can point at them as
   * "<courseSlug>:<topicId>", and code keeps only refs that exist here.
   */
  required: CourseSyllabus[];
  /**
   * Topic titles of the other courses of the home program that already have a final syllabus.
   * A new topic whose title has word-Jaccard >= 0.8 with one of them is dropped.
   */
  siblings: { slug: string; topics: string[] }[];
};

import "server-only";

export type {
  CourseLevel,
  CourseSyllabus,
  SyllabusContext,
  SyllabusCourseInfo,
  SyllabusOutcome,
  SyllabusTopic,
  SyllabusUnit,
} from "./types";
export { SYLLABUS_LIMITS, SYLLABUS_SHAPE, UNIT_TEST, unitTestNodeId } from "./types";

export { MIN_REPAIR_MS, streamSyllabus, SYLLABUS_FAILED, type SyllabusHooks } from "./generate";
export { jaccard, MIN_UNITS, SIBLING_TOPIC_OVERLAP, SyllabusBuilder, syllabusLine, titleWords } from "./lines";
export { buildRepairPrompt, buildSyllabusPrompt, SYLLABUS_LINES_SYSTEM } from "./prompt";

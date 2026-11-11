import "server-only";
import type { SkillMap } from "@/shared/types";

export {
  COURSE_STILL_PLANNING,
  createCourseMap,
  createProgramOrMap,
  getProgramView,
  openCourse,
  PROGRAM_NOT_FOUND,
  resumePlanning,
  startCatalogCourse,
  startCatalogProgram,
  startUnit,
} from "./programs";
export { ensureCourseBuilt, ensureProgramPlanned, syllabusContextFor, type CourseBuildResult, type EnsureResult } from "./build";
export {
  deadlineFrom,
  ROUTE_BUDGET_MS,
  runCourseBuild,
  runProgramPlanning,
  scheduleCourseBuild,
  scheduleProgramPlanning,
} from "./pregen";
export { getComparisonView, getSyllabusView } from "./views";
export { getProgramPage, listPublicPrograms, publishProgram, startProgram, unpublishProgram } from "./sharing";
export type { StartProgramResult } from "./sharing";
export { deleteProgramsByOwner, listMyPrograms, listProgramsByOwner, type ProgramSummary } from "./storage";
export type {
  ComparisonView,
  CourseView,
  CreateProgramRequest,
  CreateProgramResponse,
  OpenCourseResponse,
  OpenCourseResult,
  Program,
  ProgramDepth,
  ProgramPage,
  ProgramPlanning,
  ProgramPollResponse,
  ProgramShape,
  ProgramSharing,
  ProgramView,
  PublicProgram,
  PublicProgramView,
  ResumePlanningResponse,
  StartUnitResponse,
  SyllabusView,
} from "./types";

/**
 * @deprecated Wave 1 adopted a source map's syllabus onto a circle copy. A catalog course's
 * syllabus is attached on read now, so this returns the map unchanged. Kept only until
 * `GET /api/maps/[id]` (WP-C) stops calling it.
 */
export async function adoptCourseSyllabus(map: SkillMap): Promise<SkillMap> {
  return map;
}

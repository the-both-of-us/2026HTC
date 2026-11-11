import "server-only";

/*
 * The shared catalog: a registry of canonical topic courses and programs, with identity, names
 * and the resolver. It does no generation (programs and syllabus do). See README.md.
 */

export { aliasHash, audKey, catalogKeys, subjectTokens, titleJaccard, titleKey } from "./identity";
export {
  assembleCourses,
  assembleProgram,
  assembleSyllabus,
  getCatalogCourse,
  getCatalogProgram,
  getFinalSyllabus,
  getProgramSeed,
  isCatalogId,
  readCatalogProgram,
  readCatalogSyllabus,
} from "./read";
export {
  BROWSE_CACHE_MS,
  listSharedCourses,
  listSharedPrograms,
  MAX_BROWSE_RESULTS,
  resetBrowseCacheForTests,
  toSharedCourse,
  toSharedProgram,
} from "./browse";
export type { SharedCourse, SharedProgram } from "./browse";
export { claimCourse, claimCourseAlias, claimProgram, findCourseByName } from "./claims";
export { checkedPick, MAX_CANDIDATES, resolveAuto, resolveCourse, resolveCourses, resolveProgram } from "./resolve";

export type {
  AudienceKey,
  AutoResolution,
  CatalogClaim,
  CatalogCourse,
  CatalogNameEntry,
  CatalogProgram,
  CatalogProgramCourse,
  CatalogProgramRead,
  CatalogProgramSeed,
  CatalogSyllabusRead,
  CourseResolution,
  ProgramPart,
  ProgramResolution,
  ResolveRequest,
  SyllabusPart,
} from "./types";

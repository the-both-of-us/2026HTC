import { claimDoc, deleteDoc, getDoc, listDocs, listKeys, putDoc } from "@/shared/store";
import type { Program } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who is building a course's map, and under which id. Claimed once, so two clicks make one map. */
export type CourseClaim = { mapId: string; claimedAt: string };

const programKey = (id: string) => `programs/${id}`;
const claimKey = (programId: string, slug: string) => `program-courses/${programId}/${slug}`;

export async function saveProgram(program: Program): Promise<void> {
  await putDoc(programKey(program.id), program);
}

/** Returns the program, or null. The id comes from a URL, so it must look like one of ours. */
export async function getProgram(id: string): Promise<Program | null> {
  if (!UUID_PATTERN.test(id)) return null;
  return getDoc<Program>(programKey(id));
}

export async function claimCourse(programId: string, slug: string, claim: CourseClaim): Promise<boolean> {
  return claimDoc(claimKey(programId, slug), claim);
}

export async function getCourseClaim(programId: string, slug: string): Promise<CourseClaim | null> {
  return getDoc<CourseClaim>(claimKey(programId, slug));
}

export async function releaseCourse(programId: string, slug: string): Promise<void> {
  await deleteDoc(claimKey(programId, slug));
}

/**
 * Records a built course's map id on the program. Two courses saved at the same moment
 * could overwrite each other here, so readers also check the claims (see withClaims).
 */
export async function saveCourseMapId(programId: string, slug: string, mapId: string): Promise<void> {
  const program = await getProgram(programId);
  if (!program) return;
  const courses = program.courses.map((course) => (course.slug === slug ? { ...course, mapId } : course));
  await saveProgram({ ...program, courses });
}

/** Fills in any map id that only its claim knows about yet. */
export async function withClaims(program: Program): Promise<Program> {
  const claims = await Promise.all(
    program.courses.map((course) => (course.mapId ? null : getCourseClaim(program.id, course.slug))),
  );
  const courses = program.courses.map((course, index) => ({
    ...course,
    mapId: course.mapId ?? claims[index]?.mapId,
  }));
  return { ...program, courses };
}

/** One user's programs, newest first. It reads every program, which is fine at this size. */
export async function listProgramsByOwner(ownerId: string): Promise<Program[]> {
  const programs = await listDocs<Program>("programs/");
  return programs
    .filter((program) => program.ownerId === ownerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A program as a list row, for "My programs" in /courses or the dashboard. No owner id, no source text. */
export type ProgramSummary = { id: string; title: string; summary: string; courseCount: number; href: string };

export async function listMyPrograms(userId: string): Promise<ProgramSummary[]> {
  const programs = await listProgramsByOwner(userId);
  return programs.map((program) => ({
    id: program.id,
    title: program.title,
    summary: program.summary,
    courseCount: program.courses.length,
    href: `/program/${program.id}`,
  }));
}

/**
 * For "Delete my data": removes this user's programs and their course claims.
 * The course maps themselves are maps, so they go with the user's other maps.
 */
export async function deleteProgramsByOwner(ownerId: string): Promise<number> {
  const programs = await listProgramsByOwner(ownerId);
  for (const program of programs) {
    const keys = await listKeys(`program-courses/${program.id}/`);
    await Promise.all(keys.map((key) => deleteDoc(key)));
    await deleteDoc(programKey(program.id));
  }
  return programs.length;
}

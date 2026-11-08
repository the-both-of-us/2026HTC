import { randomUUID } from "node:crypto";
import {
  checkPostingText,
  checkTopicText,
  generateCourseMap,
  generateSkillMap,
  getSkillMap,
} from "@/features/skill-map";
import { getPassedFinal, getProgress } from "@/features/teachback";
import { HttpError } from "@/shared/http";
import type { ProgramLink } from "@/shared/types";
import { findSampleProgram, isSamplePosting, sampleCourseOutput } from "./fixtures";
import { askModelForPlan, cleanPlan } from "./plan";
import {
  claimCourse,
  getCourseClaim,
  getProgram,
  releaseCourse,
  saveCourseMapId,
  saveProgram,
  withClaims,
} from "./storage";
import type { CourseView, Program, ProgramShape, ProgramView } from "./types";
import { courseStates } from "./unlock";

/** After this long, a claim whose map never appeared counts as a build that died. */
const STALE_CLAIM_MS = 3 * 60_000;
const NOT_FOUND = "We could not find that program. Check the link, or plan a new one.";

/**
 * Plans a program, or builds one map when the input is narrow. "auto" lets the model
 * decide, "program" always plans one, "course" never does. Returns where to go next.
 */
export async function createProgramOrMap(input: {
  text: string;
  kind: "posting" | "topic";
  shape: ProgramShape;
  ownerId: string;
}): Promise<{ programId: string } | { mapId: string }> {
  const text = input.kind === "topic" ? checkTopicText(input.text) : checkPostingText(input.text);
  const oneCourse = async () => ({ mapId: (await generateSkillMap({ text, kind: input.kind, ownerId: input.ownerId })).id });
  if (input.shape === "course") return oneCourse();

  const sample = input.kind === "posting" ? findSampleProgram(text) : null;
  // The other samples have no saved plan. On "auto" they stay one course, so the demo stays instant.
  if (!sample && input.shape === "auto" && input.kind === "posting" && isSamplePosting(text)) return oneCourse();

  const raw = sample?.plan ?? (await askModelForPlan(text, input.kind));
  if (input.shape === "auto" && !raw.isBroad && raw.isLearnable) return oneCourse();

  const plan = cleanPlan(raw);
  const program: Program = {
    id: randomUUID(),
    ownerId: input.ownerId,
    ...plan,
    sourceKind: input.kind,
    sourceText: text,
    sampleId: sample?.sampleId,
    createdAt: new Date().toISOString(),
  };
  await saveProgram(program);
  return { programId: program.id };
}

/** The program and its owner's progress, or null when it is missing. Throws 403 for someone else's. */
async function loadOwnProgram(programId: string, userId: string | null) {
  const stored = await getProgram(programId);
  if (!stored) return null;
  if (stored.ownerId !== userId) {
    throw new HttpError("This program is private, so only the person who planned it can open it.", 403);
  }
  const program = await withClaims(stored);

  // For each built course: how many topics it has and how many are proved.
  const counts = await Promise.all(
    program.courses.map(async (course) => {
      const map = course.mapId ? await getSkillMap(course.mapId) : null;
      if (!map) return undefined;
      const progress = await getProgress(map.id, stored.ownerId);
      const proven = map.nodes.filter((node) => progress?.proven[node.id]).length;
      // Only read once every topic is proved, because the final interview can't open before that.
      const badge = proven === map.nodes.length && (await getPassedFinal(map.id)) !== null;
      return { proven, total: map.nodes.length, mapId: map.id, badge };
    }),
  );
  const progress = Object.fromEntries(program.courses.map((course, i) => [course.slug, counts[i]]));
  return { program, progress, states: courseStates(program.courses, progress) };
}

/** What the program page shows. Null when there is no such program. */
export async function getProgramView(programId: string, userId: string | null): Promise<ProgramView | null> {
  const loaded = await loadOwnProgram(programId, userId);
  if (!loaded) return null;
  const { program, progress, states } = loaded;

  const courses: CourseView[] = program.courses.map((course, index) => ({
    slug: course.slug,
    number: index + 1,
    title: course.title,
    summary: course.summary,
    mapId: progress[course.slug]?.mapId ?? null,
    proven: progress[course.slug]?.proven ?? 0,
    total: progress[course.slug]?.total ?? null,
    badge: progress[course.slug]?.badge ?? false,
    ...states[course.slug],
  }));
  return {
    id: program.id,
    title: program.title,
    summary: program.summary,
    sourceKind: program.sourceKind,
    isSample: Boolean(program.sampleId),
    courses,
  };
}

/**
 * Opens a course: returns its map, building it first if this is the first visit.
 * The claim makes sure two people (or two clicks) opening at once make one map:
 * the loser gets "building" and asks again shortly.
 */
export async function openCourse(
  programId: string,
  slug: string,
  userId: string | null,
): Promise<{ status: "ready"; mapId: string } | { status: "building" }> {
  const loaded = await loadOwnProgram(programId, userId);
  if (!loaded) throw new HttpError(NOT_FOUND, 404);
  const { program, progress, states } = loaded;

  const index = program.courses.findIndex((course) => course.slug === slug);
  if (index === -1) throw new HttpError("That course is not part of this program.", 404);
  const course = program.courses[index];

  const built = progress[slug];
  if (built) return { status: "ready", mapId: built.mapId };

  const { blockers } = states[slug];
  if (blockers.length > 0) {
    throw new HttpError(`Prove half of "${blockers[0].title}" first, and this course opens.`, 409);
  }

  const mapId = randomUUID();
  if (!(await claimCourse(program.id, slug, { mapId, claimedAt: new Date().toISOString() }))) {
    const claim = await getCourseClaim(program.id, slug);
    const age = claim ? Date.now() - Date.parse(claim.claimedAt) : Infinity;
    // A claim with no map yet is a build in progress, unless it is old enough to have died.
    if (age < STALE_CLAIM_MS) return { status: "building" };
    await releaseCourse(program.id, slug);
    return openCourse(programId, slug, userId);
  }

  const link: ProgramLink = {
    id: program.id,
    title: program.title,
    courseNumber: index + 1,
    courseCount: program.courses.length,
    unlocks: program.courses.filter((other) => other.requires.includes(slug)).map((other) => other.title),
  };
  try {
    await generateCourseMap({
      id: mapId,
      ownerId: program.ownerId,
      program: link,
      cached: sampleCourseOutput(program.sampleId, slug),
      course: {
        programTitle: program.title,
        courseTitle: course.title,
        courseSummary: course.summary,
        otherCourses: program.courses.filter((other) => other.slug !== slug).map((other) => other.title),
      },
    });
  } catch (error) {
    // Free the course, so the next click tries again.
    await releaseCourse(program.id, slug);
    throw error;
  }
  await saveCourseMapId(program.id, slug, mapId);
  return { status: "ready", mapId };
}

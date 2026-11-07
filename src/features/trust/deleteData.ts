import { deleteCircleData } from "@/features/circles";
import { isPublished, unpublishCourse } from "@/features/courses";
import { deleteGridSolves } from "@/features/grid";
import { deleteProofsByOwner } from "@/features/proof";
import { deleteSkillMap, listMapsByOwner } from "@/features/skill-map";
import { deleteLearnerData } from "@/features/teachback";

/** What "Delete my data" removed, so the page can say it in numbers. */
export type DeletedCounts = {
  maps: number;
  attempts: number;
  provenSkills: number;
  evidencePages: number;
  courses: number;
  gridAnswers: number;
  /** Study circles left, including any this user started, which close for everyone. */
  circles: number;
};

export const NOTHING_DELETED: DeletedCounts = {
  maps: 0,
  attempts: 0,
  provenSkills: 0,
  evidencePages: 0,
  courses: 0,
  gridAnswers: 0,
  circles: 0,
};

/**
 * Deletes everything one person made: their evidence pages, course listings, attempts,
 * proven skills, grid answers, study circles and maps. Public things go first, so they stop showing straight away.
 * Maps go last, because the steps before look things up through them.
 *
 * Every step only touches records whose owner is this user, so nobody else's work changes.
 * If a step fails, the error goes up and the caller can simply run it again.
 */
export async function deleteUserData(userId: string): Promise<DeletedCounts> {
  const evidencePages = await deleteProofsByOwner(userId);

  const maps = await listMapsByOwner(userId);
  const published = await Promise.all(maps.map((map) => isPublished(map.id)));
  const listed = maps.filter((_, index) => published[index]);
  await Promise.all(listed.map((map) => unpublishCourse(map.id, userId)));

  const learner = await deleteLearnerData(userId);
  const gridAnswers = await deleteGridSolves(userId);
  // Before the maps, so no circle points at a map that is gone.
  const { memberships } = await deleteCircleData(userId);
  await Promise.all(maps.map((map) => deleteSkillMap(map.id)));

  return { maps: maps.length, ...learner, evidencePages, courses: listed.length, gridAnswers, circles: memberships };
}

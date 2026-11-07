import { deleteCircleData } from "@/features/circles";
import { isPublished, unpublishCourse } from "@/features/courses";
import { deleteGridSolves } from "@/features/grid";
import { deleteLessonsForMaps } from "@/features/lessons";
import { deleteUserData as deleteNetworkProfile } from "@/features/network";
import { deleteProgramsByOwner } from "@/features/programs";
import { deleteProofsByOwner } from "@/features/proof";
import { deleteUserData as deleteReviewData } from "@/features/review";
import { deleteSkillMap, listMapsByOwner } from "@/features/skill-map";
import { deleteStreak } from "@/features/streaks";
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
  /** The public profile on /people: 0 or 1. */
  networkProfiles: number;
  /** Spaced-repetition state and the review day log. */
  reviewRecords: number;
};

export const NOTHING_DELETED: DeletedCounts = {
  maps: 0,
  attempts: 0,
  provenSkills: 0,
  evidencePages: 0,
  courses: 0,
  gridAnswers: 0,
  circles: 0,
  networkProfiles: 0,
  reviewRecords: 0,
};

/**
 * Deletes everything one person made: their public people profile, evidence pages, course listings, attempts,
 * proven skills, grid answers, streak, study circles, programs and maps. Public things go first, so they stop showing straight away.
 * Maps go last, because the steps before look things up through them.
 *
 * Every step only touches records whose owner is this user, so nobody else's work changes.
 * If a step fails, the error goes up and the caller can simply run it again.
 */
export async function deleteUserData(userId: string): Promise<DeletedCounts> {
  // First, because the profile is public: it must stop showing on /people straight away.
  const { profiles } = await deleteNetworkProfile(userId);
  const evidencePages = await deleteProofsByOwner(userId);

  const maps = await listMapsByOwner(userId);
  const published = await Promise.all(maps.map((map) => isPublished(map.id)));
  const listed = maps.filter((_, index) => published[index]);
  await Promise.all(listed.map((map) => unpublishCourse(map.id, userId)));

  const learner = await deleteLearnerData(userId);
  const gridAnswers = await deleteGridSolves(userId);
  const { reviewRecords } = await deleteReviewData(userId);
  await deleteStreak(userId);
  // Before the maps, so no circle points at a map that is gone.
  const { memberships } = await deleteCircleData(userId);
  await deleteProgramsByOwner(userId);
  // Lessons written for these maps go too. They hold no answers, but they came from your maps.
  await deleteLessonsForMaps(maps.map((map) => map.id));
  await Promise.all(maps.map((map) => deleteSkillMap(map.id)));

  return {
    maps: maps.length,
    ...learner,
    evidencePages,
    courses: listed.length,
    gridAnswers,
    circles: memberships,
    networkProfiles: profiles,
    reviewRecords,
  };
}

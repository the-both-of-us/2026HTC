import { isPublished } from "@/features/courses";
import type { SkillMap } from "@/shared/types";

/**
 * Who may read a map: its owner, or anyone once it is published as a course.
 *
 * This sits at route level, not in skill-map, because courses imports skill-map
 * and the reverse would be a circular import. It is shared by the API route and
 * the map page. The public evidence page never reads a map: it shows what its
 * owner chose to publish, frozen at that moment.
 */
export async function canReadMap(map: SkillMap, userId: string | null): Promise<boolean> {
  return map.ownerId === userId || (await isPublished(map.id));
}

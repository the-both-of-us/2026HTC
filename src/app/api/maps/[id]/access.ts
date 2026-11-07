import { getDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";

/**
 * Who may read a map: its owner, or anyone once it is published as a course.
 *
 * This sits at route level, not in skill-map, because courses imports skill-map
 * and the reverse would be a circular import. It is shared by the API route and
 * the map page. The public evidence page reads maps with getSkillMap on the server
 * and is deliberately not gated by this.
 */
export async function canReadMap(map: SkillMap, userId: string | null): Promise<boolean> {
  return map.ownerId === userId || (await isPublished(map.id));
}

/** Swap this for isPublished from @/features/courses once that is on main. */
async function isPublished(mapId: string): Promise<boolean> {
  return (await getDoc(`courses/${mapId}`)) !== null;
}

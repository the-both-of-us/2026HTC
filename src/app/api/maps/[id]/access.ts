import type { SkillMap } from "@/shared/types";

/**
 * Who may read a map: only its owner. Shared by the API route and the map page. The public
 * evidence page never reads a map: it shows what its owner chose to publish, frozen at that moment.
 */
export function canReadMap(map: SkillMap, userId: string | null): boolean {
  return map.ownerId === userId;
}

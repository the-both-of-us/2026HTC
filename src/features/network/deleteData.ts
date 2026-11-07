import { deleteProfile } from "./profiles";
import { isUserId } from "./session";

/**
 * For "Delete my data": removes this person's network profile. Their skills were never
 * stored here (they are worked out from their maps), so nothing else needs deleting.
 *
 * Only UUID ids are accepted, so a demo profile's id or anything that could reach another
 * key is refused. Running it twice is harmless.
 */
export async function deleteUserData(userId: string): Promise<{ profiles: number }> {
  if (!isUserId(userId)) return { profiles: 0 };
  return { profiles: (await deleteProfile(userId)) ? 1 : 0 };
}

import { deleteAll } from "./storage";
import { isUuid } from "@/shared/ids";

/**
 * For "Delete my data": removes everything under review/<userId>/, card schedules and the
 * daily log. Only UUID ids are accepted, and it can run twice. Returns how many documents went.
 */
export async function deleteUserData(userId: string): Promise<{ reviewRecords: number }> {
  if (!isUuid(userId)) return { reviewRecords: 0 };
  return { reviewRecords: await deleteAll(userId) };
}

import { deleteDoc } from "@/shared/store";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Delete my data" still removes an old `settings/<userId>` document. AI model settings are gone
 * (one model now), so nothing reads or writes these any more.
 */
export async function deleteAiSettings(userId: string): Promise<void> {
  if (UUID_PATTERN.test(userId)) await deleteDoc(`settings/${userId}`);
}

import { deleteUserData, NOTHING_DELETED } from "@/features/trust";
import { errorResponse } from "@/shared/http";
import { clearSession, readUserId } from "@/shared/identity";

/**
 * "Delete my data": removes everything this browser's user made, then starts a fresh guest.
 * The session is only cleared once deleting worked, so a failure can simply be retried.
 */
export async function DELETE() {
  try {
    const userId = await readUserId();
    const deleted = userId ? await deleteUserData(userId) : NOTHING_DELETED;
    await clearSession();
    return Response.json({ deleted });
  } catch (error) {
    return errorResponse(
      error,
      "Not everything could be deleted just now. What was already deleted stays deleted. Please try again.",
    );
  }
}

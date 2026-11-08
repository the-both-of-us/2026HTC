import { networkErrorResponse, removeFriendRequest } from "@/features/network";
import { getUserId } from "@/shared/identity";

/** Declines a request from this person, or cancels yours to them. Twice is fine. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ publicId: string }> },
) {
  try {
    const { publicId } = await params;
    await removeFriendRequest(await getUserId(), publicId);
    return Response.json({ ok: true });
  } catch (error) {
    return networkErrorResponse(error);
  }
}

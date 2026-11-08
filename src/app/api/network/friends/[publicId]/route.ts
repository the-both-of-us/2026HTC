import { networkErrorResponse, removeFriend } from "@/features/network";
import { getUserId } from "@/shared/identity";

/** Removes a friend, both ways. Removing twice is fine. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ publicId: string }> },
) {
  try {
    const { publicId } = await params;
    await removeFriend(await getUserId(), publicId);
    return Response.json({ ok: true });
  } catch (error) {
    return networkErrorResponse(error);
  }
}

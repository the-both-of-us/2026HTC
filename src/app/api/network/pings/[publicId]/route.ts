import { dismissPing, networkErrorResponse } from "@/features/network";
import { getUserId } from "@/shared/identity";

/** Dismisses a ping from this friend. Twice is fine. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ publicId: string }> },
) {
  try {
    const { publicId } = await params;
    await dismissPing(await getUserId(), publicId);
    return Response.json({ ok: true });
  } catch (error) {
    return networkErrorResponse(error);
  }
}

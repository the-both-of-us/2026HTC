import { acceptFriendRequest, networkErrorResponse } from "@/features/network";
import { getUserId } from "@/shared/identity";

/** Accepts this person's friend request. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ publicId: string }> },
) {
  try {
    const { publicId } = await params;
    return Response.json(await acceptFriendRequest(await getUserId(), publicId));
  } catch (error) {
    return networkErrorResponse(error);
  }
}

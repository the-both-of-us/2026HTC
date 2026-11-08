import { getUserId } from "@/shared/identity";
import { networkErrorResponse, parsePublicIdBody, sendFriendRequest } from "@/features/network";

/** Sends a friend request to someone in the network, or accepts theirs if they already asked. */
export async function POST(request: Request) {
  try {
    const { publicId } = await parsePublicIdBody(request);
    return Response.json(await sendFriendRequest(await getUserId(), publicId));
  } catch (error) {
    return networkErrorResponse(error);
  }
}

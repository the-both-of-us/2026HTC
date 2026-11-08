import { getUserId } from "@/shared/identity";
import { networkErrorResponse, parsePublicIdBody, pingFriend } from "@/features/network";

/** Pings a friend, at most once an hour. */
export async function POST(request: Request) {
  try {
    const { publicId } = await parsePublicIdBody(request);
    return Response.json(await pingFriend(await getUserId(), publicId));
  } catch (error) {
    return networkErrorResponse(error);
  }
}

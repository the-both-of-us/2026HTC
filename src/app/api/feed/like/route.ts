import { reactionBody, setReaction } from "@/features/feed";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

/** Sets whether the viewer likes a card. Sending the same value twice changes nothing. */
export async function POST(request: Request) {
  try {
    const { cardId, on } = await parseBody(request, reactionBody);
    return Response.json(await setReaction(await getUserId(), "like", cardId, on));
  } catch (error) {
    return errorResponse(error, "That did not save. Please try again.");
  }
}

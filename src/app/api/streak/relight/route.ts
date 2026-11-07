import { answerRelight, relightBody, startRelight } from "@/features/streaks";
import { getUserId } from "@/shared/identity";
import { errorResponse, parseBody } from "@/shared/http";

export const maxDuration = 60;

/** Without an answer: the quick-check question. With one: whether it relit the topic. */
export async function POST(request: Request) {
  try {
    const { mapId, nodeId, answer } = await parseBody(request, relightBody);
    const userId = await getUserId();
    if (answer === undefined) return Response.json(await startRelight(userId, mapId, nodeId));
    return Response.json(await answerRelight(userId, mapId, nodeId, answer));
  } catch (error) {
    return errorResponse(error, "Your answer could not be checked just now. Please try again.");
  }
}

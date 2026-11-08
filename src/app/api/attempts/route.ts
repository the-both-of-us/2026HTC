import { recordProved } from "@/features/streaks";
import { newAttemptBody, startAttempt, toLearnerView } from "@/features/teachback";
import { getUserId } from "@/shared/identity";
import { errorResponse, parseBody } from "@/shared/http";

// Up to two model calls: grading, then writing the follow-up question.
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const input = await parseBody(request, newAttemptBody);
    const userId = await getUserId();
    const attempt = await startAttempt(userId, input);
    // "Catch the mistake" has no follow-up, so a pass proves the topic here. It keeps the streak too.
    if (attempt.status === "proven") {
      await recordProved(userId, { mapId: attempt.mapId, nodeId: attempt.nodeId, attemptId: attempt.id });
    }
    return Response.json(toLearnerView(attempt));
  } catch (error) {
    return errorResponse(error, "Something went wrong on our side, and your answer was not saved. Please try again.");
  }
}

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
    return Response.json(toLearnerView(attempt));
  } catch (error) {
    return errorResponse(error, "Something went wrong on our side, and your answer was not saved. Please try again.");
  }
}

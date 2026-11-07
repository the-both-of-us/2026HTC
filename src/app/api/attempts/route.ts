import { errorResponse, newAttemptBody, parseBody, startAttempt, toLearnerView } from "@/features/teachback";
import { getUserId } from "@/shared/identity";

// Up to two model calls: grading, then writing the follow-up question.
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const input = await parseBody(request, newAttemptBody);
    const userId = await getUserId();
    const attempt = await startAttempt(userId, input);
    return Response.json(toLearnerView(attempt));
  } catch (error) {
    return errorResponse(error);
  }
}

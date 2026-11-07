import { answerFollowUp, followUpBody, toLearnerView } from "@/features/teachback";
import { getUserId } from "@/shared/identity";
import { errorResponse, parseBody } from "@/shared/http";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { answer, ...details } = await parseBody(request, followUpBody);
    const userId = await getUserId();
    const attempt = await answerFollowUp(userId, id, answer, details);
    return Response.json(toLearnerView(attempt));
  } catch (error) {
    return errorResponse(error, "Something went wrong on our side, and your answer was not saved. Please try again.");
  }
}

import { answerFollowUp, errorResponse, followUpBody, parseBody, toLearnerView } from "@/features/teachback";
import { getUserId } from "@/shared/identity";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { answer } = await parseBody(request, followUpBody);
    const userId = await getUserId();
    const attempt = await answerFollowUp(userId, id, answer);
    return Response.json(toLearnerView(attempt));
  } catch (error) {
    return errorResponse(error);
  }
}

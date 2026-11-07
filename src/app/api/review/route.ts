import { getReviewQueue, gradeCard, parseGradeBody, reviewErrorResponse } from "@/features/review";
import { getUserId } from "@/shared/identity";

/** Your review queue: due cards first, then up to 20 new ones. Only your own maps. */
export async function GET() {
  try {
    const userId = await getUserId();
    return Response.json(await getReviewQueue(userId));
  } catch (error) {
    return reviewErrorResponse(error);
  }
}

/** Grades one card on one of your own maps and returns when it comes back. */
export async function POST(request: Request) {
  try {
    const body = await parseGradeBody(request);
    const userId = await getUserId();
    return Response.json(await gradeCard(userId, body));
  } catch (error) {
    return reviewErrorResponse(error);
  }
}

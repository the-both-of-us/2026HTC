import { answersBody, submitPretestAnswers } from "@/features/pretest";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

// Grading is plain code (no model call); the next unit's questions are written after the response,
// inside this route's 120 s.
export const maxDuration = 120;

/**
 * Grades one unit's multiple-choice answers (PretestView with the new results and their review).
 * 400 bad body, 409 not the current unit (also a unit sent twice) / not started / ended / busy.
 */
export async function POST(request: Request, { params }: { params: Promise<{ mapId: string }> }) {
  try {
    const { mapId } = await params;
    const body = await parseBody(request, answersBody);
    return Response.json(await submitPretestAnswers(mapId, await getUserId(), body));
  } catch (error) {
    return errorResponse(error, "Your answers could not be checked this time. Please send them again.");
  }
}

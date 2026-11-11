import { answersBody, submitPretestAnswers } from "@/features/pretest";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

// One check call (at most 15 s) in the request; the next unit's questions are written after the
// response, inside this route's 120 s.
export const maxDuration = 120;

/**
 * Grades one unit's answers (PretestView with the new results). 400 bad body, 409 not the current
 * unit / not started / ended / busy, 503 the check failed (nothing recorded: send again).
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

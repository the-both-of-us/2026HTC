import { startPretest } from "@/features/pretest";
import { errorResponse } from "@/shared/http";
import { getUserId } from "@/shared/identity";

// No model call in the request: the unit's questions (one write call, at most 40 s) are written
// after the response, inside this route's 120 s, and shared by every learner of the course.
export const maxDuration = 120;

/** Starts or resumes the pre-test (PretestView). 400 posting/PDF map, 409 taken already or nothing left, 404 not yours. */
export async function POST(_request: Request, { params }: { params: Promise<{ mapId: string }> }) {
  try {
    const { mapId } = await params;
    return Response.json(await startPretest(mapId, await getUserId()));
  } catch (error) {
    return errorResponse(error, "The pre-test could not start this time. Please try again.");
  }
}

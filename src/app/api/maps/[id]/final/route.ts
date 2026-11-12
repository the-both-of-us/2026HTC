import { getFinalInterview, startFinalInterview, unitOf } from "@/features/teachback";
import { getUserId } from "@/shared/identity";
import { errorResponse } from "@/shared/http";

// Starting writes the multiple-choice questions with one AI call.
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

/** Where the course's final test (or a unit's test) stands. No answer key before it is submitted. */
export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json(await getFinalInterview(await getUserId(), id, unitOf(request)));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Opens the final test once every topic is proven, or a unit's test once that unit's are. A retake writes new questions. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json(await startFinalInterview(await getUserId(), id, unitOf(request)));
  } catch (error) {
    return errorResponse(error, "The test could not start. Please try again.");
  }
}

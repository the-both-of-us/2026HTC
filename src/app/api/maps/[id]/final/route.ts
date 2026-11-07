import { getFinalInterview, startFinalInterview } from "@/features/teachback";
import { getUserId } from "@/shared/identity";
import { errorResponse } from "@/shared/http";

// Starting writes the three questions with one AI call.
export const maxDuration = 60;

/** Where the course's final interview stands. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json(await getFinalInterview(await getUserId(), id));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Opens the final interview once every topic is proven. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json(await startFinalInterview(await getUserId(), id));
  } catch (error) {
    return errorResponse(error, "The final interview could not start. Please try again.");
  }
}

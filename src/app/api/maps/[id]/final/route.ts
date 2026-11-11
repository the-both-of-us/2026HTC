import { getFinalInterview, startFinalInterview } from "@/features/teachback";
import { getUserId } from "@/shared/identity";
import { errorResponse } from "@/shared/http";

// Starting writes the questions with one AI call.
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

/** `?unit=<unitId>` picks a degree unit's test; without it, the course's final interview. */
function unitOf(request: Request): string | undefined {
  const unit = new URL(request.url).searchParams.get("unit");
  return unit && /^[a-z0-9-]{1,20}$/i.test(unit) ? unit : undefined;
}

/** Where the course's final interview (or a unit's test) stands. */
export async function GET(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json(await getFinalInterview(await getUserId(), id, unitOf(request)));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Opens the final interview once every topic is proven, or a unit's test once that unit's are. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    return Response.json(await startFinalInterview(await getUserId(), id, unitOf(request)));
  } catch (error) {
    return errorResponse(error, "The final interview could not start. Please try again.");
  }
}

import { stopPretest } from "@/features/pretest";
import { errorResponse } from "@/shared/http";
import { getUserId } from "@/shared/identity";

/** Ends the pre-test now, keeping what was graded (PretestView). 409 when it was never started. */
export async function POST(_request: Request, { params }: { params: Promise<{ mapId: string }> }) {
  try {
    const { mapId } = await params;
    return Response.json(await stopPretest(mapId, await getUserId()));
  } catch (error) {
    return errorResponse(error, "The pre-test could not be stopped this time. Please try again.");
  }
}

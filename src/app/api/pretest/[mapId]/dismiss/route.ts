import { dismissPretest } from "@/features/pretest";
import { errorResponse } from "@/shared/http";
import { getUserId } from "@/shared/identity";

/** "Not now": the offer stops being suggested and stays available from the map (PretestView). */
export async function POST(_request: Request, { params }: { params: Promise<{ mapId: string }> }) {
  try {
    const { mapId } = await params;
    return Response.json(await dismissPretest(mapId, await getUserId()));
  } catch (error) {
    return errorResponse(error, "That did not save this time. Please try again.");
  }
}

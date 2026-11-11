import { startUnit, type StartUnitResponse } from "@/features/programs";
import { errorResponse } from "@/shared/http";
import { readUserId } from "@/shared/identity";

// No model call in the request: the canonical unit build (one call plus at most one repair) runs
// after the response, inside this route's 120 s, and is shared by every learner of the course.
export const maxDuration = 120;

/**
 * Starts or appends unit `unitId` of the caller's course map. 200 ready once the course's canonical
 * unit exists (appended to the map); 202 building while it is being written (the client asks again
 * every 2 s); 409 until the unit before is half proved.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; unitId: string }> }) {
  const { id, unitId } = await params;
  try {
    const result = await startUnit(id, unitId, await readUserId());
    if (result.status === "building") {
      return Response.json({ status: "building", building: true } satisfies StartUnitResponse, { status: 202 });
    }
    return Response.json({ status: "ready", mapId: result.mapId, unitId: result.unitId } satisfies StartUnitResponse);
  } catch (error) {
    return errorResponse(error, "This unit could not be built this time. Please try again.");
  }
}

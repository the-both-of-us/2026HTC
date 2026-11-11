import { resumePlanning, type ResumePlanningResponse } from "@/features/programs";
import { errorResponse } from "@/shared/http";
import { readUserId } from "@/shared/identity";

// Planning runs in after(), which shares this budget.
export const maxDuration = 120;

/**
 * Owner only: restarts planning of a stalled program ("Try again"). 202 `{ status: "planning" }`
 * once the frame is being written (also when another request already is), 200
 * `{ status: "ready" }` when it is final. 404 for anyone else.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await resumePlanning(id, await readUserId());
    return Response.json(result satisfies ResumePlanningResponse, { status: result.status === "planning" ? 202 : 200 });
  } catch (error) {
    return errorResponse(error, "Planning could not restart right now. Please try again.");
  }
}

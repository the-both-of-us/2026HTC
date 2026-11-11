import { getPretestView } from "@/features/pretest";
import { errorResponse } from "@/shared/http";
import { readUserId } from "@/shared/identity";

/**
 * The caller's pre-test on their course map (PretestView). No writes, no model call: poll it every
 * 1.5 s while `state` is "writing". 404 for a missing map or someone else's.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ mapId: string }> }) {
  try {
    const { mapId } = await params;
    return Response.json(await getPretestView(mapId, await readUserId()));
  } catch (error) {
    return errorResponse(error, "The pre-test could not be loaded. Please try again.");
  }
}

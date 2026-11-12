import { getProgressView } from "@/features/teachback";
import { getUserId } from "@/shared/identity";
import { errorResponse } from "@/shared/http";

/** The owner's progress on a map: { mapId, proven, unlocked, states, knownByPretest }. Anyone else gets a 403. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const userId = await getUserId();
    return Response.json(await getProgressView(userId, id));
  } catch (error) {
    return errorResponse(error);
  }
}

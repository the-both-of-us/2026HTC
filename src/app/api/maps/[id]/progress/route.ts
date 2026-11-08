import { getProgressView } from "@/features/teachback";
import { getUserId } from "@/shared/identity";
import { errorResponse, HttpError } from "@/shared/http";

/**
 * Someone else's map (a sample, a shared link): they see it fresh, so the answer is "not
 * yours, nothing proven", not an error the browser logs. It holds nothing about the owner or
 * the map, not even its states, which would list the node ids of a private map.
 */
const NOT_YOURS = { isOwner: false, proven: {}, unlocked: {} } as const;

/** The owner's progress on a map: { isOwner: true, mapId, proven, unlocked, states }. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const userId = await getUserId();
    return Response.json({ isOwner: true, ...(await getProgressView(userId, id)) });
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) return Response.json(NOT_YOURS);
    return errorResponse(error);
  }
}

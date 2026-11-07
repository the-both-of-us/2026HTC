import { getCatchView } from "@/features/teachback";
import { getUserId } from "@/shared/identity";
import { errorResponse } from "@/shared/http";

// The first visit may write the round with the AI. After that it comes from the store.
export const maxDuration = 60;

/** GET /api/attempts/catch?mapId=…&nodeId=…: a "Catch the mistake" round, without the answers. */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const userId = await getUserId();
    return Response.json(await getCatchView(userId, params.get("mapId") ?? "", params.get("nodeId") ?? ""));
  } catch (error) {
    return errorResponse(error, "The round could not be loaded. Please try again.");
  }
}

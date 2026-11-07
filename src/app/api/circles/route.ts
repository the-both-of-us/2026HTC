import { z } from "zod";
import { startCircle } from "@/features/circles";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

const body = z.object({ mapId: z.string().max(100), name: z.string().max(200) });

/** Starts a study circle for the caller's own map, or returns the one already started. */
export async function POST(request: Request) {
  try {
    const { mapId, name } = await parseBody(request, body);
    return Response.json(await startCircle(await getUserId(), mapId, name));
  } catch (error) {
    return errorResponse(error, "The circle could not be started just now. Please try again.");
  }
}

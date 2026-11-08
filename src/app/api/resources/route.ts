import { z } from "zod";
import { getResources } from "@/features/resources";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

const resourcesRequest = z.object({ mapId: z.string().min(1).max(100), nodeId: z.string().min(1).max(100) });

/** Links for a skill. The skill's title comes from the saved map, never from the request. */
export async function POST(request: Request) {
  try {
    const { mapId, nodeId } = await parseBody(request, resourcesRequest);
    return Response.json(await getResources(mapId, nodeId, await getUserId()));
  } catch (error) {
    return errorResponse(error, "Something went wrong on our side, so resources could not be loaded. Please try again.");
  }
}

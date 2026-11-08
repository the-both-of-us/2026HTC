import { z } from "zod";
import { getSkillReels, type ReelList } from "@/features/reels";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

const reelsRequest = z.object({ mapId: z.string().min(1).max(100), nodeId: z.string().min(1).max(100) });

/** Shorts for a skill. The skill's title comes from the saved map, never from the request. */
export async function POST(request: Request) {
  try {
    const { mapId, nodeId } = await parseBody(request, reelsRequest);
    return Response.json({ reels: await getSkillReels(mapId, nodeId, await getUserId()) } satisfies ReelList);
  } catch (error) {
    return errorResponse(error, "Something went wrong on our side, so videos could not be loaded. Please try again.");
  }
}

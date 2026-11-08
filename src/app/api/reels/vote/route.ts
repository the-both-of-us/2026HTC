import { z } from "zod";
import { voteOnReel, type VoteResult } from "@/features/reels";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

const voteRequest = z.object({
  mapId: z.string().min(1).max(100),
  nodeId: z.string().min(1).max(100),
  videoId: z.string().regex(/^[\w-]{11}$/),
  vote: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
});

/** Like (1), dislike (-1) or take the vote back (0) on one of a skill's videos. */
export async function POST(request: Request) {
  try {
    const { mapId, nodeId, videoId, vote } = await parseBody(request, voteRequest);
    return Response.json((await voteOnReel(mapId, nodeId, videoId, await getUserId(), vote)) satisfies VoteResult);
  } catch (error) {
    return errorResponse(error, "Your vote did not save. Please try again.");
  }
}

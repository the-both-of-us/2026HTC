import { z } from "zod";
import { unlockNode } from "@/features/teachback";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

const unlockRequest = z.object({ nodeId: z.string().min(1).max(100) });

/** "Unlock anyway": opens a locked skill for the map's owner. Returns the new progress view. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { nodeId } = await parseBody(request, unlockRequest);
    return Response.json(await unlockNode(await getUserId(), id, nodeId));
  } catch (error) {
    return errorResponse(error, "Something went wrong on our side, so the skill could not be unlocked. Please try again.");
  }
}

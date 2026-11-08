import { z } from "zod";
import { cheerProof } from "@/features/circles";
import { errorResponse, parseBody } from "@/shared/http";
import { readUserId } from "@/shared/identity";

const body = z.object({ itemId: z.string().max(40) });

/** One tap on a proof in the circle's feed. Members only, and a second tap changes nothing. */
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const { itemId } = await parseBody(request, body);
    const userId = await readUserId();
    if (!userId) return Response.json({ error: "Join the circle to cheer its proofs." }, { status: 403 });
    return Response.json(await cheerProof(userId, code, itemId));
  } catch (error) {
    return errorResponse(error, "That cheer did not go through. Please try again.");
  }
}

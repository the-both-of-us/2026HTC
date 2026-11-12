import { z } from "zod";
import { getPracticeHint } from "@/features/lessons";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

// One short model call for a hint, or none for the model answer.
export const maxDuration = 60;

const hintRequest = z.object({
  mapId: z.string().min(1).max(100),
  nodeId: z.string().min(1).max(100),
  caseIndex: z.number().int().min(0).max(9),
  step: z.number().int().min(1).max(4),
  answer: z.string().max(4_000).optional(),
});

/**
 * Help for a learner stuck on a practice case: `{ hint: { step, kind, text } }`. Steps 1 to 3 are
 * hints that get more specific; step 4 is the model answer. Practice never counts as proof.
 */
export async function POST(request: Request) {
  try {
    const { mapId, nodeId, caseIndex, step, answer } = await parseBody(request, hintRequest);
    const hint = await getPracticeHint(mapId, nodeId, await getUserId(), caseIndex, step, answer);
    return Response.json({ hint });
  } catch (error) {
    return errorResponse(error, "We could not get a hint this time. Please try again.");
  }
}

import { z } from "zod";
import { checkPracticeAnswer } from "@/features/lessons";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

// One short model call that compares the answer with the hidden model answer.
export const maxDuration = 60;

const practiceRequest = z.object({
  mapId: z.string().min(1).max(100),
  nodeId: z.string().min(1).max(100),
  caseIndex: z.number().int().min(0).max(9),
  answer: z.string().max(4_000),
});

/** Checks a learner's answer to one practice case of a degree lesson: `{ feedback }` with a verdict and a note, never the model answer. */
export async function POST(request: Request) {
  try {
    const { mapId, nodeId, caseIndex, answer } = await parseBody(request, practiceRequest);
    const feedback = await checkPracticeAnswer(mapId, nodeId, await getUserId(), caseIndex, answer);
    return Response.json({ feedback });
  } catch (error) {
    return errorResponse(error, "Your answer could not be checked this time. Please try again.");
  }
}

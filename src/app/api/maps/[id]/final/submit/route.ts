import { finalSubmitBody, submitFinalTest, unitOf } from "@/features/teachback";
import { getUserId } from "@/shared/identity";
import { errorResponse, parseBody } from "@/shared/http";

type Context = { params: Promise<{ id: string }> };

/**
 * Submits a whole multiple-choice test once: `{testId, answers}` with the chosen option per
 * question. Graded in code, with no AI call. Returns the test with its result and review.
 */
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const body = await parseBody(request, finalSubmitBody);
    return Response.json(await submitFinalTest(await getUserId(), id, unitOf(request), body));
  } catch (error) {
    return errorResponse(error, "The test could not be submitted. Please try again.");
  }
}

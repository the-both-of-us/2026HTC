import { startProgram } from "@/features/programs";
import { errorResponse } from "@/shared/http";
import { getUserId } from "@/shared/identity";

type Context = { params: Promise<{ id: string }> };

/**
 * Starts a public program: `{ programId }` of the learner's own copy, 201 when it was just
 * made and 200 when it already existed. The owner gets their own program back with a 200.
 */
export async function POST(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const result = await startProgram(id, await getUserId());
    return Response.json({ programId: result.programId }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return errorResponse(error, "This program could not be started this time. Please try again.");
  }
}

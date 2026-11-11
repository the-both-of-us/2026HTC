import { startCatalogProgram } from "@/features/programs";
import { errorResponse } from "@/shared/http";
import { getUserId } from "@/shared/identity";

export const maxDuration = 120;

type Context = { params: Promise<{ programId: string }> };

/**
 * Starts one shared catalog program: `{ programId }` of the viewer's own program following it, 201 when
 * just made and 200 when they already had one. No model call. An unknown program is a 404.
 */
export async function POST(_request: Request, { params }: Context) {
  try {
    const { programId } = await params;
    const result = await startCatalogProgram(programId, await getUserId());
    return Response.json({ programId: result.programId }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return errorResponse(error, "This program could not be started this time. Please try again.");
  }
}

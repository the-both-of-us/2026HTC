import { recordSolve, solveBody } from "@/features/grid";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

/** Saves a correct "Read the Grid" answer, after checking it again here. */
export async function POST(request: Request) {
  try {
    const input = await parseBody(request, solveBody);
    const solve = await recordSolve(await getUserId(), input);
    return Response.json({ solve });
  } catch (error) {
    return errorResponse(error, "We couldn't save that answer. Please try again.");
  }
}

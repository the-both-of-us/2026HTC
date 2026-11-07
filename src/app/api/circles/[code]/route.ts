import { getCircleView } from "@/features/circles";
import { errorResponse } from "@/shared/http";
import { readUserId } from "@/shared/identity";

/** The circle page polls this every few seconds. It holds names, skills and times, never user ids. */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    return Response.json(await getCircleView(code, await readUserId()));
  } catch (error) {
    return errorResponse(error, "The circle could not be loaded just now. Please try again.");
  }
}

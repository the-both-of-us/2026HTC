import { getComparisonView, PROGRAM_NOT_FOUND } from "@/features/programs";
import { errorResponse } from "@/shared/http";
import { readUserId } from "@/shared/identity";

/** Our computed numbers beside sourced university norms. `?course=<slug>` picks the course compared alone. No model call. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const course = new URL(request.url).searchParams.get("course") ?? undefined;
  try {
    const view = await getComparisonView(id, await readUserId(), course || undefined);
    if (!view) return Response.json({ error: PROGRAM_NOT_FOUND }, { status: 404 });
    return Response.json(view);
  } catch (error) {
    return errorResponse(error, "The comparison could not be loaded right now. Please try again.");
  }
}

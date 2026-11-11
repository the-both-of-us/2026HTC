import { getSyllabusView, PROGRAM_NOT_FOUND } from "@/features/programs";
import { errorResponse } from "@/shared/http";
import { readUserId } from "@/shared/identity";

/** The course's syllabus for the program page's "Read the syllabus". No model call. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; slug: string }> }) {
  const { id, slug } = await params;
  try {
    const view = await getSyllabusView(id, slug, await readUserId());
    if (!view) return Response.json({ error: PROGRAM_NOT_FOUND }, { status: 404 });
    return Response.json(view);
  } catch (error) {
    return errorResponse(error, "The syllabus could not be loaded right now. Please try again.");
  }
}

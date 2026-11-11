import { startCatalogCourse } from "@/features/programs";
import { errorResponse } from "@/shared/http";
import { getUserId } from "@/shared/identity";

// A new map schedules its syllabus and unit 1 in after(), which shares this budget.
export const maxDuration = 120;

type Context = { params: Promise<{ courseId: string }> };

/**
 * Starts one shared catalog course: `{ id }` of the viewer's own map of exactly that course, 201 when
 * it was just made and 200 when they already had one. No model call. An unknown course is a 404.
 */
export async function POST(_request: Request, { params }: Context) {
  try {
    const { courseId } = await params;
    const result = await startCatalogCourse(courseId, await getUserId());
    return Response.json({ id: result.mapId }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return errorResponse(error, "This course could not be started this time. Please try again.");
  }
}

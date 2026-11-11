import { openCourse, type OpenCourseResponse } from "@/features/programs";
import { errorResponse } from "@/shared/http";
import { readUserId } from "@/shared/identity";

// Opening makes no model call; the course's syllabus and unit 1 are built in after(), within this budget.
export const maxDuration = 120;

/**
 * Starts a course of the caller's program: 200 `{ status: "ready", mapId }` at once (the map page
 * then shows the syllabus filling in), or 202 `{ status: "building", building: true }` while
 * another request is opening it, so ask again shortly. 409 while it is locked or still being
 * planned, 404 when the program is not the caller's.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; slug: string }> }) {
  const { id, slug } = await params;
  try {
    const result = await openCourse(id, slug, await readUserId());
    if (result.status === "building") {
      return Response.json({ status: "building", building: true } satisfies OpenCourseResponse, { status: 202 });
    }
    return Response.json({ status: "ready", mapId: result.mapId } satisfies OpenCourseResponse);
  } catch (error) {
    return errorResponse(error, "This course could not be opened this time. Please try again.");
  }
}

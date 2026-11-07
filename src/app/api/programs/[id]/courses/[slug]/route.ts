import { openCourse } from "@/features/programs";
import { errorResponse } from "@/shared/http";
import { readUserId } from "@/shared/identity";

// The first open builds the course's map: one long model call.
export const maxDuration = 120;

/**
 * Opens a course of the caller's program: `{ mapId }` once its map exists, building it
 * on the first call. 202 means another request is building it, so ask again shortly.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; slug: string }> }) {
  const { id, slug } = await params;
  try {
    const result = await openCourse(id, slug, await readUserId());
    if (result.status === "building") return Response.json({ building: true }, { status: 202 });
    return Response.json({ mapId: result.mapId });
  } catch (error) {
    return errorResponse(error, "This course could not be built this time. Please try again.");
  }
}

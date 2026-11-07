import { getUserId } from "@/shared/identity";
import { coursesErrorResponse, parseMapIdParam, startCourse } from "@/features/courses";

type Context = { params: Promise<{ mapId: string }> };

/**
 * Starts a course: `{mapId}` of the learner's own copy, 201 when it was just made and 200
 * when it already existed. The owner gets their own map back with a 200.
 */
export async function POST(_request: Request, { params }: Context) {
  try {
    const mapId = parseMapIdParam((await params).mapId);
    const result = await startCourse(mapId, await getUserId());
    return Response.json({ mapId: result.mapId }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return coursesErrorResponse(error);
  }
}

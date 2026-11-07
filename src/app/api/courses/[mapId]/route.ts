import { getUserId } from "@/shared/identity";
import { coursesErrorResponse, getCourse, parseMapIdParam, unpublishCourse } from "@/features/courses";

type Context = { params: Promise<{ mapId: string }> };

/** One course, as this viewer sees it. A private course is a 404 for everyone but its owner. */
export async function GET(_request: Request, { params }: Context) {
  try {
    const mapId = parseMapIdParam((await params).mapId);
    const viewerId = await getUserId();
    return Response.json(await getCourse(mapId, viewerId));
  } catch (error) {
    return coursesErrorResponse(error);
  }
}

/** Makes your course private again. */
export async function DELETE(_request: Request, { params }: Context) {
  try {
    const mapId = parseMapIdParam((await params).mapId);
    const userId = await getUserId();
    await unpublishCourse(mapId, userId);
    return Response.json({ ok: true });
  } catch (error) {
    return coursesErrorResponse(error);
  }
}

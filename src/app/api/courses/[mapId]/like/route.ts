import { getUserId } from "@/shared/identity";
import { coursesErrorResponse, likeCourse, parseMapIdParam, unlikeCourse } from "@/features/courses";

type Context = { params: Promise<{ mapId: string }> };

/** Likes a public course. Doing it twice counts once. */
export async function PUT(_request: Request, { params }: Context) {
  try {
    const mapId = parseMapIdParam((await params).mapId);
    return Response.json(await likeCourse(mapId, await getUserId()));
  } catch (error) {
    return coursesErrorResponse(error);
  }
}

/** Removes your like. */
export async function DELETE(_request: Request, { params }: Context) {
  try {
    const mapId = parseMapIdParam((await params).mapId);
    return Response.json(await unlikeCourse(mapId, await getUserId()));
  } catch (error) {
    return coursesErrorResponse(error);
  }
}

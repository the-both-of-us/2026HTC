import { getUserId } from "@/shared/identity";
import { coursesErrorResponse, listCourses, parseListQuery, parsePublishBody, publishCourse } from "@/features/courses";

/** The public directory. Anyone can read it. */
export async function GET(request: Request) {
  try {
    const { sort, q } = parseListQuery(request);
    return Response.json({ courses: await listCourses({ sort, q }) });
  } catch (error) {
    return coursesErrorResponse(error);
  }
}

/** Publishes one of your own maps. */
export async function POST(request: Request) {
  try {
    const { mapId, authorName } = await parsePublishBody(request);
    const userId = await getUserId();
    return Response.json({ course: await publishCourse(mapId, userId, authorName) }, { status: 201 });
  } catch (error) {
    return coursesErrorResponse(error);
  }
}

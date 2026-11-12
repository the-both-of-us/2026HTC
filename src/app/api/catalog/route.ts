import { listSharedCourses, listSharedPrograms } from "@/features/catalog";
import { errorResponse } from "@/shared/http";

/**
 * `{ courses, programs }`: the shared catalog a person can start, newest first, at most 60 of each.
 * `?q=` matches title or summary. Anyone can read it; only AI-written, finished entries are listed.
 * Each item is rebuilt field by field here, so a field added to the catalog later never leaves the server.
 */
export async function GET(request: Request) {
  try {
    const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 1000);
    const [courses, programs] = await Promise.all([listSharedCourses({ q }), listSharedPrograms({ q })]);
    return Response.json({
      courses: courses.map((course) => ({
        courseId: course.courseId,
        title: course.title,
        summary: course.summary,
        audience: course.audience,
        units: course.units,
        topics: course.topics,
      })),
      programs: programs.map((program) => ({
        programId: program.programId,
        title: program.title,
        summary: program.summary,
        audience: program.audience,
        courseCount: program.courseCount,
      })),
    });
  } catch (error) {
    return errorResponse(error, "The shared courses could not be loaded this time. Please try again.");
  }
}

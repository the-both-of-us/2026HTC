import { z } from "zod";
import { HttpError } from "@/shared/http";
import { CoursesError } from "./errors";
import type { CourseSort } from "./types";

const COULD_NOT_READ = "We could not read that request. Please refresh the page and try again.";

const mapIdSchema = z.string().min(1).max(100);

/** GET /api/courses?sort=popular|new&q= */
const listQuery = z.object({
  sort: z.enum(["popular", "new"]).default("popular"),
  // The feature trims the query to 100 characters; this only stops absurd input early.
  q: z.string().max(1000).default(""),
});

/** POST /api/courses */
const publishBody = z.object({
  mapId: mapIdSchema,
  // The 40 character rule is checked by the feature, so it can answer with a specific sentence.
  authorName: z.string().max(1000).nullish(),
});

export type ListQuery = { sort: CourseSort; q: string };
export type PublishRequest = { mapId: string; authorName?: string | null };

/** Reads ?sort=&q=, or throws an error the user can read. A missing sort means popular. */
export function parseListQuery(request: Request): ListQuery {
  const params = new URL(request.url).searchParams;
  const result = listQuery.safeParse({
    sort: params.get("sort") || undefined,
    q: params.get("q") ?? undefined,
  });
  if (!result.success) throw new CoursesError(COULD_NOT_READ, 400);
  return result.data;
}

/** Reads the publish body, or throws an error the user can read. */
export async function parsePublishBody(request: Request): Promise<PublishRequest> {
  const json = await request.json().catch(() => null);
  const result = publishBody.safeParse(json);
  if (!result.success) throw new CoursesError(COULD_NOT_READ, 400);
  return result.data;
}

/** Checks the [mapId] route segment's size. Its shape is checked when the map is loaded. */
export function parseMapIdParam(mapId: string): string {
  const result = mapIdSchema.safeParse(mapId);
  if (!result.success) throw new CoursesError(COULD_NOT_READ, 400);
  return result.data;
}

/** Turns any error into a human sentence. Technical details only go to the server log. */
export function coursesErrorResponse(error: unknown): Response {
  // Our own errors, and shared ones such as identity's 503 when signing is not set up.
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("[courses] request failed", error);
  return Response.json(
    { error: "Something went wrong on our side, so that did not work. Please try again." },
    { status: 500 },
  );
}

import { z } from "zod";
import { HttpError } from "@/shared/http";
import { ReviewError } from "./errors";
import type { GradeRequest } from "./review";
import { GRADES } from "./types";

const COULD_NOT_READ = "We could not read that request. Please refresh the page and try again.";

/** POST /api/review. Shapes are checked by the feature, which answers a 404 for an unknown id. */
const gradeBody = z.object({
  mapId: z.string().min(1).max(100),
  nodeId: z.string().min(1).max(200),
  cardId: z.string().min(1).max(100),
  grade: z.enum(GRADES),
});

/** Reads the grade body, or throws an error the user can read. */
export async function parseGradeBody(request: Request): Promise<GradeRequest> {
  const json = await request.json().catch(() => null);
  const result = gradeBody.safeParse(json);
  if (!result.success) throw new ReviewError(COULD_NOT_READ, 400);
  return result.data;
}

/** Turns any error into a human sentence. Technical details only go to the server log. */
export function reviewErrorResponse(error: unknown): Response {
  // Our own errors, and shared ones such as identity's 503 when signing is not set up.
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("[review] request failed", error);
  return Response.json(
    { error: "Something went wrong on our side, so that did not work. Please try again." },
    { status: 500 },
  );
}

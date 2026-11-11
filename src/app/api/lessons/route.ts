import { after } from "next/server";
import { z } from "zod";
import { getOrCreateLesson, writeUnitLessonsSoon, type LessonResponse } from "@/features/lessons";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

// The request itself makes no model call: a new lesson is written after the response (one
// streamed call of up to 60 s, plus at most one rewrite), inside this route's 120 s.
export const maxDuration = 120;

const lessonRequest = z.object({ mapId: z.string().min(1).max(100), nodeId: z.string().min(1).max(100) });

/**
 * `{ lesson }` once it is saved, else `{ status: "writing", attempt, parts }`: the parts written so
 * far, with no model answers. The Read tab posts again every 1.5 s while it is writing. A private
 * map is a 404 for strangers; a failed writer is a 503 sentence once (posting again retries).
 */
export async function POST(request: Request) {
  try {
    const { mapId, nodeId } = await parseBody(request, lessonRequest);
    const viewerId = await getUserId();
    const reply: LessonResponse = await getOrCreateLesson(mapId, nodeId, viewerId, { background: (task) => after(task) });
    // Pre-generation rule 4: the next lessons of this unit, once this one is served.
    if ("lesson" in reply) writeUnitLessonsSoon(mapId, nodeId);
    return Response.json(reply);
  } catch (error) {
    return errorResponse(error, "Something went wrong on our side, so the lesson could not be loaded. Please try again.");
  }
}

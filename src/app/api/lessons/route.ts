import { z } from "zod";
import { getOrCreateLesson } from "@/features/lessons";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

// One model call, which the AI module may retry on another provider.
export const maxDuration = 60;

const lessonRequest = z.object({ mapId: z.string().min(1).max(100), nodeId: z.string().min(1).max(100) });

/** The saved lesson for a skill, or one written and saved now. A private map is a 404 for strangers. */
export async function POST(request: Request) {
  try {
    const { mapId, nodeId } = await parseBody(request, lessonRequest);
    const lesson = await getOrCreateLesson(mapId, nodeId, await getUserId());
    return Response.json({ lesson });
  } catch (error) {
    return errorResponse(error, "Something went wrong on our side, so the lesson could not be loaded. Please try again.");
  }
}

import { AiRefusedError } from "@/features/ai";
import { writeFirstLessonSoon } from "@/features/lessons";
import { createCourseMap } from "@/features/programs";
import { generateSkillMap, type CreateMapResponse } from "@/features/skill-map";
import { HttpError } from "@/shared/http";
import { getUserId } from "@/shared/identity";
import { mapErrorResponse } from "./errors";

// A posting is one long model call in the request. A topic resolves its catalog course (at most
// one check call) and replies at once; its syllabus and unit 1 stream in after(), within this budget.
export const maxDuration = 120;

/**
 * Builds a map from `{ text }`, a pasted posting (one private map), or `{ text, kind: "topic" }`,
 * which becomes the learner's map of a shared catalog course. PDFs go to ./pdf. Reply 201 `{ id }`.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  const kind = body?.kind === "topic" ? "topic" : "posting";

  try {
    const ownerId = await getUserId();
    if (kind === "topic") {
      const { mapId } = await createCourseMap({ text, ownerId });
      return Response.json({ id: mapId } satisfies CreateMapResponse, { status: 201 });
    }
    const map = await generateSkillMap({ text, kind, ownerId });
    writeFirstLessonSoon(map.id);
    return Response.json({ id: map.id } satisfies CreateMapResponse, { status: 201 });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof AiRefusedError) return Response.json({ error: error.message }, { status: 422 });
    return mapErrorResponse(error);
  }
}

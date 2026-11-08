import { writeFirstLessonSoon } from "@/features/lessons";
import { generateSkillMap } from "@/features/skill-map";
import { getUserId } from "@/shared/identity";
import { mapErrorResponse } from "./errors";

// Generation is one long model call, with one retry if the reply is bad.
export const maxDuration = 120;

/** Builds a map from `{ text }`, a pasted posting, or `{ text, kind: "topic" }`. PDFs go to ./pdf. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  const kind = body?.kind === "topic" ? "topic" : "posting";

  try {
    const ownerId = await getUserId();
    const map = await generateSkillMap({ text, kind, ownerId });
    writeFirstLessonSoon(map.id);
    return Response.json({ id: map.id }, { status: 201 });
  } catch (error) {
    return mapErrorResponse(error);
  }
}

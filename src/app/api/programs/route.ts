import { AiRefusedError } from "@/features/ai";
import { writeFirstLessonSoon } from "@/features/lessons";
import { createProgramOrMap, type CreateProgramResponse, type ProgramShape } from "@/features/programs";
import { errorResponse } from "@/shared/http";
import { getUserId } from "@/shared/identity";

// A topic resolves in about 2 s (at most one check call); its frame or syllabus then streams in
// after(), which shares this budget. A posting builds its one map in the request.
export const maxDuration = 120;

const SHAPES: ProgramShape[] = ["auto", "program", "course"];

/**
 * `{ text, kind?: "topic" | "posting", shape? }`. A topic gives 201 `{ programId }` (a 40-course
 * degree; poll `GET /api/programs/[id]`) or `{ mapId }` (one course; poll `GET /api/maps/[id]`).
 * A posting always builds one private map: `{ mapId }`.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  const kind = body?.kind === "topic" ? "topic" : "posting";
  const shape = SHAPES.includes(body?.shape) ? (body.shape as ProgramShape) : "auto";

  try {
    const ownerId = await getUserId();
    const result = await createProgramOrMap({ text, kind, shape, ownerId });
    // A posting map has its nodes now; a topic map gets its first lesson once unit 1 is built.
    if ("mapId" in result && kind === "posting") writeFirstLessonSoon(result.mapId);
    return Response.json(result satisfies CreateProgramResponse, { status: 201 });
  } catch (error) {
    if (error instanceof AiRefusedError) return Response.json({ error: error.message }, { status: 422 });
    return errorResponse(error, "The program could not be planned this time. Please try again.");
  }
}

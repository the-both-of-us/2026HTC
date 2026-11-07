import { createProgramOrMap, type ProgramShape } from "@/features/programs";
import { errorResponse } from "@/shared/http";
import { getUserId } from "@/shared/identity";

// Planning is one short model call. A narrow input on "auto" also builds its map.
export const maxDuration = 120;

const SHAPES: ProgramShape[] = ["auto", "program", "course"];

/** `{ text, kind?: "topic", shape }` gives `{ programId }` for a program, or `{ mapId }` for one course. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  const kind = body?.kind === "topic" ? "topic" : "posting";
  const shape = SHAPES.includes(body?.shape) ? (body.shape as ProgramShape) : "auto";

  try {
    const ownerId = await getUserId();
    const result = await createProgramOrMap({ text, kind, shape, ownerId });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error, "The program could not be planned this time. Please try again.");
  }
}

import { z } from "zod";
import { publishProgram, unpublishProgram } from "@/features/programs";
import { errorResponse, parseBody } from "@/shared/http";
import { getUserId } from "@/shared/identity";

type Context = { params: Promise<{ id: string }> };

// The 40 character rule is checked by the feature, so it can answer with a specific sentence.
const shareBody = z.object({ authorName: z.string().max(1000).nullish() });

/** Shares your program: `{ program }` (201), listed in /courses and open to anyone with the link. */
export async function POST(request: Request, { params }: Context) {
  try {
    const { id } = await params;
    const { authorName } = await parseBody(request, shareBody);
    const program = await publishProgram(id, await getUserId(), authorName);
    return Response.json({ program }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Your program could not be shared this time. Please try again.");
  }
}

/** Makes your program private again: `{ ok: true }`. */
export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { id } = await params;
    await unpublishProgram(id, await getUserId());
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "Your program could not be made private this time. Please try again.");
  }
}

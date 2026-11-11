import { getProgramView, PROGRAM_NOT_FOUND, type ProgramPollResponse } from "@/features/programs";
import { errorResponse } from "@/shared/http";
import { readUserId } from "@/shared/identity";

/**
 * The owner's program as the page shows it, with `planning` while its course list streams in.
 * The page polls this every 1.5 s while planning or while a course is not `startable` yet. No
 * model call. 404 when the program is not the viewer's.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const program = await getProgramView(id, await readUserId());
    if (!program) return Response.json({ error: PROGRAM_NOT_FOUND }, { status: 404 });
    return Response.json({ program } satisfies ProgramPollResponse, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "The program could not be loaded right now. Please try again.");
  }
}

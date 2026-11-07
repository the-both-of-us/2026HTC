import { z } from "zod";
import { ProofError } from "./publish";

export const publishBody = z.object({ mapId: z.string(), displayName: z.string() });

/** Reads a JSON body, or throws an error the user can read. */
export async function parsePublishBody(request: Request): Promise<z.infer<typeof publishBody>> {
  const result = publishBody.safeParse(await request.json().catch(() => null));
  if (!result.success) {
    throw new ProofError("We could not read that request. Please refresh the page and try again.", 400);
  }
  return result.data;
}

/** Turns any error into a human sentence. Technical details only go to the server log. */
export function proofErrorResponse(error: unknown): Response {
  if (error instanceof ProofError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("[proof] request failed", error);
  return Response.json(
    { error: "Something went wrong on our side, and nothing was changed. Please try again." },
    { status: 500 },
  );
}

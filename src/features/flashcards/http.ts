import { z } from "zod";
import { AiUnavailableError } from "@/features/ai";
import { FlashcardsError } from "./errors";

/** The POST body, and the GET query read into the same shape. */
export const flashcardsRequest = z.object({
  mapId: z.string().min(1).max(100),
  nodeId: z.string().min(1).max(100),
});

const COULD_NOT_READ = "We could not read that request. Please refresh the page and try again.";

/** Reads a JSON body, or throws an error the user can read. */
export async function parseFlashcardsBody(request: Request): Promise<z.infer<typeof flashcardsRequest>> {
  const json = await request.json().catch(() => null);
  const result = flashcardsRequest.safeParse(json);
  if (!result.success) throw new FlashcardsError(COULD_NOT_READ, 400);
  return result.data;
}

/** Reads ?mapId=&nodeId=, or throws an error the user can read. */
export function parseFlashcardsQuery(url: string): z.infer<typeof flashcardsRequest> {
  const params = new URL(url).searchParams;
  const result = flashcardsRequest.safeParse({ mapId: params.get("mapId"), nodeId: params.get("nodeId") });
  if (!result.success) throw new FlashcardsError(COULD_NOT_READ, 400);
  return result.data;
}

/** Turns any error into a human sentence. Technical details only go to the server log. */
export function flashcardsErrorResponse(error: unknown): Response {
  if (error instanceof FlashcardsError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof AiUnavailableError) {
    return Response.json({ error: error.message }, { status: 503 });
  }
  console.error("[flashcards] request failed", error);
  return Response.json(
    { error: "Something went wrong on our side, so the flashcards could not be loaded. Please try again." },
    { status: 500 },
  );
}

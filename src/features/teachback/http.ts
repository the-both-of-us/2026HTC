import { z } from "zod";
import { AiUnavailableError } from "@/features/ai";
import { AttemptError } from "./attempts";

/** The shapes the API accepts. Length limits live in attempts.ts, with friendly messages. */
export const newAttemptBody = z.object({
  mapId: z.string(),
  nodeId: z.string(),
  explanation: z.string(),
  integrity: z.object({
    pasted: z.boolean(),
    activeMs: z.number().min(0),
    inputMethod: z.enum(["typed", "voice"]),
  }),
});

export const followUpBody = z.object({ answer: z.string() });

/** Reads a JSON body, or throws an error the user can read. */
export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const json = await request.json().catch(() => null);
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new AttemptError("We could not read that request. Please refresh the page and try again.", 400);
  }
  return result.data;
}

/** Turns any error into a human sentence. Technical details only go to the server log. */
export function errorResponse(error: unknown): Response {
  if (error instanceof AttemptError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof AiUnavailableError) {
    return Response.json({ error: error.message }, { status: 503 });
  }
  console.error("[teachback] request failed", error);
  return Response.json(
    { error: "Something went wrong on our side, and your answer was not saved. Please try again." },
    { status: 500 },
  );
}

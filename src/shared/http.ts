import type { z } from "zod";

/** A problem we can explain to the user. The message is safe to show them. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Reads a JSON body, or throws an error the user can read. */
export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const json = await request.json().catch(() => null);
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new HttpError("We could not read that request. Please refresh the page and try again.", 400);
  }
  return result.data;
}

/**
 * Turns any error into a human sentence. Technical details only go to the server log.
 *
 * AiUnavailableError is matched by name because shared code cannot import a feature.
 * Its message is written for users, and no other error carries that name.
 */
export function errorResponse(
  error: unknown,
  fallback = "Something went wrong on our side. Please try again.",
): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error && error.name === "AiUnavailableError") {
    return Response.json({ error: error.message }, { status: 503 });
  }
  console.error("[http] request failed", error);
  return Response.json({ error: fallback }, { status: 500 });
}

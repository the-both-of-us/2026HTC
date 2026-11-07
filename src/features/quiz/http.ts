import { z } from "zod";
import { AiUnavailableError } from "@/features/ai";
import { QuizError } from "./validate";

/** The body POST /api/quiz accepts. */
export const quizRequestBody = z.object({
  mapId: z.string().min(1).max(100),
  nodeId: z.string().min(1).max(200),
});

export type QuizRequest = z.infer<typeof quizRequestBody>;

const UNREADABLE = "We could not read that request. Please refresh the page and try again.";

/** Reads `mapId` and `nodeId` from a GET request's query string. */
export function parseQuery(request: Request): QuizRequest {
  const params = new URL(request.url).searchParams;
  const result = quizRequestBody.safeParse({
    mapId: params.get("mapId") ?? "",
    nodeId: params.get("nodeId") ?? "",
  });
  if (!result.success) throw new QuizError(UNREADABLE, 400);
  return result.data;
}

/** Reads a POST request's JSON body. */
export async function parseBody(request: Request): Promise<QuizRequest> {
  const json = await request.json().catch(() => null);
  const result = quizRequestBody.safeParse(json);
  if (!result.success) throw new QuizError(UNREADABLE, 400);
  return result.data;
}

/** Turns any error into a human sentence. Technical details only go to the server log. */
export function quizErrorResponse(error: unknown): Response {
  if (error instanceof QuizError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof AiUnavailableError) {
    return Response.json({ error: error.message }, { status: 503 });
  }
  console.error("[quiz] request failed", error);
  return Response.json(
    { error: "Something went wrong on our side, and the quiz could not be loaded. Please try again." },
    { status: 500 },
  );
}

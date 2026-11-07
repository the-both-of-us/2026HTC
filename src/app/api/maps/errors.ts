import { AiUnavailableError } from "@/features/ai";
import { SkillMapError } from "@/features/skill-map";

/** Turns a failed build into a response whose `error` is a sentence the user can act on. */
export function mapErrorResponse(error: unknown): Response {
  if (error instanceof SkillMapError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof AiUnavailableError) {
    return Response.json({ error: error.message }, { status: 503 });
  }
  console.error("[maps] could not create a map", error);
  return Response.json({ error: "The map could not be built this time. Please try again." }, { status: 500 });
}

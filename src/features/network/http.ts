import { z } from "zod";
import { HttpError } from "@/shared/http";
import { NetworkError } from "./errors";
import type { ProfileInput } from "./types";

const COULD_NOT_READ = "We could not read that request. Please refresh the page and try again.";

/**
 * PUT /api/network. The length and link rules are checked by the feature, so it can answer
 * with a specific sentence; these limits only stop absurd input early.
 */
const profileBody = z.object({
  displayName: z.string().max(1000),
  city: z.string().max(1000).nullish(),
  lookingFor: z.string().max(1000).nullish(),
  contactUrl: z.string().max(2000).nullish(),
});

/** Reads the profile body, or throws an error the user can read. */
export async function parseProfileBody(request: Request): Promise<ProfileInput> {
  const json = await request.json().catch(() => null);
  const result = profileBody.safeParse(json);
  if (!result.success) throw new NetworkError(COULD_NOT_READ, 400);
  return result.data;
}

/** Turns any error into a human sentence. Technical details only go to the server log. */
export function networkErrorResponse(error: unknown): Response {
  // Our own errors, and shared ones such as identity's 503 when signing is not set up.
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("[network] request failed", error);
  return Response.json(
    { error: "Something went wrong on our side, so that did not work. Please try again." },
    { status: 500 },
  );
}

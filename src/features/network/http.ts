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
  inNetwork: z.boolean().nullish(),
});

/** Reads the profile body, or throws an error the user can read. */
export async function parseProfileBody(request: Request): Promise<ProfileInput> {
  const json = await request.json().catch(() => null);
  const result = profileBody.safeParse(json);
  if (!result.success) throw new NetworkError(COULD_NOT_READ, 400);
  return result.data;
}

async function parse<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const json = await request.json().catch(() => null);
  const result = schema.safeParse(json);
  if (!result.success) throw new NetworkError(COULD_NOT_READ, 400);
  return result.data;
}

export type SettingsBody = {
  inNetwork?: boolean;
  shareProgress?: boolean;
  allowRequests?: boolean;
  allowPings?: boolean;
};

/** PATCH /api/network: any of `{inNetwork, shareProgress, allowRequests, allowPings}`, at least one. */
export function parseVisibilityBody(request: Request): Promise<SettingsBody> {
  return parse(
    request,
    z
      .object({
        inNetwork: z.boolean().optional(),
        shareProgress: z.boolean().optional(),
        allowRequests: z.boolean().optional(),
        allowPings: z.boolean().optional(),
      })
      .refine((body) => Object.values(body).some((value) => typeof value === "boolean")),
  );
}

/** POST /api/network/requests and /api/network/pings: `{publicId}`. */
export async function parsePublicIdBody(request: Request): Promise<{ publicId: string }> {
  return parse(request, z.object({ publicId: z.string().min(1).max(100) }));
}

/** POST /api/network/invite: `{fresh?}`. An empty body is fine. */
export async function parseInviteBody(request: Request): Promise<{ fresh: boolean }> {
  const body = await parse(request, z.object({ fresh: z.boolean().nullish() }).nullable());
  return { fresh: body?.fresh === true };
}

/** POST /api/network/invite/<code>: `{displayName?}`, the name for a viewer who has no profile yet. */
export async function parseAcceptBody(request: Request): Promise<{ displayName: string | null }> {
  const body = await parse(request, z.object({ displayName: z.string().max(1000).nullish() }));
  return { displayName: body.displayName ?? null };
}

/** Turns any error into a human sentence. Technical details only go to the server log. */
export function networkErrorResponse(error: unknown): Response {
  // Our own errors, and shared ones such as identity's 503 when signing is not set up.
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("[network] request failed", error);
  return Response.json(
    {
      error: "Something went wrong on our side, so that did not work. Please try again.",
    },
    { status: 500 },
  );
}

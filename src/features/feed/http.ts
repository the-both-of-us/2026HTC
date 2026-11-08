import { z } from "zod";

const itemId = z.string().min(3).max(90);

/** POST /api/feed/like and /save: the item, and whether it should now be liked (or saved). */
export const reactionBody = z.object({ cardId: itemId, on: z.boolean() });

/** POST /api/feed/event: what the browser saw. Likes and saves go through their own routes. */
export const eventBody = z.discriminatedUnion("event", [
  z.object({ itemId, event: z.literal("view"), dwellMs: z.number().int().min(0).max(3_600_000) }),
  z.object({ itemId, event: z.enum(["share", "deeper"]) }),
]);

/** POST /api/feed/interests/check: a typed interest. PUT /api/feed/interests: the picked slugs. */
export const checkInterestBody = z.object({ name: z.string().max(200) });
export const saveInterestsBody = z.object({ slugs: z.array(z.string().max(60)).max(30) });

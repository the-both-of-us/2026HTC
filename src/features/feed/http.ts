import { z } from "zod";

/** POST /api/feed/like and /save: the card, and whether it should now be liked (or saved). */
export const reactionBody = z.object({ cardId: z.string().min(1).max(60), on: z.boolean() });

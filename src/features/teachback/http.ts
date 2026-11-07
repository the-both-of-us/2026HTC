import { z } from "zod";

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

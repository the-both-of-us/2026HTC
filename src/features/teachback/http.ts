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

/** inputMethod and startedAfterMs are optional, so an older page that sends only the answer still works. */
export const followUpBody = z.object({
  answer: z.string(),
  inputMethod: z.enum(["typed", "voice"]).optional(),
  startedAfterMs: z.number().min(0).optional(),
});

import { z } from "zod";

/** The shapes the API accepts. Length limits live in attempts.ts, with friendly messages. */
export const newAttemptBody = z.object({
  mapId: z.string(),
  nodeId: z.string(),
  /** Empty for "Catch the mistake", where the learner only taps sentences. */
  explanation: z.string(),
  integrity: z.object({
    pasted: z.boolean(),
    activeMs: z.number().min(0),
  }),
  format: z.enum(["explain", "catch", "kid", "timed"]).optional(),
  picks: z
    .array(z.object({ sentence: z.number().int() }))
    .max(8)
    .optional(),
});

/** startedAfterMs is optional, so an older page that sends only the answer still works. */
export const followUpBody = z.object({
  answer: z.string(),
  startedAfterMs: z.number().min(0).optional(),
});

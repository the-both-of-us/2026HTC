import { z } from "zod";

/** The shapes the API accepts. Length limits live in attempts.ts, with friendly messages. */
export const newAttemptBody = z.object({
  mapId: z.string(),
  nodeId: z.string(),
  /** Empty for "Catch the mistake", where the learner's words are their corrections. */
  explanation: z.string(),
  integrity: z.object({
    pasted: z.boolean(),
    activeMs: z.number().min(0),
    inputMethod: z.enum(["typed", "voice"]),
  }),
  format: z.enum(["explain", "catch", "kid", "timed"]).optional(),
  picks: z
    .array(z.object({ sentence: z.number().int(), correction: z.string().max(2_000) }))
    .max(8)
    .optional(),
});

/** inputMethod and startedAfterMs are optional, so an older page that sends only the answer still works. */
export const followUpBody = z.object({
  answer: z.string(),
  inputMethod: z.enum(["typed", "voice"]).optional(),
  startedAfterMs: z.number().min(0).optional(),
});

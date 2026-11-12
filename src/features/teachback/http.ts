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

/** `?unit=<unitId>` on the test routes picks a degree unit's test; without it, the course's final test. */
export function unitOf(request: Request): string | undefined {
  const unit = new URL(request.url).searchParams.get("unit");
  return unit && /^[a-z0-9-]{1,20}$/i.test(unit) ? unit : undefined;
}

/** One submission of a whole multiple-choice test: the set's id and the chosen option per question. */
export const finalSubmitBody = z.object({
  testId: z.string().min(1).max(64),
  answers: z.array(z.number().int()).max(20),
});

/** startedAfterMs is optional, so an older page that sends only the answer still works. */
export const followUpBody = z.object({
  answer: z.string(),
  startedAfterMs: z.number().min(0).optional(),
});

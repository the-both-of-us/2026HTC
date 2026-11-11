import { z } from "zod";
import type { PretestAnswersRequest } from "./types";

/** POST /api/pretest/[mapId]/answers. Lengths are checked again in code, with a sentence. */
export const answersBody: z.ZodType<PretestAnswersRequest> = z.object({
  unitId: z.string().min(1).max(100),
  answers: z
    .array(
      z.object({
        topicId: z.string().min(1).max(100),
        answer: z.string().max(4_000).nullable().optional(),
        dontKnow: z.boolean().optional(),
      }),
    )
    .max(12),
  stop: z.boolean().optional(),
});

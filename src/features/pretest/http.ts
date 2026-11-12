import { z } from "zod";
import { MC_OPTION_COUNT } from "@/shared/multipleChoice";
import type { PretestAnswersRequest } from "./types";

/** POST /api/pretest/[mapId]/answers. `choice` is an option index, or null for "I don't know this". */
export const answersBody: z.ZodType<PretestAnswersRequest> = z.object({
  unitId: z.string().min(1).max(100),
  answers: z
    .array(
      z.object({
        topicId: z.string().min(1).max(100),
        choice: z
          .number()
          .int()
          .min(0)
          .max(MC_OPTION_COUNT - 1)
          .nullable()
          .optional(),
      }),
    )
    .max(12),
  stop: z.boolean().optional(),
});

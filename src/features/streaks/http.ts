import { z } from "zod";

/** POST /api/streak/relight: without an answer it asks the question, with one it checks it. */
export const relightBody = z.object({
  mapId: z.string().min(1).max(100),
  nodeId: z.string().min(1).max(200),
  answer: z.string().max(4_000).optional(),
});

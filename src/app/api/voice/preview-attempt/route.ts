import { randomUUID } from "node:crypto";
import { getUserId } from "@/shared/identity";
import { getDoc, putDoc } from "@/shared/store";
import type { Attempt } from "@/shared/types";

/**
 * Development only, for /voice-preview?real=1: makes a stored attempt, so the real speak
 * and token routes have something to load without spending AI calls. Removed before the final merge.
 */
const QUESTION = "You said the insulation sets the limit. What actually happens to it when the transformer runs hot for hours?";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const userId = await getUserId();
  const body = (await request.json().catch(() => ({}))) as { attemptId?: string; answer?: string; inputMethod?: "voice" | "typed" };

  if (body.attemptId) {
    const attempt = await getDoc<Attempt>(`attempts/${body.attemptId}`);
    if (!attempt || attempt.ownerId !== userId || !attempt.followUp) return new Response(null, { status: 404 });
    const feedback = "That's the right idea. This is sample feedback from the voice preview, not a real grade.";
    await putDoc(`attempts/${attempt.id}`, {
      ...attempt,
      followUp: { ...attempt.followUp, answer: body.answer ?? "", passed: true, feedback, inputMethod: body.inputMethod ?? "voice" },
      status: "proven",
    } satisfies Attempt);
    return Response.json({ passed: true, feedback });
  }

  const attempt: Attempt = {
    id: randomUUID(),
    mapId: "voice-preview",
    nodeId: "voice-preview",
    ownerId: userId,
    explanation: "A transformer heats up from copper losses and core losses, and the insulation sets the limit on its load.",
    integrity: { pasted: false, activeMs: 0, inputMethod: "typed", wordCount: 19 },
    grade: { score: 80, checkpoints: [], misconceptions: [], rejectedQuotes: 0 },
    followUp: { question: QUESTION, answer: null, passed: null, feedback: null },
    status: "needs-followup",
    createdAt: new Date().toISOString(),
  };
  await putDoc(`attempts/${attempt.id}`, attempt);
  return Response.json({ id: attempt.id, question: QUESTION });
}

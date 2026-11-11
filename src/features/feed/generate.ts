import { chatJSON } from "@/features/ai";
import { buildCardsPrompt, CARDS_SYSTEM_PROMPT, rawCardsSchema, type RawCards } from "./prompt";
import { cardsProblem } from "./validate";

/** The whole call may take this long. About 8 short cards is a small reply. */
const TOTAL_MS = 30_000;

export type BatchOptions = {
  /** Titles of the cards people engaged with most, so the batch follows what works. */
  loved?: string[];
  /** Every title already in the pool, so nothing repeats. */
  usedTitles?: string[];
};

/** One model call for one batch of cards about an interest. */
export async function askModelForCards(name: string, { loved = [], usedTitles = [] }: BatchOptions = {}): Promise<RawCards> {
  const schema = rawCardsSchema.superRefine((reply, context) => {
    const problem = cardsProblem(reply, usedTitles);
    if (problem) context.addIssue({ code: "custom", message: problem });
  });
  return chatJSON({
    // Short JSON with no hard thinking, but 6k tokens and 30 s are more than the check profile allows.
    profile: "write",
    label: "feed-pool",
    system: CARDS_SYSTEM_PROMPT,
    prompt: buildCardsPrompt(name, { loved, usedTitles }),
    schema,
    maxTokens: 6000,
    totalMs: TOTAL_MS,
  });
}

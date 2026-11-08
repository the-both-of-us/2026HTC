import { chatJSON, type RouteName } from "@/features/ai";
import { buildCardsPrompt, CARDS_SYSTEM_PROMPT, rawCardsSchema, type RawCards } from "./prompt";
import { cardsProblem } from "./validate";

/** Each request to a provider may take this long. About 8 short cards is a small reply. */
const REQUEST_TIMEOUT_MS = 30_000;

export type BatchOptions = {
  /** Titles of the cards people engaged with most, so the batch follows what works. */
  loved?: string[];
  /** Every title already in the pool, so nothing repeats. */
  usedTitles?: string[];
  /** Gemini first, as for lessons: cards are kept, so writing matters more than speed. */
  route?: RouteName;
};

/** One model call for one batch of cards about an interest. */
export async function askModelForCards(name: string, { loved = [], usedTitles = [], route = "gemini" }: BatchOptions = {}): Promise<RawCards> {
  const schema = rawCardsSchema.superRefine((reply, context) => {
    const problem = cardsProblem(reply, usedTitles);
    if (problem) context.addIssue({ code: "custom", message: problem });
  });
  return chatJSON({
    label: "feed-pool",
    system: CARDS_SYSTEM_PROMPT,
    prompt: buildCardsPrompt(name, { loved, usedTitles }),
    schema,
    maxTokens: 3000,
    timeoutMs: REQUEST_TIMEOUT_MS,
    preferredRoute: route,
  });
}

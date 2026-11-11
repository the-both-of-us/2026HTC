import { chatJSON } from "@/features/ai";
import { HttpError } from "@/shared/http";
import { deleteDoc, getDoc, putDoc } from "@/shared/store";
import { buildInterestCheckPrompt, INTEREST_CHECK_PROMPT, interestCheckSchema } from "./prompt";
import {
  cleanInterestName,
  findSuggestion,
  interestNameProblem,
  MAX_INTERESTS,
  MIN_INTERESTS,
  SLUG_PATTERN,
  slugify,
  type Interest,
} from "./suggestions";

/**
 * The viewer's interests at feed-interests/<userId>. A typed interest is checked once (rules,
 * then one quick model call) and the verdict is kept at feed-topic/<slug> for everyone.
 */
type SavedInterests = { interests: Interest[]; updatedAt: string };
type TopicVerdict = { ok: boolean; name: string; checkedAt: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHECK_TIMEOUT_MS = 8_000;
const NOT_A_TOPIC = 'That doesn\'t look like a topic to learn about. Try something like "Volcanoes" or "Jazz history".';

const interestsKey = (userId: string) => `feed-interests/${userId}`;
const verdictKey = (slug: string) => `feed-topic/${slug}`;

export async function getInterests(userId: string | null): Promise<Interest[]> {
  if (!userId || !UUID_PATTERN.test(userId)) return [];
  const saved = await getDoc<SavedInterests>(interestsKey(userId));
  return saved?.interests ?? [];
}

export async function deleteInterests(userId: string): Promise<void> {
  if (UUID_PATTERN.test(userId)) await deleteDoc(interestsKey(userId));
}

/** A known interest by slug: a suggestion, or a typed one that passed its check. */
async function knownInterest(slug: string): Promise<Interest | null> {
  if (!SLUG_PATTERN.test(slug) || slug.length > 60) return null;
  const suggestion = findSuggestion(slug);
  if (suggestion) return suggestion;
  const verdict = await getDoc<TopicVerdict>(verdictKey(slug));
  return verdict?.ok ? { slug, name: verdict.name } : null;
}

/**
 * Checks a typed interest: the rules first, then one quick model call (kept for everyone).
 * Returns the tidied interest, or throws a 400 with a plain sentence.
 */
export async function checkInterest(raw: string): Promise<Interest> {
  const problem = interestNameProblem(raw);
  if (problem) throw new HttpError(problem, 400);
  const typed = cleanInterestName(raw);
  const slug = slugify(typed);
  const known = await knownInterest(slug);
  if (known) return known;
  const earlier = await getDoc<TopicVerdict>(verdictKey(slug));
  if (earlier && !earlier.ok) throw new HttpError(NOT_A_TOPIC, 400);

  const reply = await chatJSON({
    profile: "check",
    label: "feed-interest-check",
    system: INTEREST_CHECK_PROMPT,
    prompt: buildInterestCheckPrompt(typed),
    schema: interestCheckSchema,
    maxTokens: 200,
    totalMs: CHECK_TIMEOUT_MS,
  });
  const tidy = cleanInterestName(reply.name);
  const name = reply.ok && tidy && !interestNameProblem(tidy) ? tidy : typed;
  const checkedAt = new Date().toISOString();
  await putDoc(verdictKey(slug), { ok: reply.ok, name, checkedAt } satisfies TopicVerdict);
  if (!reply.ok) throw new HttpError(NOT_A_TOPIC, 400);
  const finalSlug = slugify(name);
  const suggestion = findSuggestion(finalSlug);
  if (suggestion) return suggestion;
  if (finalSlug !== slug) await putDoc(verdictKey(finalSlug), { ok: true, name, checkedAt } satisfies TopicVerdict);
  return { slug: finalSlug, name };
}

/** Saves the viewer's interests. Each must be a suggestion or a typed interest that passed its check. */
export async function saveInterests(userId: string, slugs: string[]): Promise<Interest[]> {
  if (!UUID_PATTERN.test(userId)) throw new HttpError("Please refresh the page and try again.", 400);
  const unique = [...new Set(slugs)].slice(0, MAX_INTERESTS);
  const interests = (await Promise.all(unique.map(knownInterest))).filter((interest): interest is Interest => interest !== null);
  if (interests.length < MIN_INTERESTS) throw new HttpError(`Pick at least ${MIN_INTERESTS} interests.`, 400);
  await putDoc(interestsKey(userId), { interests, updatedAt: new Date().toISOString() } satisfies SavedInterests);
  return interests;
}

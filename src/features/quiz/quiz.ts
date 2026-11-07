import { chatJSON } from "@/features/ai";
import { getSkillMap } from "@/features/skill-map";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import type { QuizQuestion } from "./types";
import { buildQuizPrompt, QUIZ_SYSTEM_PROMPT } from "./prompt";
import { QuizError, rawQuizSchema, validateQuiz, type RandomSource } from "./validate";

/**
 * Each request to a provider may take this long. One chatJSON call can make several
 * requests (a retry after a bad reply, then the next provider), so this alone does not
 * bound the call.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The whole model call gives up after this, well inside the route's 60 second
 * maxDuration, so the learner gets our sentence and not a platform timeout page.
 */
export const GENERATION_DEADLINE_MS = 45_000;

type SavedQuiz = { items: QuizQuestion[]; createdAt: string };

type Found = { map: SkillMap; node: SkillNode; key: string };

const NOT_FOUND = "We could not find that skill. Check the link, or open the map again.";

/** Generation in progress, by store key, so two quick clicks cost one model call. */
const inFlight = new Map<string, Promise<QuizQuestion[]>>();

/** The key is built only from ids that exist, never from raw input. */
async function findNode(mapId: string, nodeId: string): Promise<Found> {
  const map = await getSkillMap(mapId);
  const node = map?.nodes.find((candidate) => candidate.id === nodeId);
  if (!map || !node) throw new QuizError(NOT_FOUND, 404);
  return { map, node, key: `quiz/${map.id}/${node.id}` };
}

/** The saved quiz for a skill, or null if none has been made yet. Never calls the model. */
export async function getSavedQuiz(mapId: string, nodeId: string): Promise<QuizQuestion[] | null> {
  const { key } = await findNode(mapId, nodeId);
  const saved = await getDoc<SavedQuiz>(key);
  return saved?.items ?? null;
}

export type CreateOptions = {
  /** Shuffles answer positions. Tests pass a seeded one. */
  random?: RandomSource;
};

/** The saved quiz, or a new one made with a single model call and then saved. */
export async function getOrCreateQuiz(
  mapId: string,
  nodeId: string,
  options: CreateOptions = {},
): Promise<QuizQuestion[]> {
  const found = await findNode(mapId, nodeId);

  // No await between this check and the set below, so concurrent callers share one promise.
  const pending = inFlight.get(found.key);
  if (pending) return pending;

  const work = loadOrGenerate(found, options).finally(() => inFlight.delete(found.key));
  inFlight.set(found.key, work);
  return work;
}

async function loadOrGenerate({ map, node, key }: Found, options: CreateOptions): Promise<QuizQuestion[]> {
  const saved = await getDoc<SavedQuiz>(key);
  if (saved) return saved.items;

  const raw = await withDeadline(
    chatJSON({
      label: "quiz",
      system: QUIZ_SYSTEM_PROMPT,
      prompt: buildQuizPrompt(map.title, node),
      schema: rawQuizSchema,
      maxTokens: 2000,
      timeoutMs: REQUEST_TIMEOUT_MS,
    }),
  );

  const items = validateQuiz(raw, { mapId: map.id, node }, options.random);
  await putDoc(key, { items, createdAt: new Date().toISOString() } satisfies SavedQuiz);
  return items;
}

/**
 * Stops waiting for the model at GENERATION_DEADLINE_MS. The call itself cannot be
 * cancelled from here, so a late reply is simply ignored and nothing is saved.
 */
function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new QuizError("Making the quiz took too long this time. Please try again in a moment.", 503)),
      GENERATION_DEADLINE_MS,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

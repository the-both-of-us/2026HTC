import { chatJSON, type RouteName } from "@/features/ai";
import { tierFor } from "@/features/settings";
import { isPublished } from "@/features/courses";
import { isNodeLockedFor } from "@/features/teachback";
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

/**
 * Gemini is asked first (an MLH prize category). It is slower than the other routes, which
 * suits this call: the result is saved, so each skill waits for it once. Without
 * GEMINI_API_KEY the route is skipped and the usual order answers.
 */
export const PREFERRED_ROUTE: RouteName = "gemini";

type SavedQuiz = { items: QuizQuestion[]; createdAt: string };

type Found = { map: SkillMap; node: SkillNode; key: string };

const NOT_FOUND = "We could not find that skill. Check the link, or open the map again.";

/** Generation in progress, by store key, so two quick clicks cost one model call. */
const inFlight = new Map<string, Promise<QuizQuestion[]>>();

/** The owner may always read a map. Anyone else only once it is published as a course. */
async function mayRead(map: SkillMap, viewerId: string): Promise<boolean> {
  if (viewerId !== "" && map.ownerId === viewerId) return true;
  return isPublished(map.id);
}

/**
 * The key is built only from ids that exist, never from raw input, and only once the
 * viewer may read the map. A private map someone else owns gets the same 404 as a
 * missing one, so nobody can tell it exists.
 */
async function findNode(mapId: string, nodeId: string, viewerId: string): Promise<Found> {
  const map = await getSkillMap(mapId);
  const node = map?.nodes.find((candidate) => candidate.id === nodeId);
  if (!map || !node || !(await mayRead(map, viewerId))) throw new QuizError(NOT_FOUND, 404);
  return { map, node, key: `quiz/${map.id}/${node.id}` };
}

/**
 * The saved quiz for a skill, or null if none has been made yet. Never calls the model.
 * Throws a 404 QuizError for an unknown map or node, or a map the viewer may not read.
 */
export async function getSavedQuiz(mapId: string, nodeId: string, viewerId: string): Promise<QuizQuestion[] | null> {
  const { key } = await findNode(mapId, nodeId, viewerId);
  const saved = await getDoc<SavedQuiz>(key);
  return saved?.items ?? null;
}

export type CreateOptions = {
  /** Shuffles answer positions. Tests pass a seeded one. */
  random?: RandomSource;
  /** Makes a quiz for a locked skill too. Only the sample script uses it. */
  ignoreLock?: boolean;
};

/** The saved quiz, or a new one made with a single model call and then saved. Same 404s as getSavedQuiz. */
export async function getOrCreateQuiz(
  mapId: string,
  nodeId: string,
  viewerId: string,
  options: CreateOptions = {},
): Promise<QuizQuestion[]> {
  // Every caller is checked here, before it can join a generation already in flight,
  // so nobody can wait on the owner's private generation and receive its questions.
  const found = await findNode(mapId, nodeId, viewerId);
  // Nothing is made for a skill that is still locked.
  if (!options.ignoreLock && (await isNodeLockedFor(found.map, viewerId, found.node.id))) {
    throw new QuizError("This skill is still locked. Prove the skills it depends on first, or unlock it on the map.", 403);
  }

  // No await between this check and the set below, so concurrent callers share one promise.
  const pending = inFlight.get(found.key);
  if (pending) return pending;

  const work = loadOrGenerate(found, options, viewerId).finally(() => {
    if (inFlight.get(found.key) === work) inFlight.delete(found.key);
  });
  inFlight.set(found.key, work);
  return work;
}

async function loadOrGenerate({ map, node, key }: Found, options: CreateOptions, viewerId: string): Promise<QuizQuestion[]> {
  const saved = await getDoc<SavedQuiz>(key);
  if (saved) return saved.items;

  // The model router: the map's rating and this learner's settings. At most Haiku on Auto.
  const tier = await tierFor("quiz", viewerId, map.rating);
  const raw = await withDeadline(
    chatJSON({
      label: "quiz",
      system: QUIZ_SYSTEM_PROMPT,
      prompt: buildQuizPrompt(map.title, node),
      schema: rawQuizSchema,
      maxTokens: 2000,
      timeoutMs: REQUEST_TIMEOUT_MS,
      preferredRoute: PREFERRED_ROUTE,
      tier,
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

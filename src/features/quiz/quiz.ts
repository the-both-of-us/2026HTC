import { chatJSON } from "@/features/ai";
import { isNodeLockedFor } from "@/features/teachback";
import { contentIdOf, getSkillMap } from "@/features/skill-map";
import { getDoc } from "@/shared/store";
import { startOnce, waitForOnce } from "@/shared/store/once";
import type { SkillMap, SkillNode } from "@/shared/types";
import type { QuizQuestion } from "./types";
import { buildQuizPrompt, quizSystemPrompt } from "./prompt";
import { QuizError, rawQuizSchema, validateQuiz, type RandomSource } from "./validate";

/** The quiz call: the write profile, 8k tokens and 45 s for the whole call, repair included. */
export const QUIZ_MAX_TOKENS = 8_000;
export const QUIZ_TOTAL_MS = 45_000;

/**
 * The request stops waiting after this, inside the route's 60 second maxDuration, so the learner
 * gets our sentence and not a platform timeout page.
 */
export const GENERATION_DEADLINE_MS = 50_000;

/** A request that finds someone else writing the quiz waits this long for it. */
export const WAIT_FOR_WRITER_MS = 40_000;


type SavedQuiz = { items: QuizQuestion[]; createdAt: string };

type Found = { map: SkillMap; node: SkillNode; key: string };

const NOT_FOUND = "We could not find that skill. Check the link, or open the map again.";

/**
 * Generation in progress, by store key, so two quick clicks cost one model call. The first layer:
 * across requests and instances, `startOnce` makes sure one writer writes each quiz.
 */
const inFlight = new Map<string, Promise<QuizQuestion[]>>();

/** Only the owner may read a map. */
function mayRead(map: SkillMap, viewerId: string): boolean {
  return viewerId !== "" && map.ownerId === viewerId;
}

/**
 * The key is built only from ids that exist, never from raw input, and only once the
 * viewer may read the map. A private map someone else owns gets the same 404 as a
 * missing one, so nobody can tell it exists.
 */
async function findNode(mapId: string, nodeId: string, viewerId: string): Promise<Found> {
  const map = await getSkillMap(mapId);
  const node = map?.nodes.find((candidate) => candidate.id === nodeId);
  if (!map || !node || !mayRead(map, viewerId)) throw new QuizError(NOT_FOUND, 404);
  // Keyed by the content id: every learner of one catalog course shares the quiz.
  return { map, node, key: `quiz/${contentIdOf(map)}/${node.id}` };
}

/** Items are stored with the content id; each learner gets them with their own map id. */
function forMap(items: QuizQuestion[], mapId: string): QuizQuestion[] {
  return items.map((item) => ({ ...item, mapId }));
}

/**
 * The saved quiz for a skill, or null if none has been made yet. Never calls the model.
 * Throws a 404 QuizError for an unknown map or node, or a map the viewer may not read.
 */
export async function getSavedQuiz(mapId: string, nodeId: string, viewerId: string): Promise<QuizQuestion[] | null> {
  const { map, key } = await findNode(mapId, nodeId, viewerId);
  const saved = await getDoc<SavedQuiz>(key);
  return saved ? forMap(saved.items, map.id) : null;
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
  if (pending) return forMap(await pending, found.map.id);

  const work = loadOrGenerate(found, options).finally(() => {
    if (inFlight.get(found.key) === work) inFlight.delete(found.key);
  });
  inFlight.set(found.key, work);
  return forMap(await work, found.map.id);
}

const WAITED_TOO_LONG = "Making the quiz took too long this time. Please try again in a moment.";

/**
 * The saved quiz, or one written now under `startOnce`, so it is written once for every learner
 * of the course. A request that finds another writer waits for its result (up to 40 s). Returns
 * the items as stored (with the content id): the caller gives them the learner's map id.
 */
async function loadOrGenerate({ map, node, key }: Found, options: CreateOptions): Promise<QuizQuestion[]> {
  const saved = await getDoc<SavedQuiz>(key);
  if (saved) return saved.items;

  const started = await startOnce<SavedQuiz>(key, async () => {
    const raw = await chatJSON({
      profile: "write",
      label: "quiz",
      // A posting's map reads as before; a course on a topic or a PDF is not called a job.
      system: quizSystemPrompt(map.sourceKind),
      prompt: buildQuizPrompt(map, node),
      schema: rawQuizSchema,
      maxTokens: QUIZ_MAX_TOKENS,
      totalMs: QUIZ_TOTAL_MS,
    });
    return { items: validateQuiz(raw, { mapId: contentIdOf(map), node }, options.random), createdAt: new Date().toISOString() };
  });
  if (started === "ready" || started === "running") {
    const value = (await getDoc<SavedQuiz>(key)) ?? (await waitForOnce<SavedQuiz>(key, { timeoutMs: WAIT_FOR_WRITER_MS }));
    if (!value) throw new QuizError(WAITED_TOO_LONG, 503);
    return value.items;
  }
  return (await withDeadline(started.work)).items;
}

/**
 * Stops waiting for the model at GENERATION_DEADLINE_MS. The call itself cannot be
 * cancelled from here, so a late reply is simply ignored and nothing is saved.
 */
function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new QuizError(WAITED_TOO_LONG, 503)),
      GENERATION_DEADLINE_MS,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

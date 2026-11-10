import { chatJSON, type RouteName } from "@/features/ai";
import { ratingOf, tierFor } from "@/features/settings";
import { isPublished } from "@/features/courses";
import { isNodeLockedFor } from "@/features/teachback";
import { getSkillMap } from "@/features/skill-map";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import type { Flashcard } from "./types";
import { FlashcardsError } from "./errors";
import { buildFlashcardsPrompt, FLASHCARDS_SYSTEM_PROMPT, rawDeckSchema } from "./prompt";
import { validateDeck } from "./validate";

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

/** What is stored at flashcards/<mapId>/<nodeId>. */
type SavedDeck = { items: Flashcard[]; createdAt: string };

/**
 * Generation in progress, by store key, so two quick clicks cost one model call.
 * It is per server instance: two instances could each generate once, and the
 * second save would simply replace the first.
 */
const inFlight = new Map<string, Promise<Flashcard[]>>();

const MAP_NOT_FOUND = "We could not find that map. Check the link, or build a new one.";

/** The owner may always read a map. Anyone else only once it is published as a course. */
async function mayRead(map: SkillMap, viewerId: string): Promise<boolean> {
  if (viewerId !== "" && map.ownerId === viewerId) return true;
  return isPublished(map.id);
}

/**
 * The map and node, checked to exist and to be readable by this viewer. Only then is a
 * store key built from them. A private map someone else owns gets the same 404 as a
 * missing one, so nobody can tell it exists.
 */
async function resolveNode(
  mapId: string,
  nodeId: string,
  viewerId: string,
): Promise<{ map: SkillMap; node: SkillNode; key: string }> {
  const map = await getSkillMap(mapId);
  if (!map || !(await mayRead(map, viewerId))) throw new FlashcardsError(MAP_NOT_FOUND, 404);
  const node = map.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new FlashcardsError("We could not find that skill on this map.", 404);
  return { map, node, key: `flashcards/${map.id}/${node.id}` };
}

async function readSaved(key: string): Promise<Flashcard[] | null> {
  const saved = await getDoc<SavedDeck>(key);
  return Array.isArray(saved?.items) ? saved.items : null;
}

/**
 * The saved cards for a skill, or null if none have been made yet. A store read
 * only: it never calls the model. Throws a 404 FlashcardsError for an unknown map or
 * node, or a map the viewer may not read (private and not theirs).
 */
export async function getSavedFlashcards(mapId: string, nodeId: string, viewerId: string): Promise<Flashcard[] | null> {
  const { key } = await resolveNode(mapId, nodeId, viewerId);
  return readSaved(key);
}

/**
 * The saved cards, or new ones from one model call, saved before they are returned.
 * Same 404s as getSavedFlashcards.
 */
export async function getOrCreateFlashcards(
  mapId: string,
  nodeId: string,
  viewerId: string,
  options: { ignoreLock?: boolean } = {},
): Promise<Flashcard[]> {
  // Every caller is checked here, before it can join a generation already in flight,
  // so nobody can wait on the owner's private generation and receive its cards.
  const { map, node, key } = await resolveNode(mapId, nodeId, viewerId);
  // Nothing is made for a skill that is still locked. Only the sample script skips this.
  if (!options.ignoreLock && (await isNodeLockedFor(map, viewerId, node.id))) {
    throw new FlashcardsError("This skill is still locked. Prove the skills it depends on first, or unlock it on the map.", 403);
  }

  // Checked and set with no await in between, so a second caller always finds the first.
  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = loadOrGenerate(key, map, node, viewerId).finally(() => {
    if (inFlight.get(key) === task) inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

async function loadOrGenerate(key: string, map: SkillMap, node: SkillNode, viewerId: string): Promise<Flashcard[]> {
  const saved = await readSaved(key);
  if (saved) return saved;

  // The model router: the map's rating and this learner's settings. At most Haiku on Auto.
  const tier = await tierFor("flashcards", viewerId, ratingOf(map));
  const raw = await withDeadline(
    chatJSON({
      label: "flashcards",
      system: FLASHCARDS_SYSTEM_PROMPT,
      prompt: buildFlashcardsPrompt(map, node),
      schema: rawDeckSchema,
      maxTokens: 2000,
      timeoutMs: REQUEST_TIMEOUT_MS,
      preferredRoute: PREFERRED_ROUTE,
      tier,
    }),
  );
  const items = validateDeck(raw, map.id, node);

  const deck: SavedDeck = { items, createdAt: new Date().toISOString() };
  await putDoc(key, deck);
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
      () => reject(new FlashcardsError("Making flashcards took too long this time. Please try again in a moment.", 503)),
      GENERATION_DEADLINE_MS,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

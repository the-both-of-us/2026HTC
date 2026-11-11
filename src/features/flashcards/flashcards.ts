import { chatJSON } from "@/features/ai";
import { isPublished } from "@/features/courses";
import { isNodeLockedFor } from "@/features/teachback";
import { contentIdOf, getSkillMap } from "@/features/skill-map";
import { getDoc } from "@/shared/store";
import { startOnce, waitForOnce } from "@/shared/store/once";
import type { SkillMap, SkillNode } from "@/shared/types";
import type { Flashcard } from "./types";
import { FlashcardsError } from "./errors";
import { buildFlashcardsPrompt, flashcardsSystemPrompt, rawDeckSchema } from "./prompt";
import { validateDeck } from "./validate";

/** The flashcards call: the write profile, 8k tokens and 45 s for the whole call, repair included. */
export const DECK_MAX_TOKENS = 8_000;
export const DECK_TOTAL_MS = 45_000;

/**
 * The request stops waiting after this, inside the route's 60 second maxDuration, so the learner
 * gets our sentence and not a platform timeout page.
 */
export const GENERATION_DEADLINE_MS = 50_000;

/** A request that finds someone else writing the cards waits this long for them. */
export const WAIT_FOR_WRITER_MS = 40_000;

const TOO_SLOW = "Making flashcards took too long this time. Please try again in a moment.";


/** What is stored at flashcards/<contentIdOf(map)>/<nodeId>: shared by every learner of a catalog course. */
type SavedDeck = { items: Flashcard[]; createdAt: string };

/**
 * Generation in progress, by store key, so two quick clicks cost one model call. The first layer:
 * across requests and instances, `startOnce` makes sure one writer writes each deck.
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
  return { map, node, key: `flashcards/${contentIdOf(map)}/${node.id}` };
}

async function readSaved(key: string): Promise<Flashcard[] | null> {
  const saved = await getDoc<SavedDeck>(key);
  return Array.isArray(saved?.items) ? saved.items : null;
}

/** Cards are stored with the content id; each learner gets them with their own map id (card ids stay shared). */
function forMap(cards: Flashcard[], mapId: string): Flashcard[] {
  return cards.map((card) => ({ ...card, mapId }));
}

/**
 * The saved cards for a skill, or null if none have been made yet. A store read
 * only: it never calls the model. Throws a 404 FlashcardsError for an unknown map or
 * node, or a map the viewer may not read (private and not theirs).
 */
export async function getSavedFlashcards(mapId: string, nodeId: string, viewerId: string): Promise<Flashcard[] | null> {
  const { map, key } = await resolveNode(mapId, nodeId, viewerId);
  const cards = await readSaved(key);
  return cards && forMap(cards, map.id);
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
  if (pending) return forMap(await pending, map.id);

  const task = loadOrGenerate(key, map, node).finally(() => {
    if (inFlight.get(key) === task) inFlight.delete(key);
  });
  inFlight.set(key, task);
  return forMap(await task, map.id);
}

/**
 * The saved deck, or one written now under `startOnce`, so it is written once for every learner of
 * the course. A request that finds another writer waits for its result (up to 40 s). Returns the
 * cards as stored (with the content id).
 */
async function loadOrGenerate(key: string, map: SkillMap, node: SkillNode): Promise<Flashcard[]> {
  const saved = await readSaved(key);
  if (saved) return saved;

  const started = await startOnce<SavedDeck>(key, async () => {
    const raw = await chatJSON({
      profile: "write",
      label: "flashcards",
      system: flashcardsSystemPrompt(map.sourceKind),
      prompt: buildFlashcardsPrompt(map, node),
      schema: rawDeckSchema,
      maxTokens: DECK_MAX_TOKENS,
      totalMs: DECK_TOTAL_MS,
    });
    return { items: validateDeck(raw, contentIdOf(map), node), createdAt: new Date().toISOString() };
  });
  if (started === "ready" || started === "running") {
    const value = (await getDoc<SavedDeck>(key)) ?? (await waitForOnce<SavedDeck>(key, { timeoutMs: WAIT_FOR_WRITER_MS }));
    if (!value) throw new FlashcardsError(TOO_SLOW, 503);
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
      () => reject(new FlashcardsError(TOO_SLOW, 503)),
      GENERATION_DEADLINE_MS,
    );
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

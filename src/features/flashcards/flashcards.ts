import { chatJSON } from "@/features/ai";
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

/** What is stored at flashcards/<mapId>/<nodeId>. */
type SavedDeck = { items: Flashcard[]; createdAt: string };

/**
 * Generation in progress, by store key, so two quick clicks cost one model call.
 * It is per server instance: two instances could each generate once, and the
 * second save would simply replace the first.
 */
const inFlight = new Map<string, Promise<Flashcard[]>>();

/** The map and node, checked to exist. Only then is a store key built from them. */
async function resolveNode(mapId: string, nodeId: string): Promise<{ map: SkillMap; node: SkillNode; key: string }> {
  const map = await getSkillMap(mapId);
  if (!map) throw new FlashcardsError("We could not find that map. Check the link, or build a new one.", 404);
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
 * only: it never calls the model. Throws a 404 FlashcardsError for an unknown map or node.
 */
export async function getSavedFlashcards(mapId: string, nodeId: string): Promise<Flashcard[] | null> {
  const { key } = await resolveNode(mapId, nodeId);
  return readSaved(key);
}

/** The saved cards, or new ones from one model call, saved before they are returned. */
export async function getOrCreateFlashcards(mapId: string, nodeId: string): Promise<Flashcard[]> {
  const { map, node, key } = await resolveNode(mapId, nodeId);

  // Checked and set with no await in between, so a second caller always finds the first.
  const pending = inFlight.get(key);
  if (pending) return pending;

  const task = loadOrGenerate(key, map, node).finally(() => {
    if (inFlight.get(key) === task) inFlight.delete(key);
  });
  inFlight.set(key, task);
  return task;
}

async function loadOrGenerate(key: string, map: SkillMap, node: SkillNode): Promise<Flashcard[]> {
  const saved = await readSaved(key);
  if (saved) return saved;

  const raw = await withDeadline(
    chatJSON({
      label: "flashcards",
      system: FLASHCARDS_SYSTEM_PROMPT,
      prompt: buildFlashcardsPrompt(map, node),
      schema: rawDeckSchema,
      maxTokens: 2000,
      timeoutMs: REQUEST_TIMEOUT_MS,
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

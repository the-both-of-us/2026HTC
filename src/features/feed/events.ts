import { deleteDoc, listKeys, putDoc } from "@/shared/store";
import { EMPTY_STATS, type ItemStats, type ViewerMarks } from "./rank";
import { slugOfItem } from "./validate";

/**
 * Engagement, one document per item, event and viewer: feed-ev/<itemId>/<event>/<userId>.
 * Writing the same one twice changes nothing, so counts need no locks: they are the number of
 * keys under a prefix. Item ids start with the interest slug, so one listing per interest
 * (feed-ev/<slug>.) reads every count for that interest.
 */
export const STORED_EVENTS = ["view", "skip", "long", "like", "save", "share", "deeper"] as const;
export type StoredEvent = (typeof STORED_EVENTS)[number];

/** On screen this long is a view, under SKIP_MS is a skip, LONG_MS or more is a long look. */
export const VIEW_MS = 1_000;
export const SKIP_MS = 1_500;
export const LONG_MS = 8_000;

const CACHE_MS = 60_000;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** itemId → event → the viewers who did it. */
export type InterestEvents = Map<string, Map<StoredEvent, Set<string>>>;

const globalState = globalThis as typeof globalThis & { oryxFeedEvents?: Map<string, { at: number; events: InterestEvents }> };
const cache = (globalState.oryxFeedEvents ??= new Map());

export const eventKey = (itemId: string, event: StoredEvent, userId: string) => `feed-ev/${itemId}/${event}/${userId}`;

/** Every event for one interest's items, from a listing at most a minute old. */
export async function interestEvents(slug: string, now = Date.now()): Promise<InterestEvents> {
  const cached = cache.get(slug);
  if (cached && now - cached.at < CACHE_MS) return cached.events;
  const keys = await listKeys(`feed-ev/${slug}.`);
  const events: InterestEvents = new Map();
  for (const key of keys) {
    const [, itemId, event, userId] = key.split("/");
    if (!itemId || !userId || !(STORED_EVENTS as readonly string[]).includes(event)) continue;
    addTo(events, itemId, event as StoredEvent, userId);
  }
  cache.set(slug, { at: now, events });
  return events;
}

function addTo(events: InterestEvents, itemId: string, event: StoredEvent, userId: string) {
  let byEvent = events.get(itemId);
  if (!byEvent) events.set(itemId, (byEvent = new Map()));
  let users = byEvent.get(event);
  if (!users) byEvent.set(event, (users = new Set()));
  users.add(userId);
}

/** Keeps this server's cached counts in step with a write, so the viewer's next page reflects it. */
function touchCache(itemId: string, event: StoredEvent, userId: string, on: boolean) {
  const slug = slugOfItem(itemId);
  const cached = slug ? cache.get(slug) : undefined;
  if (!cached) return;
  if (on) addTo(cached.events, itemId, event, userId);
  else cached.events.get(itemId)?.get(event)?.delete(userId);
}

export async function writeEvent(userId: string, itemId: string, event: StoredEvent, value: Record<string, unknown> = {}): Promise<void> {
  await putDoc(eventKey(itemId, event, userId), { at: new Date().toISOString(), ...value });
  touchCache(itemId, event, userId, true);
}

export async function removeEvent(userId: string, itemId: string, event: StoredEvent): Promise<void> {
  await deleteDoc(eventKey(itemId, event, userId));
  touchCache(itemId, event, userId, false);
}

/** A view report: a view at 1 s or more, a skip under 1.5 s, a long look at 8 s or more. */
export async function recordView(userId: string, itemId: string, dwellMs: number): Promise<void> {
  const writes: Promise<void>[] = [];
  if (dwellMs >= VIEW_MS) writes.push(writeEvent(userId, itemId, "view", { dwellMs }));
  if (dwellMs < SKIP_MS) writes.push(writeEvent(userId, itemId, "skip", { dwellMs }));
  if (dwellMs >= LONG_MS) writes.push(writeEvent(userId, itemId, "long", { dwellMs }));
  await Promise.all(writes);
}

export function statsOf(events: InterestEvents, itemId: string): ItemStats {
  const byEvent = events.get(itemId);
  if (!byEvent) return EMPTY_STATS;
  const size = (event: StoredEvent) => byEvent.get(event)?.size ?? 0;
  const exposed = new Set([...(byEvent.get("view") ?? []), ...(byEvent.get("skip") ?? [])]);
  return {
    views: size("view"),
    skips: size("skip"),
    exposures: exposed.size,
    long: size("long"),
    likes: size("like"),
    saves: size("save"),
    shares: size("share"),
    deeper: size("deeper"),
  };
}

export function marksOf(events: InterestEvents, itemId: string, userId: string | null): ViewerMarks {
  const has = (event: StoredEvent) => (userId ? (events.get(itemId)?.get(event)?.has(userId) ?? false) : false);
  return { seen: has("view") || has("skip"), liked: has("like"), saved: has("save"), long: has("long"), skipped: has("skip") && !has("view") };
}

/** For "Delete my data": every event this viewer left. Running it twice is harmless. */
export async function deleteViewerEvents(userId: string): Promise<void> {
  if (!UUID_PATTERN.test(userId)) return;
  const keys = (await listKeys("feed-ev/")).filter((key) => key.endsWith(`/${userId}`));
  await Promise.all(keys.map((key) => deleteDoc(key)));
  for (const { events } of cache.values()) for (const byEvent of events.values()) for (const users of byEvent.values()) users.delete(userId);
}

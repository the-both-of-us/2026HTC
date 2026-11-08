/**
 * DEMO ONLY, at the owner's request (Nov 7): like counts are faked for now so a new feed does
 * not look empty. The shown count is real likes + demoLikeSeed(itemId), a stable 3 to 20 from a
 * hash of the item id, so it never changes between reloads.
 *
 * Display only: ranking, pool growth and every "more action" trigger read the REAL counts.
 * To remove it, set DEMO_LIKE_SEED to null: demoLikeSeed then returns 0 everywhere.
 */
export const DEMO_LIKE_SEED: { min: number; max: number } | null = { min: 3, max: 20 };

/** 3 to 20 for a given item id, always the same one (FNV-1a). 0 once DEMO_LIKE_SEED is null. */
export function demoLikeSeed(itemId: string): number {
  if (!DEMO_LIKE_SEED) return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < itemId.length; i++) hash = Math.imul(hash ^ itemId.charCodeAt(i), 0x01000193) >>> 0;
  return DEMO_LIKE_SEED.min + (hash % (DEMO_LIKE_SEED.max - DEMO_LIKE_SEED.min + 1));
}

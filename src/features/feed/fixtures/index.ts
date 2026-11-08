import type { PoolCard, PoolShort } from "../types";
import pools from "./pools.json";

/** What scripts/cache-feed.ts writes: the starting cards and Shorts for each suggested interest. */
export type SeedPool = { name: string; cards: PoolCard[]; shorts: PoolShort[]; shortsSearchedAt?: string };

const SEEDS = (pools as { pools: Record<string, SeedPool> }).pools;

/** The saved starting pool for a suggested interest, so the demo feed needs no model call. */
export function findSeedPool(slug: string): SeedPool | null {
  return Object.hasOwn(SEEDS, slug) ? SEEDS[slug] : null;
}

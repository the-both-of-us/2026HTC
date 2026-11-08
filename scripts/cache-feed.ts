/**
 * Writes the starting pools for every suggested interest (cards from real model output, and
 * Shorts from one YouTube search each), so the demo feed needs no AI call or search.
 *
 *   npm run cache-feed            only interests with no saved cards or Shorts
 *   npm run cache-feed -- --force all of them again
 *
 * Paced for the free tiers: one model call at a time, at least 13 s apart (about 5 a minute).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { askModelForCards } from "../src/features/feed/generate";
import { searchShorts } from "../src/features/feed/shorts";
import { SUGGESTED_INTERESTS } from "../src/features/feed/suggestions";
import type { PoolCard, PoolShort } from "../src/features/feed/types";
import { toPoolCards } from "../src/features/feed/validate";

process.loadEnvFile(".env.local");

const MIN_GAP_MS = 13_000;
const PATH = join("src", "features", "feed", "fixtures", "pools.json");

type Seed = { name: string; cards: PoolCard[]; shorts: PoolShort[]; shortsSearchedAt?: string };
type SeedFile = { pools: Record<string, Seed> };

async function main() {
  const force = process.argv.includes("--force");
  const file: SeedFile = existsSync(PATH) ? JSON.parse(readFileSync(PATH, "utf8")) : { pools: {} };
  const save = () => writeFileSync(PATH, `${JSON.stringify(file, null, 1)}\n`);
  let lastCall = 0;
  let youtubeOk = Boolean(process.env.YOUTUBE_API_KEY);

  for (const interest of SUGGESTED_INTERESTS) {
    const seed = (file.pools[interest.slug] ??= { name: interest.name, cards: [], shorts: [] });
    seed.name = interest.name;

    if (force || seed.cards.length === 0) {
      const wait = lastCall + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastCall = Date.now();
      try {
        const reply = await askModelForCards(interest.name);
        seed.cards = toPoolCards(reply, interest.slug);
        console.log(`${interest.slug}: ${((Date.now() - lastCall) / 1000).toFixed(1)}s, ${reply.cards.length} cards, ${seed.cards.length} kept`);
        save();
      } catch (error) {
        console.warn(`${interest.slug}: cards failed`, error instanceof Error ? error.message : error);
      }
    }

    if (youtubeOk && (force || seed.shorts.length === 0)) {
      try {
        seed.shorts = await searchShorts(interest.slug, interest.name, undefined);
        seed.shortsSearchedAt = new Date().toISOString();
        console.log(`${interest.slug}: ${seed.shorts.length} Shorts`);
        save();
      } catch (error) {
        youtubeOk = false;
        console.warn("YouTube search failed, so no more Shorts this run", error instanceof Error ? error.message : error);
      }
    }
  }
  save();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

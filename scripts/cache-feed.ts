/**
 * Saves real model output for the feed cards of each sample map, so the demo feed needs no AI call.
 *
 *   npm run cache-feed            only the samples with no saved cards
 *   npm run cache-feed -- --force all of them again
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { askModelForCards } from "../src/features/feed/topiclets";
import { toTopiclets } from "../src/features/feed/validate";
import { buildSkillMap } from "../src/features/skill-map/build";
import { findCachedOutput } from "../src/features/skill-map/fixtures";
import { SAMPLE_POSTINGS } from "../src/shared/samplePostings";

process.loadEnvFile(".env.local");

const PAUSE_BETWEEN_CALLS_MS = 15_000;
const FIXTURES_DIR = join("src", "features", "feed", "fixtures");

async function main() {
  const force = process.argv.includes("--force");
  let isFirstCall = true;

  for (const sample of SAMPLE_POSTINGS) {
    const path = join(FIXTURES_DIR, `${sample.id}.json`);
    const existing = JSON.parse(readFileSync(path, "utf8")) as { output: unknown };
    if (existing.output && !force) {
      console.log(`${sample.id}: already saved, skipping`);
      continue;
    }
    const output = findCachedOutput(sample.text);
    if (!output) {
      console.warn(`${sample.id}: no saved map, run cache-samples first`);
      continue;
    }
    // The same checks a live sample map gets, so node ids and titles match the demo's map.
    const map = { ...buildSkillMap(output, sample.text, "posting", "cache-feed"), id: "00000000-0000-4000-8000-000000000000" };

    if (!isFirstCall) await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_CALLS_MS));
    isFirstCall = false;

    const startedAt = Date.now();
    const reply = await askModelForCards(map);
    const good = toTopiclets(reply, map);
    writeFileSync(
      path,
      `${JSON.stringify({ sampleId: sample.id, generatedAt: new Date().toISOString(), output: reply }, null, 2)}\n`,
    );
    console.log(`${sample.id}: ${((Date.now() - startedAt) / 1000).toFixed(1)}s, ${reply.cards.length} cards, ${good.length} pass the checks`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

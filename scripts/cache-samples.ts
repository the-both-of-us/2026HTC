/**
 * Saves real model output for each sample posting, so the demo can't fail on a provider.
 *
 *   npx tsx scripts/cache-samples.ts            only the samples with no saved file
 *   npx tsx scripts/cache-samples.ts --force    all of them again
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { askModelForMap, buildSkillMap } from "../src/features/skill-map/build";
import { SAMPLE_POSTINGS } from "../src/shared/samplePostings";

process.loadEnvFile(".env.local");

/** Cerebras has no trouble with this. The gateway's free tier allows about 5 calls a minute. */
const PAUSE_BETWEEN_CALLS_MS = process.env.CEREBRAS_API_KEY ? 1_000 : 30_000;
const FIXTURES_DIR = join("src", "features", "skill-map", "fixtures");

async function main() {
  const force = process.argv.includes("--force");
  let isFirstCall = true;

  for (const sample of SAMPLE_POSTINGS) {
    const path = join(FIXTURES_DIR, `${sample.id}.json`);
    if (existsSync(path) && !force) {
      console.log(`${sample.id}: already saved, skipping`);
      continue;
    }

    if (!isFirstCall) await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_CALLS_MS));
    isFirstCall = false;

    const startedAt = Date.now();
    const output = await askModelForMap(sample.text);
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

    // Check before saving, so a bad reply never becomes the demo's fixture.
    const map = buildSkillMap(output, sample.text, "posting", "cache-samples");
    const fromSource = map.nodes.filter((node) => node.fromSource);
    const verified = fromSource.filter((node) => node.citation?.verified);

    if (verified.length < fromSource.length) {
      console.warn(`${sample.id}: ${verified.length}/${fromSource.length} citations verified, not saving. Run this again.`);
      continue;
    }

    writeFileSync(
      path,
      `${JSON.stringify({ sampleId: sample.id, generatedAt: new Date().toISOString(), output }, null, 2)}\n`,
    );
    console.log(
      `${sample.id}: ${seconds}s, ${output.nodes.length} nodes from the model, ${map.nodes.length} after checks, ${verified.length}/${fromSource.length} citations verified`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

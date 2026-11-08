/**
 * Saves a real lesson for every skill on each sample map, so the demo's Read tab never waits on a model.
 *
 *   npx tsx --conditions=react-server scripts/cache-lessons.ts            only missing lessons
 *   npx tsx --conditions=react-server scripts/cache-lessons.ts --force    all of them again
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { askModelForLesson } from "../src/features/lessons/generate";
import type { SampleLessons } from "../src/features/lessons/fixtures";
import { buildSkillMap } from "../src/features/skill-map/build";
import { findCachedOutput } from "../src/features/skill-map/fixtures";
import { SAMPLE_POSTINGS } from "../src/shared/samplePostings";

process.loadEnvFile(".env.local");

// About 5 requests a minute per model is the limit, so 13 s keeps well inside it.
const PAUSE_BETWEEN_CALLS_MS = 13_000;
const FIXTURES_DIR = join("src", "features", "lessons", "fixtures");

async function main() {
  const force = process.argv.includes("--force");

  for (const sample of SAMPLE_POSTINGS) {
    const output = findCachedOutput(sample.text);
    if (!output) continue;
    // The same checks a live map gets, so these are exactly the nodes a learner sees.
    const map = buildSkillMap(output, sample.text, "posting", "cache-lessons");
    const path = join(FIXTURES_DIR, `${sample.id}.json`);
    const saved: SampleLessons =
      existsSync(path) && !force
        ? JSON.parse(readFileSync(path, "utf8"))
        : { sampleId: sample.id, generatedAt: "", lessons: {} };

    for (const node of map.nodes) {
      if (saved.lessons[node.id]?.title === node.title) continue;
      const startedAt = Date.now();
      try {
        const { raw: lesson } = await askModelForLesson(map, node);
        saved.lessons[node.id] = { title: node.title, lesson };
        saved.generatedAt = new Date().toISOString();
        // Written after every lesson, so a failure halfway keeps what worked.
        writeFileSync(path, `${JSON.stringify(saved, null, 2)}\n`);
        console.log(`${sample.id}/${node.id}: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      } catch (error) {
        console.warn(`${sample.id}/${node.id}: failed (${(error as Error).message}). Run this again.`);
      }
      await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_CALLS_MS));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

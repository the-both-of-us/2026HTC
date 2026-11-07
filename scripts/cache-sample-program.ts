/**
 * Saves real model output for the sample program: the plan for the Junior Backend
 * Developer posting, and its first course's map. Two model calls.
 *
 *   npx tsx --conditions=react-server scripts/cache-sample-program.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chatJSON } from "../src/features/ai";
import { buildSkillMap, topicReplyToRaw } from "../src/features/skill-map/build";
import { buildCoursePrompt, COURSE_SYSTEM_PROMPT, rawTopicMapSchema } from "../src/features/skill-map/prompt";
import { askModelForPlan, cleanPlan } from "../src/features/programs/plan";
import { SAMPLE_POSTINGS } from "../src/shared/samplePostings";

process.loadEnvFile(".env.local");

const SAMPLE_ID = "junior-backend";

async function main() {
  const sample = SAMPLE_POSTINGS.find((s) => s.id === SAMPLE_ID)!;

  let startedAt = Date.now();
  const plan = await askModelForPlan(sample.text, "posting");
  // Check before saving, so a bad reply never becomes the demo's fixture.
  const clean = cleanPlan(plan);
  console.log(`plan: ${((Date.now() - startedAt) / 1000).toFixed(1)}s, broad=${plan.isBroad}, ${clean.courses.length} courses`);
  clean.courses.forEach((c) => console.log(`  ${c.slug} <- [${c.requires.join(", ")}] ${c.title}: ${c.summary}`));

  const first = clean.courses[0];
  startedAt = Date.now();
  // The raw reply is what gets saved, so this calls the model directly rather than askModelForCourseMap.
  const reply = await chatJSON({
    label: "cache-sample-program",
    system: COURSE_SYSTEM_PROMPT,
    prompt: buildCoursePrompt({
      programTitle: clean.title,
      courseTitle: first.title,
      courseSummary: first.summary,
      otherCourses: clean.courses.slice(1).map((c) => c.title),
    }),
    schema: rawTopicMapSchema,
    maxTokens: 10_000,
    timeoutMs: 55_000,
  });
  const map = buildSkillMap(topicReplyToRaw(reply), first.title, "topic", "cache-sample-program");
  console.log(`course ${first.slug}: ${((Date.now() - startedAt) / 1000).toFixed(1)}s, ${map.nodes.length} topics`);
  map.nodes.forEach((n) => console.log(`  ${n.title}`));

  writeFileSync(
    join("src", "features", "programs", "fixtures", `${SAMPLE_ID}-program.json`),
    `${JSON.stringify({ sampleId: SAMPLE_ID, generatedAt: new Date().toISOString(), plan, courses: { [first.slug]: reply } }, null, 2)}\n`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

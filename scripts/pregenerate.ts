/**
 * Pre-generates a catalog program ahead of learners: its frame, every course's syllabus, unit
 * nodes, then (with --lessons) every topic's lesson. Resumable: it calls the same ensure* functions
 * the app does, so finished keys are skipped and dead claims are taken over. Never run by builders
 * against production: a live store needs --live.
 *
 *   npx tsx --conditions=react-server scripts/pregenerate.ts --program psychology --depth degree
 *   npx tsx --conditions=react-server scripts/pregenerate.ts --program <catalogProgramId> --units all --lessons --live
 *
 * Options: --program <catalog program id | topic> (required), --depth quick|degree (topic only,
 * default quick), --units all|N (units per course, default 1), --lessons, --rpm 30 (steps a minute;
 * a step makes one or two model calls), --concurrency 3, --live (write the store in .env.local).
 */
import { existsSync } from "node:fs";
// Modules, not the programs/lessons indexes: those reach Auth0's client code, which crashes under tsx.
import { AiRefusedError, AiUnavailableError } from "../src/features/ai";
import { claimProgram, getFinalSyllabus, isCatalogId, readCatalogProgram, resolveProgram } from "../src/features/catalog";
import { ensureCourseBuilt, ensureProgramPlanned } from "../src/features/programs/build";
import { ensureUnitNodes } from "../src/features/skill-map";
import { cleanAudience, inferAudience } from "../src/shared/audience";
import type { CourseSyllabus, ProgramDepth, SkillNode } from "../src/shared/types";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

/** Each step gets this long; the ensure* functions refuse to start work that cannot fit. */
const STEP_MS = 10 * 60_000;
const RETRIES = 3;
const BACKOFF_MS = 30_000;
const WAIT_FOR_OTHER_MS = 5_000;

type Options = {
  program: string;
  depth: ProgramDepth;
  units: number;
  lessons: boolean;
  rpm: number;
  concurrency: number;
  live: boolean;
};

function parseArgs(argv: string[]): Options {
  const value = (name: string) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  const program = value("program");
  if (!program || argv.includes("--help")) {
    console.log("Usage: tsx --conditions=react-server scripts/pregenerate.ts --program <id|topic> [--depth quick|degree] [--units all|N] [--lessons] [--rpm 30] [--concurrency 3] [--live]");
    process.exit(program ? 0 : 1);
  }
  const units = value("units") ?? "1";
  const number = (raw: string | undefined, fallback: number) => {
    const parsed = Number(raw ?? fallback);
    if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Not a positive whole number: ${raw}`);
    return parsed;
  };
  return {
    program,
    depth: value("depth") === "degree" ? "degree" : "quick",
    units: units === "all" ? Infinity : number(units, 1),
    lessons: argv.includes("--lessons"),
    rpm: number(value("rpm"), 30),
    concurrency: number(value("concurrency"), 3),
    live: argv.includes("--live"),
  };
}

/** A token bucket: at most `rpm` steps a minute, one token at a time. */
function rateLimiter(rpm: number) {
  const gap = 60_000 / rpm;
  let next = Date.now();
  return async () => {
    const wait = next - Date.now();
    next = Math.max(next, Date.now()) + gap;
    if (wait > 0) await sleep(wait);
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = () => Date.now() + STEP_MS;

const counts = { done: 0, skipped: 0, failed: 0, refused: 0 };

/**
 * Runs one step: waits for a token, retries an unavailable model (a 429 included) up to 3 times
 * with a growing pause, and waits while another writer holds the key. Logs one line.
 */
async function step(label: string, take: () => Promise<void>, run: () => Promise<"done" | "skipped" | "running">): Promise<void> {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    await take();
    const startedAt = Date.now();
    try {
      let result = await run();
      // Someone else (the app, or another run) is writing it: wait for their result.
      for (let waited = 0; result === "running" && waited < STEP_MS; waited += WAIT_FOR_OTHER_MS) {
        await sleep(WAIT_FOR_OTHER_MS);
        result = await run();
      }
      if (result === "running") throw new Error("another writer held it for too long");
      counts[result === "done" ? "done" : "skipped"] += 1;
      console.log(`${result === "done" ? "ready  " : "skipped"} ${label} ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      return;
    } catch (error) {
      if (error instanceof AiRefusedError) {
        counts.refused += 1;
        console.warn(`refused ${label}`);
        return;
      }
      if (error instanceof AiUnavailableError && attempt < RETRIES) {
        const pause = BACKOFF_MS * 2 ** attempt;
        console.warn(`retry   ${label} in ${pause / 1000}s (the AI was unavailable)`);
        await sleep(pause);
        continue;
      }
      counts.failed += 1;
      console.warn(`failed  ${label}: ${error instanceof Error ? `${error.name}: ${error.message}` : "unknown"}. Run this again.`);
      return;
    }
  }
}

/** Runs `work` over `items`, `concurrency` at a time. */
async function pool<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

async function catalogProgramId(options: Options): Promise<string> {
  if (isCatalogId(options.program)) return options.program;
  // The audience is decided in code from the topic, as the app does, so "grade 3 math" lands on the same entry.
  const audience = cleanAudience(inferAudience(options.program));
  const resolved = await resolveProgram({ text: options.program, audience, depth: options.depth, deadline: deadline() });
  if (resolved.status === "found") return resolved.programId;
  const claim = await claimProgram({ text: options.program, audience, depth: options.depth, title: resolved.title, summary: resolved.summary });
  return claim.id;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const store = process.env.S3_BUCKET ? "S3" : process.env.BLOB_READ_WRITE_TOKEN ? "Vercel Blob" : "memory";
  if (store !== "memory" && !options.live) {
    console.error(`The store is ${store}. Pass --live to write it, or unset its variables to try this on the memory store.`);
    process.exit(1);
  }
  console.log(`store: ${store}, ${options.rpm} steps a minute, ${options.concurrency} at a time`);
  const take = rateLimiter(options.rpm);

  // 1. The frame.
  const programId = await catalogProgramId(options);
  await step(`program ${programId}`, take, async () => {
    const result = await ensureProgramPlanned(programId, { deadline: deadline() });
    return result === "built" ? "done" : result === "ready" ? "skipped" : "running";
  });
  const read = await readCatalogProgram(programId);
  if (read?.state !== "ready") {
    console.error(`The program is not planned (${read?.state ?? "missing"}). Run this again.`);
    process.exit(1);
  }
  const { program } = read;
  const courses = program.courses.filter((course): course is typeof course & { courseId: string } => Boolean(course.courseId));
  console.log(`${program.title}: ${courses.length} courses`);

  // 2. Every syllabus (each also builds its unit 1).
  await pool(courses, options.concurrency, (course) =>
    step(`syllabus ${course.slug}`, take, async () => {
      const result = await ensureCourseBuilt(course.courseId, { deadline: deadline() });
      return result.syllabus === "built" ? "done" : result.syllabus === "ready" ? "skipped" : "running";
    }),
  );

  // 3. Units, in order, per course.
  const syllabi = new Map<string, CourseSyllabus>();
  for (const course of courses) {
    const syllabus = await getFinalSyllabus(course.courseId);
    if (syllabus) syllabi.set(course.courseId, syllabus);
  }
  const unitJobs = courses.flatMap((course) =>
    (syllabi.get(course.courseId)?.units ?? []).slice(0, options.units).map((unit) => ({ course, unitId: unit.id })),
  );
  const nodes = new Map<string, SkillNode[]>();
  await pool(unitJobs, options.concurrency, ({ course, unitId }) =>
    step(`unit ${course.slug}/${unitId}`, take, async () => {
      const result = await ensureUnitNodes({
        contentId: course.courseId,
        unitId,
        syllabus: syllabi.get(course.courseId)!,
        course: { title: course.title, audience: program.audience, ...(program.title !== course.title && { programTitle: program.title }) },
        deadline: deadline(),
      });
      if (result.status === "ready") nodes.set(`${course.courseId}/${unitId}`, result.nodes);
      return result.status === "ready" ? "done" : result.status === "running" ? "running" : "skipped";
    }),
  );

  // 4. Lessons for every node of the built units.
  if (options.lessons) {
    // Loaded only here: lessons.ts reaches features/courses -> auth, which may not load under tsx.
    const { ensureLesson } = await import("../src/features/lessons/lessons").catch((error: Error) => {
      console.error(`--lessons could not load the lesson writer under tsx (${error.message}). Units are done; run lessons from the app.`);
      process.exit(1);
    });
    const lessonJobs = unitJobs.flatMap(({ course, unitId }) => (nodes.get(`${course.courseId}/${unitId}`) ?? []).map((node) => ({ course, node })));
    await pool(lessonJobs, options.concurrency, ({ course, node }) =>
      step(`lesson ${course.slug}/${node.id}`, take, async () => {
        const result = await ensureLesson({
          contentId: course.courseId,
          node,
          course: { title: course.title, audience: program.audience, syllabus: syllabi.get(course.courseId) },
          deadline: deadline(),
        });
        return result === "ready" ? "done" : result === "running" ? "running" : "skipped";
      }),
    );
  }

  console.log(`done: ${counts.done} ready, ${counts.skipped} skipped (already there or no time), ${counts.failed} failed, ${counts.refused} refused`);
  if (counts.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

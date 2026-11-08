/**
 * Benchmarks gpt-oss-120b (Cerebras) against Claude Haiku, Sonnet and Opus on public
 * multiple-choice questions (MMLU-Pro and MMLU), graded by code, plus a lesson-writing speed
 * test. Writes src/features/benchmarks/results.json.
 *
 *   npx tsx --env-file=<path to .env.local> scripts/bench-models.ts            full run
 *   npx tsx --env-file=<...> scripts/bench-models.ts --pilot                    2 questions x 4 models
 *   npx tsx scripts/bench-models.ts --report                                    rewrite results, no calls
 *
 * Every finished call is saved in BENCH_DIR, so a rerun only makes the calls that are missing.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BENCHMARK_LINKS, MODELS, QUESTIONS_PER_SUBJECT, SUBJECTS, type ModelId, type Subject } from "../src/features/benchmarks/catalog";
import { buildPrompt, LETTERS, parseAnswerLetter, type Question } from "../src/features/benchmarks/parse";
import { shapeResults, type CallRecord, type LessonRecord } from "../src/features/benchmarks/shape";

const BENCH_DIR =
  process.env.BENCH_DIR ?? "/private/tmp/claude-501/-Users-abdu-SideQuests-hackathon/9dc1fee3-38e9-4bdd-a6d9-ca66a25c02e6/scratchpad/bench";
const QUESTIONS_PATH = join(BENCH_DIR, "questions.json");
const CALLS_PATH = join(BENCH_DIR, "calls.jsonl");
const LESSONS_PATH = join(BENCH_DIR, "lessons.jsonl");
const RESULTS_PATH = join("src", "features", "benchmarks", "results.json");

const EFFORT = "medium";
const MAX_TOKENS = 8000;
const LESSON_TOPICS = ["How compound interest works", "What a variable is in Python"];
/** Stop calling Cerebras if its daily token allowance gets this low, so the live app keeps working. */
const CEREBRAS_DAILY_FLOOR = 300_000;

const args = new Set(process.argv.slice(2));
const PILOT = args.has("--pilot");
const REPORT_ONLY = args.has("--report");

mkdirSync(BENCH_DIR, { recursive: true });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// ---------- questions ----------

type HfRow = { row: Record<string, unknown> };

async function fetchRows(url: string): Promise<{ rows: HfRow[]; total: number }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (response?.ok) {
      const data = await response.json();
      return { rows: data.rows, total: data.num_rows_total };
    }
    await pause(1000 + 500 * attempt);
  }
  throw new Error(`Hugging Face datasets-server failed for ${url}`);
}

/** The first page of up to 100 rows: the pool each sample is drawn from. */
async function firstRows(base: string): Promise<HfRow[]> {
  return (await fetchRows(`${base}&offset=0&length=100`)).rows;
}

/** MMLU-Pro filter: the category, plus any of the subject's search words in the question. */
function mmluProWhere(subject: Subject, category: string): string {
  const words = (subject.searchWords ?? []).map((w) => `"question" ILIKE '%${w}%'`);
  return encodeURIComponent(`"category"='${category}'${words.length ? ` AND (${words.join(" OR ")})` : ""}`);
}

async function questionsFor(subject: Subject, taken: Set<string>): Promise<Question[]> {
  const pool: Question[] = [];
  for (const source of subject.source) {
    if (subject.benchmark === "MMLU-Pro") {
      const where = mmluProWhere(subject, source);
      const rows = await firstRows(
        `https://datasets-server.huggingface.co/filter?dataset=${BENCHMARK_LINKS["MMLU-Pro"].dataset}&config=default&split=test&where=${where}`,
      );
      for (const { row } of rows) {
        pool.push({
          id: `mmlu-pro:${row.question_id}`,
          subject: subject.id,
          question: String(row.question),
          options: row.options as string[],
          answer: String(row.answer),
        });
      }
    } else {
      const rows = await firstRows(
        `https://datasets-server.huggingface.co/rows?dataset=${BENCHMARK_LINKS.MMLU.dataset}&config=${source}&split=test`,
      );
      rows.forEach(({ row }, i) => {
        pool.push({
          id: `mmlu:${source}:${i}`,
          subject: subject.id,
          question: String(row.question),
          options: row.choices as string[],
          answer: LETTERS[Number(row.answer)],
        });
      });
    }
  }
  // A fixed sample: the questions whose id hashes lowest, so every run picks the same ones.
  return pool
    .filter((q) => !taken.has(q.id) && q.options.length > 1)
    .sort((a, b) => hash(a.id).localeCompare(hash(b.id)))
    .slice(0, QUESTIONS_PER_SUBJECT);
}

async function loadQuestions(): Promise<Question[]> {
  const saved: Question[] = existsSync(QUESTIONS_PATH) ? JSON.parse(readFileSync(QUESTIONS_PATH, "utf8")) : [];
  const out: Question[] = [];
  const taken = new Set<string>();
  for (const subject of SUBJECTS) {
    let mine = saved.filter((q) => q.subject === subject.id);
    if (mine.length < QUESTIONS_PER_SUBJECT) {
      console.log(`fetching ${subject.label}...`);
      mine = await questionsFor(subject, taken);
    }
    mine = mine.slice(0, QUESTIONS_PER_SUBJECT);
    mine.forEach((q) => taken.add(q.id));
    out.push(...mine);
    // Saved after each subject, since the datasets-server is flaky.
    writeFileSync(QUESTIONS_PATH, JSON.stringify([...out, ...saved.filter((q) => !out.some((o) => o.id === q.id))], null, 1));
  }
  return out;
}

// ---------- model calls ----------

type Reply = { text: string; ms: number; inputTokens: number; outputTokens: number; stop: CallRecord["stop"] };

class Retryable extends Error {
  constructor(
    message: string,
    readonly waitMs = 0,
  ) {
    super(message);
  }
}

let cerebrasDailyLeft = Infinity;

async function callModel(model: ModelId, prompt: string, json = false): Promise<Reply> {
  const startedAt = Date.now();
  if (model === "gpt-oss-120b") {
    const key = process.env.CEREBRAS_API_KEY;
    if (!key) throw new Error("CEREBRAS_API_KEY is not set");
    const response = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "gpt-oss-120b",
        messages: [{ role: "user", content: prompt }],
        max_tokens: MAX_TOKENS,
        reasoning_effort: EFFORT,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(180_000),
    });
    const left = Number(response.headers.get("x-ratelimit-remaining-tokens-day"));
    if (Number.isFinite(left) && left > 0) cerebrasDailyLeft = left;
    if (response.status === 429 || response.status >= 500) {
      throw new Retryable(`HTTP ${response.status}`, Number(response.headers.get("retry-after")) * 1000 || 0);
    }
    if (!response.ok) throw new Error(`cerebras HTTP ${response.status}`);
    const data = await response.json();
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      ms: Date.now() - startedAt,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      stop: choice?.finish_reason === "length" ? "cut_off" : "done",
    };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      output_config: { effort: EFFORT },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (response.status === 429 || response.status >= 500) {
    throw new Retryable(`HTTP ${response.status}`, Number(response.headers.get("retry-after")) * 1000 || 0);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(`anthropic HTTP ${response.status}: ${body?.error?.message ?? ""}`);
  }
  const data = await response.json();
  const text = (data.content ?? [])
    .filter((block: { type: string }) => block.type === "text")
    .map((block: { text: string }) => block.text)
    .join("\n");
  return {
    text,
    ms: Date.now() - startedAt,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    stop: data.stop_reason === "max_tokens" ? "cut_off" : data.stop_reason === "refusal" ? "refused" : "done",
  };
}

async function withRetries(model: ModelId, prompt: string, json = false): Promise<Reply> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callModel(model, prompt, json);
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === "TimeoutError";
      const retryable = error instanceof Retryable || isTimeout || error instanceof TypeError;
      if (!retryable || attempt >= 6) throw error;
      const wait = Math.max(error instanceof Retryable ? error.waitMs : 0, 2000 * 2 ** attempt);
      console.warn(`  ${model}: ${error instanceof Error ? error.message : "error"}, retry in ${Math.round(wait / 1000)}s`);
      await pause(wait);
    }
  }
}

// ---------- runner ----------

const readLines = <T>(path: string): T[] =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T)
    : [];

/** Requests in flight and the gap between starts, per model, to stay under rate limits. */
const LIMITS: Record<ModelId, { concurrency: number; gapMs: number }> = {
  "gpt-oss-120b": { concurrency: 2, gapMs: 2300 },
  "claude-haiku-5-5": { concurrency: 4, gapMs: 300 },
  "claude-sonnet-5-5": { concurrency: 4, gapMs: 300 },
  "claude-opus-5-5": { concurrency: 4, gapMs: 300 },
};

async function runPool<T>(model: ModelId, jobs: T[], work: (job: T) => Promise<void>) {
  const { concurrency, gapMs } = LIMITS[model];
  let next = 0;
  let lastStart = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const wait = lastStart + gapMs - Date.now();
      lastStart = Math.max(Date.now(), lastStart + gapMs);
      if (wait > 0) await pause(wait);
      if (model === "gpt-oss-120b" && cerebrasDailyLeft < CEREBRAS_DAILY_FLOOR) {
        console.warn("  gpt-oss-120b: Cerebras daily tokens are low, skipping the rest");
        return;
      }
      await work(job);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

function lessonPrompt(topic: string): string {
  return `Write a short lesson for an adult beginner on "${topic}". 600 to 900 words in total, warm and plain.
Reply with one JSON object and nothing else (no code fences), shaped like:
{"title": string, "idea": [3 or 4 paragraphs], "example": {"intro": string, "after": string}, "mistakes": [{"mistake": string, "fix": string}, 3 of these], "check": [3 short questions]}`;
}

function wordsInJson(text: string): { words: number; valid: boolean } {
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    const strings: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(JSON.parse(cleaned));
    return { words: strings.join(" ").split(/\s+/).filter(Boolean).length, valid: true };
  } catch {
    return { words: cleaned.split(/\s+/).filter(Boolean).length, valid: false };
  }
}

async function main() {
  const questions = await loadQuestions();
  console.log(`${questions.length} questions in ${SUBJECTS.length} subjects`);
  const calls = readLines<CallRecord>(CALLS_PATH);
  const lessons = readLines<LessonRecord>(LESSONS_PATH);
  const done = new Set(calls.map((c) => `${c.model}|${c.questionId}`));
  const lessonsDone = new Set(lessons.map((l) => `${l.model}|${l.topic}`));

  if (!REPORT_ONLY) {
    const sample = PILOT ? [questions[0], questions.find((q) => q.subject === "abstract-algebra")!] : questions;
    const labels = new Map(SUBJECTS.map((s) => [s.id, s.label]));
    await Promise.all(
      MODELS.map(async ({ id: model }) => {
        const todo = sample.filter((q) => !done.has(`${model}|${q.id}`));
        console.log(`${model}: ${todo.length} questions to ask`);
        let count = 0;
        await runPool(model, todo, async (q) => {
          try {
            const reply = await withRetries(model, buildPrompt(q, labels.get(q.subject)!));
            const picked = parseAnswerLetter(reply.text, q.options.length);
            const record: CallRecord = {
              model,
              subject: q.subject,
              questionId: q.id,
              answer: q.answer,
              picked,
              correct: picked === q.answer,
              ms: reply.ms,
              inputTokens: reply.inputTokens,
              outputTokens: reply.outputTokens,
              stop: reply.stop,
            };
            calls.push(record);
            appendFileSync(CALLS_PATH, JSON.stringify(record) + "\n");
            if (PILOT || picked === null) {
              console.log(`  ${model} ${q.id}: picked ${picked} (key ${q.answer}), ${reply.ms}ms, ${reply.outputTokens} tok, ${reply.stop}`);
              if (picked === null) console.log(`    tail: ${JSON.stringify(reply.text.slice(-160))}`);
            }
            if (++count % 20 === 0) console.log(`  ${model}: ${count}/${todo.length}`);
          } catch (error) {
            console.error(`  ${model} ${q.id} failed: ${error instanceof Error ? error.message : "error"}`);
          }
        });
        if (model === "gpt-oss-120b" && Number.isFinite(cerebrasDailyLeft)) {
          console.log(`  cerebras daily tokens left: ${cerebrasDailyLeft}`);
        }

        if (PILOT) return;
        for (const topic of LESSON_TOPICS) {
          if (lessonsDone.has(`${model}|${topic}`)) continue;
          try {
            const reply = await withRetries(model, lessonPrompt(topic), model === "gpt-oss-120b");
            const { words, valid } = wordsInJson(reply.text);
            const record: LessonRecord = { model, topic, ms: reply.ms, outputTokens: reply.outputTokens, words, validJson: valid };
            lessons.push(record);
            appendFileSync(LESSONS_PATH, JSON.stringify(record) + "\n");
            console.log(`  ${model} lesson "${topic}": ${(reply.ms / 1000).toFixed(1)}s, ${reply.outputTokens} tok, ${words} words`);
          } catch (error) {
            console.error(`  ${model} lesson failed: ${error instanceof Error ? error.message : "error"}`);
          }
        }
      }),
    );
  }

  if (PILOT) return;
  const results = shapeResults({
    generatedAt: new Date().toISOString(),
    subjects: SUBJECTS,
    questionsPerSubject: QUESTIONS_PER_SUBJECT,
    effort: EFFORT,
    maxTokens: MAX_TOKENS,
    calls: calls.filter((c) => questions.some((q) => q.id === c.questionId)),
    lessons: lessons.filter((l) => LESSON_TOPICS.includes(l.topic)),
    lessonTopics: LESSON_TOPICS,
  });
  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + "\n");
  console.log(`wrote ${RESULTS_PATH}: ${results.calls} calls, about $${results.spentUsd}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

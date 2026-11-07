/**
 * Measures the grader with real model calls and writes docs/eval-results.md.
 *
 *   npm run eval                      finish any missing runs, then write the report
 *   npm run eval -- --fresh           throw away the saved runs and start again
 *   npm run eval -- --report          write the report from saved runs, with no model calls
 *   npm run eval -- --followups       run the false passes through the follow-up gate
 *   npm run eval -- --generate-skills freeze the skills under test. This changes generated
 *                                     checkpoints, so the labels for them must be rewritten.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateFollowUp, gradeExplanation, gradeFollowUp, quoteIsInText } from "../src/features/teachback";
import { quotesInReply, startFetchTap, type TappedCall } from "../src/features/teachback/eval/fetchTap";
import { summarize, type EvalCase, type ModelCall, type RunRecord } from "../src/features/teachback/eval/metrics";
import { runPlantedQuotes } from "../src/features/teachback/eval/plantedQuotes";
import { renderReport, type EvalSkill, type FollowUpRun } from "../src/features/teachback/eval/report";
import { askModelForMap, buildSkillMap } from "../src/features/skill-map/build";
import { rawMapSchema } from "../src/features/skill-map/prompt";
import { SAMPLE_POSTINGS } from "../src/shared/samplePostings";
import { PASS_SCORE, type SkillNode } from "../src/shared/types";

process.loadEnvFile(".env.local");

const EVAL_DIR = join("src", "features", "teachback", "eval");
const CASES_PATH = join(EVAL_DIR, "cases.json");
const SKILLS_PATH = join(EVAL_DIR, "skills.json");
const RESULTS_PATH = join(EVAL_DIR, "results.json");
const FINDINGS_PATH = join(EVAL_DIR, "findings.md");
const FOLLOWUPS_PATH = join(EVAL_DIR, "followups.json");
const REPORT_PATH = join("docs", "eval-results.md");

const RUNS_PER_CASE = 3;
/** Cerebras allows 30 requests a minute on its free tier, so stay under that. */
const PAUSE_BETWEEN_GRADES_MS = 2_500;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8"));
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Replies stay out of results.json, because the quotes in them are saved separately. */
function withoutReply(call: TappedCall): ModelCall {
  const { host, status, ms, promptTokens, completionTokens } = call;
  return { host, status, ms, promptTokens, completionTokens };
}

async function gradeOnce(evalCase: EvalCase, node: SkillNode, run: number, tap: ReturnType<typeof startFetchTap>): Promise<RunRecord> {
  const startedAt = Date.now();
  try {
    const grade = await gradeExplanation(node, evalCase.text);
    const ms = Date.now() - startedAt;
    const calls = tap.take();
    // The last call that returned text is the reply the grade was built from.
    const quotes = quotesInReply(calls.findLast((call) => call.reply)?.reply ?? null);
    const met = grade.checkpoints.filter((result) => result.met);

    return {
      caseId: evalCase.id,
      run,
      ms,
      score: grade.score,
      verdict: grade.score >= PASS_SCORE ? "pass" : "fail",
      met: met.length,
      total: grade.checkpoints.length,
      credited: met.map((result) => ({ checkpoint: result.checkpoint, quote: result.quote ?? "" })),
      misconceptions: grade.misconceptions,
      quotesReturned: quotes.length,
      rejectedQuotes: grade.rejectedQuotes,
      rejected: quotes.filter((quote) => !quoteIsInText(quote, evalCase.text)),
      calls: calls.map(withoutReply),
      error: null,
    };
  } catch (error) {
    return {
      caseId: evalCase.id,
      run,
      ms: Date.now() - startedAt,
      score: null,
      verdict: null,
      met: 0,
      total: node.checkpoints.length,
      credited: [],
      misconceptions: [],
      quotesReturned: 0,
      rejectedQuotes: 0,
      rejected: [],
      calls: tap.take().map(withoutReply),
      error: error instanceof Error ? error.name : "unknown error",
    };
  }
}

async function runCases(cases: EvalCase[], skills: EvalSkill[], fresh: boolean): Promise<RunRecord[]> {
  const records: RunRecord[] = !fresh && existsSync(RESULTS_PATH) ? readJson(RESULTS_PATH) : [];
  const nodes = new Map(skills.map((skill) => [skill.key, skill.node as SkillNode]));
  const done = new Set(records.filter((record) => !record.error).map((record) => `${record.caseId}#${record.run}`));
  const tap = startFetchTap();

  // One pass over all cases, then the next, so repeats of a case are minutes apart.
  for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
    for (const evalCase of cases) {
      if (done.has(`${evalCase.id}#${run}`)) continue;

      const node = nodes.get(evalCase.skill);
      if (!node) throw new Error(`Case ${evalCase.id} names unknown skill ${evalCase.skill}`);

      const record = await gradeOnce(evalCase, node, run, tap);
      const earlierError = records.findIndex((item) => item.caseId === evalCase.id && item.run === run);
      if (earlierError >= 0) records.splice(earlierError, 1);
      records.push(record);
      writeFileSync(RESULTS_PATH, `${JSON.stringify(records, null, 1)}\n`);

      const outcome = record.error ?? `${record.score} ${record.verdict}`;
      const mark = record.verdict === evalCase.expected ? "" : "  <-- DISAGREES";
      console.log(`run ${run} ${evalCase.id}: ${outcome} (expected ${evalCase.expected}, ${record.ms} ms)${mark}`);
      await pause(PAUSE_BETWEEN_GRADES_MS);
    }
  }

  tap.stop();
  return records;
}

/**
 * What each false-pass learner would plausibly answer: the same false belief, or the
 * pasted text again. Written for this check, and a determined cheat could do better.
 */
const FOLLOW_UP_ANSWERS: Record<string, string> = {
  "sql-parrot": "An INNER JOIN returns rows only when matching keys exist in both tables. A WHERE clause filters rows before grouping, affecting which data is aggregated.",
  "feedback-parrot": "Effective feedback separates behavior from the person to focus on observable actions. Specific examples in feedback reduce ambiguity and increase likelihood of change.",
  "grid-all-plus-error": "Reserves are electricity stored inside the transmission lines, so longer lines hold more of it and the grid can draw on that when a plant trips.",
  "transactions-all-plus-error": "Commits are only temporary, so you can run ROLLBACK a few days later and the database will bring the old data back.",
};

async function runFollowUps(cases: EvalCase[], skills: EvalSkill[]) {
  const runs: FollowUpRun[] = [];
  for (const [caseId, answer] of Object.entries(FOLLOW_UP_ANSWERS)) {
    const evalCase = cases.find((item) => item.id === caseId);
    const node = skills.find((skill) => skill.key === evalCase?.skill)?.node as SkillNode | undefined;
    if (!evalCase || !node) throw new Error(`Unknown case ${caseId}`);

    for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
      const grade = await gradeExplanation(node, evalCase.text);
      const question = await generateFollowUp(node, evalCase.text, grade);
      const result = await gradeFollowUp(node, evalCase.text, question, answer);
      runs.push({ caseId, run, score: grade.score, question, answer, passed: result.passed, feedback: result.feedback });
      console.log(`${caseId} run ${run}: score ${grade.score}, follow-up ${result.passed ? "PASSED" : "stopped"}: ${question}`);
      await pause(PAUSE_BETWEEN_GRADES_MS * 3);
    }
  }
  writeFileSync(FOLLOWUPS_PATH, `${JSON.stringify(runs, null, 1)}\n`);
}

async function writeReport(cases: EvalCase[], skills: EvalSkill[], records: RunRecord[]) {
  const summary = summarize(cases, records);
  const planted = await runPlantedQuotes();
  const labelsCommit = execFileSync("git", ["log", "-1", "--format=%h", "--", CASES_PATH], { encoding: "utf8" }).trim();
  const findings = existsSync(FINDINGS_PATH) ? readFileSync(FINDINGS_PATH, "utf8") : "Not written yet.";
  const followUps = existsSync(FOLLOWUPS_PATH) ? readJson<FollowUpRun[]>(FOLLOWUPS_PATH) : [];

  writeFileSync(
    REPORT_PATH,
    renderReport({ summary, skills, planted, followUps, labelsCommit: labelsCommit || "(not committed yet)", writtenAt: new Date().toISOString(), findings }),
  );

  console.log(`\nagreement ${summary.agreement.hits}/${summary.agreement.total}, false pass ${summary.falsePass.hits}/${summary.falsePass.total}, false fail ${summary.falseFail.hits}/${summary.falseFail.total}, errored runs ${summary.erroredRuns}, cost about $${summary.costUsd.toFixed(3)}`);
  console.log(`wrote ${REPORT_PATH}`);
}

/** Which saved node to test for each skill area. */
const FIXTURE_PICKS = [
  { key: "sql", area: "SQL", sampleId: "data-analyst-grid", nodeId: "sql-queries" },
  { key: "python", area: "Python", sampleId: "data-analyst-grid", nodeId: "python-pandas" },
  { key: "statistics", area: "Statistics", sampleId: "data-analyst-grid", nodeId: "statistics-fundamentals" },
  { key: "grid", area: "Grid operations", sampleId: "data-analyst-grid", nodeId: "power-grid-supply-demand" },
  { key: "writing", area: "Soft skill", sampleId: "data-analyst-grid", nodeId: "technical-writing" },
  { key: "transactions", area: "SQL", sampleId: "junior-backend", nodeId: "database-transactions" },
];

/** Written for this eval. Not real listings, and they name no employer. */
const NEW_SKILLS = [
  {
    key: "abtest",
    area: "Statistics",
    titleMatch: /a\/b|experiment/i,
    posting: `Product Analyst
Remote, Canada

You will run the experiments that decide what our product team ships.

What you will do
- Design and analyse A/B tests: choose a primary metric, work out sample size before launch, and read p-values and confidence intervals correctly.
- Write SQL to pull experiment data and check that groups were split evenly.
- Explain results in plain language to product managers.

What you bring
- Working knowledge of statistics and SQL.
- Clear writing.`,
  },
  {
    key: "feedback",
    area: "Soft skill",
    titleMatch: /feedback|conflict/i,
    posting: `Team Lead, Customer Support
Calgary, AB

You will lead a team of eight support agents.

What you will do
- Give difficult feedback to team members and hold one-on-one meetings every week.
- Resolve conflict between team members before it affects customers.
- Track ticket queues and report on response times.
- Coach new agents through their first month.

What you bring
- Experience leading people.
- Strong communication, especially giving feedback that changes behaviour.`,
  },
];

function fixtureNode(sampleId: string, nodeId: string): SkillNode {
  const sample = SAMPLE_POSTINGS.find((candidate) => candidate.id === sampleId);
  if (!sample) throw new Error(`No sample posting ${sampleId}`);

  const path = join("src", "features", "skill-map", "fixtures", `${sampleId}.json`);
  const output = rawMapSchema.parse(readJson<{ output: unknown }>(path).output);
  const node = buildSkillMap(output, sample.text, "posting", "eval").nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(`No node ${nodeId} in ${sampleId}`);
  return node;
}

async function generateSkills() {
  const skills = FIXTURE_PICKS.map(({ key, area, sampleId, nodeId }) => ({
    key,
    area,
    origin: `fixture: ${sampleId}`,
    node: fixtureNode(sampleId, nodeId),
  }));

  for (const { key, area, titleMatch, posting } of NEW_SKILLS) {
    const map = buildSkillMap(await askModelForMap(posting), posting, "posting", "eval");
    const node = map.nodes.find((item) => titleMatch.test(item.title));
    if (!node) throw new Error(`No node matching ${titleMatch} in: ${map.nodes.map((item) => item.title).join(", ")}`);
    skills.push({ key, area, origin: `generated live ${new Date().toISOString()}`, node });
  }

  writeFileSync(SKILLS_PATH, `${JSON.stringify(skills, null, 2)}\n`);
  console.log(`wrote ${SKILLS_PATH}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--generate-skills")) return generateSkills();

  // Model routes log one line per call. The eval prints its own progress instead.
  console.info = () => {};

  const cases = readJson<EvalCase[]>(CASES_PATH);
  const skills = readJson<EvalSkill[]>(SKILLS_PATH);
  if (args.includes("--followups")) await runFollowUps(cases, skills);

  const records = args.includes("--report") || args.includes("--followups")
    ? readJson<RunRecord[]>(RESULTS_PATH)
    : await runCases(cases, skills, args.includes("--fresh"));

  await writeReport(cases, skills, records);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

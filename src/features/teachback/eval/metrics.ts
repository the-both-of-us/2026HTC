/**
 * Turns raw eval runs into the numbers in docs/eval-results.md. No model calls here,
 * so every number can be recomputed from results.json and is covered by metrics.test.ts.
 */

export type Verdict = "pass" | "fail";

export type EvalCase = {
  id: string;
  skill: string;
  category: string;
  expected: Verdict;
  why: string;
  text: string;
};

export type ModelCall = {
  host: string;
  status: number;
  ms: number;
  promptTokens: number;
  completionTokens: number;
};

/** One call to gradeExplanation. Every attempt is kept, including ones that errored. */
export type RunRecord = {
  caseId: string;
  run: number;
  ms: number;
  /** Null when no provider could answer. These runs count as errors, not as verdicts. */
  score: number | null;
  verdict: Verdict | null;
  met: number;
  total: number;
  credited: { checkpoint: string; quote: string }[];
  misconceptions: string[];
  quotesReturned: number;
  rejectedQuotes: number;
  /** The quotes the code refused, as the model wrote them. */
  rejected: string[];
  calls: ModelCall[];
  error: string | null;
};

/** gpt-oss-120b on Cerebras, from inference-docs.cerebras.ai, read 2026-11-07. */
export const USD_PER_MILLION_INPUT = 0.35;
export const USD_PER_MILLION_OUTPUT = 0.75;

export type Rate = { hits: number; total: number; rate: number; low: number; high: number };

/** A count as a share, with a 95% Wilson interval: the honest range for a small sample. */
export function toRate(hits: number, total: number): Rate {
  if (total === 0) return { hits, total, rate: 0, low: 0, high: 0 };

  const z = 1.96;
  const rate = hits / total;
  const denominator = 1 + (z * z) / total;
  const centre = rate + (z * z) / (2 * total);
  const margin = z * Math.sqrt((rate * (1 - rate)) / total + (z * z) / (4 * total * total));
  return {
    hits,
    total,
    rate,
    low: Math.max(0, (centre - margin) / denominator),
    high: Math.min(1, (centre + margin) / denominator),
  };
}

/** Nearest-rank percentile: the value at or below which p percent of the values fall. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** The verdict most runs agreed on. A tie, possible only after errors, counts as a pass: the worse outcome. */
export function majorityVerdict(records: RunRecord[]): Verdict | null {
  const verdicts = records.map((record) => record.verdict).filter((verdict) => verdict !== null);
  if (verdicts.length === 0) return null;
  const passes = verdicts.filter((verdict) => verdict === "pass").length;
  return passes * 2 >= verdicts.length ? "pass" : "fail";
}

export type CaseResult = {
  evalCase: EvalCase;
  records: RunRecord[];
  majority: Verdict | null;
  scores: (number | null)[];
  /** How many verdicts differ from the label, out of the runs that gave a verdict. */
  wrongRuns: number;
  consistent: boolean;
};

export function toCaseResults(cases: EvalCase[], records: RunRecord[]): CaseResult[] {
  return cases.map((evalCase) => {
    const own = records.filter((record) => record.caseId === evalCase.id).sort((a, b) => a.run - b.run);
    const verdicts = own.map((record) => record.verdict).filter((verdict) => verdict !== null);
    return {
      evalCase,
      records: own,
      majority: majorityVerdict(own),
      scores: own.map((record) => record.score),
      wrongRuns: verdicts.filter((verdict) => verdict !== evalCase.expected).length,
      consistent: new Set(verdicts).size <= 1,
    };
  });
}

export type GroupRow = {
  name: string;
  cases: number;
  /** Cases whose majority verdict matches the label. */
  agreed: number;
  falsePasses: number;
  falseFails: number;
};

function groupRows(results: CaseResult[], nameOf: (result: CaseResult) => string): GroupRow[] {
  const names = [...new Set(results.map(nameOf))];
  return names.map((name) => {
    const group = results.filter((result) => nameOf(result) === name);
    return {
      name,
      cases: group.length,
      agreed: group.filter((result) => result.majority === result.evalCase.expected).length,
      falsePasses: group.filter((result) => result.evalCase.expected === "fail" && result.majority === "pass").length,
      falseFails: group.filter((result) => result.evalCase.expected === "pass" && result.majority === "fail").length,
    };
  });
}

export function summarize(cases: EvalCase[], records: RunRecord[]) {
  const results = toCaseResults(cases, records);
  const graded = results.filter((result) => result.majority !== null);
  const shouldFail = graded.filter((result) => result.evalCase.expected === "fail");
  const shouldPass = graded.filter((result) => result.evalCase.expected === "pass");

  const labelOf = new Map(cases.map((evalCase) => [evalCase.id, evalCase.expected]));
  const verdictRuns = records.filter((record) => record.verdict !== null);
  const runsExpecting = (label: Verdict) => verdictRuns.filter((record) => labelOf.get(record.caseId) === label);
  const wrongRuns = (label: Verdict) => runsExpecting(label).filter((record) => record.verdict !== label).length;

  const scoreRanges = results
    .map((result) => result.scores.filter((score) => score !== null))
    .filter((scores) => scores.length > 1)
    .map((scores) => Math.max(...scores) - Math.min(...scores));

  const calls = records.flatMap((record) => record.calls);
  const promptTokens = calls.reduce((sum, call) => sum + call.promptTokens, 0);
  const completionTokens = calls.reduce((sum, call) => sum + call.completionTokens, 0);
  const costUsd = (promptTokens * USD_PER_MILLION_INPUT + completionTokens * USD_PER_MILLION_OUTPUT) / 1_000_000;
  const latencies = verdictRuns.map((record) => record.ms);

  const callsByHost: Record<string, number> = {};
  for (const call of calls) callsByHost[call.host] = (callsByHost[call.host] ?? 0) + 1;

  return {
    results,
    caseCount: cases.length,
    runCount: records.length,
    erroredRuns: records.filter((record) => record.error !== null).length,
    agreement: toRate(graded.filter((result) => result.majority === result.evalCase.expected).length, graded.length),
    falsePass: toRate(shouldFail.filter((result) => result.majority === "pass").length, shouldFail.length),
    falseFail: toRate(shouldPass.filter((result) => result.majority === "fail").length, shouldPass.length),
    falsePassRuns: toRate(wrongRuns("fail"), runsExpecting("fail").length),
    falseFailRuns: toRate(wrongRuns("pass"), runsExpecting("pass").length),
    /** Cases labelled fail that passed on at least one run: the worst case for a learner who retries. */
    falsePassAnyRun: toRate(shouldFail.filter((result) => result.wrongRuns > 0).length, shouldFail.length),
    consistency: toRate(graded.filter((result) => result.consistent).length, graded.length),
    meanScoreRange: scoreRanges.length ? scoreRanges.reduce((sum, range) => sum + range, 0) / scoreRanges.length : 0,
    maxScoreRange: scoreRanges.length ? Math.max(...scoreRanges) : 0,
    quotesReturned: records.reduce((sum, record) => sum + record.quotesReturned, 0),
    rejectedQuotes: records.reduce((sum, record) => sum + record.rejectedQuotes, 0),
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    modelCalls: calls.length,
    callsByHost,
    promptTokens,
    completionTokens,
    costUsd,
    costPerGradeUsd: records.length ? costUsd / records.length : 0,
    byCategory: groupRows(results, (result) => result.evalCase.category),
    bySkill: groupRows(results, (result) => result.evalCase.skill),
  };
}

export type Summary = ReturnType<typeof summarize>;

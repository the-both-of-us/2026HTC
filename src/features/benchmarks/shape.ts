/** Turning raw benchmark calls into results.json, and results into routing advice. */
import { CLOSE_ENOUGH_POINTS, MODELS, modelById, type ModelId, type Subject } from "./catalog";

/** One model answering one question. */
export type CallRecord = {
  model: ModelId;
  subject: string;
  questionId: string;
  answer: string;
  /** Null when the reply had no letter we could read (counts as wrong). */
  picked: string | null;
  correct: boolean;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  /** The reply hit max_tokens, or the model declined. */
  stop: "done" | "cut_off" | "refused";
};

/** One model writing one lesson. */
export type LessonRecord = {
  model: ModelId;
  topic: string;
  ms: number;
  outputTokens: number;
  words: number;
  validJson: boolean;
};

export type Score = {
  n: number;
  correct: number;
  /** 0 to 100, one decimal. */
  accuracy: number;
  medianSeconds: number;
  avgOutputTokens: number;
  /** Estimated US dollars to answer 100 questions like these. */
  costPer100: number;
  unparsed: number;
  cutOff: number;
};

export type LessonSpeed = {
  runs: number;
  medianSeconds: number;
  /** Output tokens per second, thinking included. */
  tokensPerSecond: number;
  avgWords: number;
  validJson: number;
};

export type BenchResults = {
  generatedAt: string;
  questionsPerSubject: number;
  totalQuestions: number;
  effort: string;
  maxTokens: number;
  calls: number;
  spentUsd: number;
  lessonTopics: string[];
  models: { id: ModelId; overall: Score; lessons: LessonSpeed | null }[];
  subjects: {
    id: string;
    label: string;
    level: string;
    benchmark: string;
    n: number;
    scores: Partial<Record<ModelId, Score>>;
  }[];
};

const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function costUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const { priceIn, priceOut } = modelById(model);
  return (inputTokens * priceIn + outputTokens * priceOut) / 1_000_000;
}

export function score(records: CallRecord[]): Score {
  const n = records.length;
  const correct = records.filter((r) => r.correct).length;
  const cost = records.reduce((sum, r) => sum + costUsd(r.model, r.inputTokens, r.outputTokens), 0);
  return {
    n,
    correct,
    accuracy: n ? round((correct / n) * 100) : 0,
    medianSeconds: round(median(records.map((r) => r.ms)) / 1000, 2),
    avgOutputTokens: n ? Math.round(records.reduce((sum, r) => sum + r.outputTokens, 0) / n) : 0,
    costPer100: n ? round((cost / n) * 100, 3) : 0,
    unparsed: records.filter((r) => r.picked === null).length,
    cutOff: records.filter((r) => r.stop !== "done").length,
  };
}

export function lessonSpeed(records: LessonRecord[]): LessonSpeed | null {
  if (records.length === 0) return null;
  const totalTokens = records.reduce((sum, r) => sum + r.outputTokens, 0);
  const totalSeconds = records.reduce((sum, r) => sum + r.ms, 0) / 1000;
  return {
    runs: records.length,
    medianSeconds: round(median(records.map((r) => r.ms)) / 1000),
    tokensPerSecond: totalSeconds ? Math.round(totalTokens / totalSeconds) : 0,
    avgWords: Math.round(records.reduce((sum, r) => sum + r.words, 0) / records.length),
    validJson: records.filter((r) => r.validJson).length,
  };
}

export function shapeResults(input: {
  generatedAt: string;
  subjects: Subject[];
  questionsPerSubject: number;
  effort: string;
  maxTokens: number;
  calls: CallRecord[];
  lessons: LessonRecord[];
  lessonTopics: string[];
}): BenchResults {
  const { calls, lessons } = input;
  const spent =
    calls.reduce((sum, r) => sum + costUsd(r.model, r.inputTokens, r.outputTokens), 0) +
    lessons.reduce((sum, r) => sum + costUsd(r.model, 0, r.outputTokens), 0);

  const subjects = input.subjects
    .map((subject) => {
      const mine = calls.filter((r) => r.subject === subject.id);
      const scores: Partial<Record<ModelId, Score>> = {};
      for (const model of MODELS) {
        const rows = mine.filter((r) => r.model === model.id);
        if (rows.length) scores[model.id] = score(rows);
      }
      const n = new Set(mine.map((r) => r.questionId)).size;
      return { id: subject.id, label: subject.label, level: subject.level, benchmark: subject.benchmark, n, scores };
    })
    .filter((subject) => subject.n > 0);

  return {
    generatedAt: input.generatedAt,
    questionsPerSubject: input.questionsPerSubject,
    totalQuestions: subjects.reduce((sum, s) => sum + s.n, 0),
    effort: input.effort,
    maxTokens: input.maxTokens,
    calls: calls.length + lessons.length,
    spentUsd: round(spent, 2),
    lessonTopics: input.lessonTopics,
    models: MODELS.map((model) => ({
      id: model.id,
      overall: score(calls.filter((r) => r.model === model.id)),
      lessons: lessonSpeed(lessons.filter((r) => r.model === model.id)),
    })),
    subjects,
  };
}

/** The models with the highest accuracy on a subject (ties share it). */
export function bestModels(scores: Partial<Record<ModelId, Score>>): ModelId[] {
  const entries = MODELS.flatMap((m) => (scores[m.id] ? [[m.id, scores[m.id]!.accuracy] as const] : []));
  if (entries.length === 0) return [];
  const top = Math.max(...entries.map(([, accuracy]) => accuracy));
  return entries.filter(([, accuracy]) => accuracy === top).map(([id]) => id);
}

/**
 * The cheapest model within CLOSE_ENOUGH_POINTS of the best on this subject. MODELS is
 * cheapest first, so the first one close enough wins.
 */
export function pickModel(scores: Partial<Record<ModelId, Score>>): { model: ModelId; gap: number } | null {
  const best = bestModels(scores);
  if (best.length === 0) return null;
  const top = scores[best[0]]!.accuracy;
  for (const model of MODELS) {
    const s = scores[model.id];
    if (s && top - s.accuracy <= CLOSE_ENOUGH_POINTS) return { model: model.id, gap: round(top - s.accuracy) };
  }
  return null;
}

/** How far gpt-oss-120b is behind the best model, in points (0 when it is the best). */
export function defaultGap(scores: Partial<Record<ModelId, Score>>): number | null {
  const oss = scores["gpt-oss-120b"];
  const best = bestModels(scores);
  if (!oss || best.length === 0) return null;
  return round(scores[best[0]]!.accuracy - oss.accuracy);
}

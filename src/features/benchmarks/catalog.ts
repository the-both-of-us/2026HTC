/**
 * What gets benchmarked: the four models and the subjects. Shared by the script that runs the
 * benchmark and the page that shows it, so both always describe the same thing.
 */

export type ModelId = "gpt-oss-120b" | "claude-haiku-5-5" | "claude-sonnet-5-5" | "claude-opus-5-5";

export type BenchModel = {
  id: ModelId;
  label: string;
  provider: "Cerebras" | "Anthropic";
  /** US dollars per million tokens. */
  priceIn: number;
  priceOut: number;
  /** The price is an estimate, not what we pay (Cerebras is on its free tier here). */
  priceNote?: string;
};

/** Cheapest first, which is also the order the router steps up in. */
export const MODELS: BenchModel[] = [
  {
    id: "gpt-oss-120b",
    label: "gpt-oss-120b",
    provider: "Cerebras",
    priceIn: 0.35,
    priceOut: 0.75,
    priceNote: "Cerebras' pay-as-you-go list price; the app runs on the free tier",
  },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "Anthropic", priceIn: 0.1, priceOut: 0.5 },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "Anthropic", priceIn: 2, priceOut: 10 },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "Anthropic", priceIn: 4, priceOut: 20 },
];

export const MODEL_IDS = MODELS.map((model) => model.id);

export function modelById(id: ModelId): BenchModel {
  const model = MODELS.find((m) => m.id === id);
  if (!model) throw new Error(`Unknown model ${id}`);
  return model;
}

export type Benchmark = "MMLU-Pro" | "MMLU";

export const BENCHMARK_LINKS: Record<Benchmark, { dataset: string; url: string; paper: string; options: number }> = {
  "MMLU-Pro": {
    dataset: "TIGER-Lab/MMLU-Pro",
    url: "https://huggingface.co/datasets/TIGER-Lab/MMLU-Pro",
    paper: "https://arxiv.org/abs/2406.01574",
    options: 10,
  },
  MMLU: {
    dataset: "cais/mmlu",
    url: "https://huggingface.co/datasets/cais/mmlu",
    paper: "https://arxiv.org/abs/2009.03300",
    options: 4,
  },
};

export type Subject = {
  id: string;
  label: string;
  /** Who the questions are pitched at, in a few words. */
  level: string;
  benchmark: Benchmark;
  /** MMLU-Pro `category`, or MMLU config names. */
  source: string[];
  /** Keep only questions that contain one of these (case-insensitive), for a topic inside a category. */
  searchWords?: string[];
};

/** Words that mark a physics question as quantum or modern physics. */
const QUANTUM_WORDS = [
  "quantum", "photon", "de Broglie", "Schrodinger", "wave function", "uncertainty", "Planck",
  "photoelectric", "Bohr", "Compton", "hydrogen atom", "energy level", "spin", "work function", "electron volt",
];

export const SUBJECTS: Subject[] = [
  { id: "psychology", label: "Psychology", level: "University", benchmark: "MMLU-Pro", source: ["psychology"] },
  {
    id: "quantum",
    label: "Quantum physics",
    level: "University",
    benchmark: "MMLU-Pro",
    source: ["physics"],
    searchWords: QUANTUM_WORDS,
  },
  {
    id: "abstract-algebra",
    label: "Abstract algebra",
    level: "University",
    benchmark: "MMLU",
    source: ["abstract_algebra"],
  },
  { id: "math", label: "Math", level: "University", benchmark: "MMLU-Pro", source: ["math"] },
  {
    id: "elementary-math",
    label: "Elementary math",
    level: "School",
    benchmark: "MMLU",
    source: ["elementary_mathematics"],
  },
  {
    id: "computer-science",
    label: "Computer science",
    level: "University",
    benchmark: "MMLU-Pro",
    source: ["computer science"],
  },
  { id: "health", label: "Health and medicine", level: "Professional", benchmark: "MMLU-Pro", source: ["health"] },
  { id: "law", label: "Law", level: "Professional", benchmark: "MMLU", source: ["professional_law"] },
];

export const QUESTIONS_PER_SUBJECT = 8;

/** How far behind the best model a cheaper one may be and still be "as good" for routing. */
export const CLOSE_ENOUGH_POINTS = 5;

/**
 * The plain parts of prepareSamples.ts: arguments, the store check, the plan and the
 * pacing. No store, no model, no clock, so they are tested directly.
 */

export type Kind = "flashcards" | "quiz";

export const KINDS: readonly Kind[] = ["flashcards", "quiz"];

/** The AI gateway's free tier allows about 5 requests a minute per model, so 13 s keeps well inside it. */
export const DEFAULT_GAP_MS = 13_000;

export type Options = {
  dryRun: boolean;
  /** Only this kind, or both when null. */
  only: Kind | null;
  /** The least time between the starts of two generation calls. */
  gapMs: number;
};

/** A mistake in the command line. The message is a sentence for the person running it. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export const USAGE =
  "Usage: npx tsx --env-file=.env.local src/features/courses/dev/prepareSamples.ts [--dry-run] [--only=flashcards|quiz] [--gap-ms=13000]";

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = { dryRun: false, only: null, gapMs: DEFAULT_GAP_MS };
  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--only=")) {
      const value = arg.slice("--only=".length);
      if (value !== "flashcards" && value !== "quiz") {
        throw new UsageError(`--only must be flashcards or quiz, not "${value}".`);
      }
      options.only = value;
    } else if (arg.startsWith("--gap-ms=")) {
      const value = arg.slice("--gap-ms=".length);
      const gapMs = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(gapMs)) {
        throw new UsageError(`--gap-ms must be a whole number of milliseconds, not "${value}".`);
      }
      options.gapMs = gapMs;
    } else {
      throw new UsageError(`"${arg}" is not an option this script knows.`);
    }
  }
  return options;
}

export function kindsFor(only: Kind | null): Kind[] {
  return only ? [only] : [...KINDS];
}

type Env = Record<string, string | undefined>;

/**
 * Which store the app would save to, from env names only (the same order as
 * @/shared/store). Null means the in-memory store, which keeps nothing after the script ends.
 */
export function storeDriverName(env: Env): "S3" | "Vercel Blob" | null {
  if (env.S3_BUCKET) return "S3";
  if (env.BLOB_READ_WRITE_TOKEN) return "Vercel Blob";
  return null;
}

/** A sentence saying why the script must stop, or null when it may go on. A dry run needs no store. */
export function storeRefusal(env: Env, dryRun: boolean): string | null {
  if (dryRun || storeDriverName(env)) return null;
  return (
    "No store is set up (neither S3_BUCKET nor BLOB_READ_WRITE_TOKEN is in the environment), so the cards " +
    "and questions would be made in memory and lost when this script ends. Run it with --env-file=.env.local " +
    "on a machine whose .env.local has the store settings, or add --dry-run to only see the plan."
  );
}

export type PlanMap = {
  sampleId: string;
  /** The sample's short name, for progress lines. */
  label: string;
  mapId: string;
  nodes: { id: string; title: string }[];
};

export type PlanItem = {
  kind: Kind;
  sampleId: string;
  label: string;
  mapId: string;
  nodeId: string;
  nodeTitle: string;
  /** Saved before this run, so it needs no model call. */
  saved: boolean;
};

export type IsSaved = (kind: Kind, mapId: string, nodeId: string) => Promise<boolean>;

/**
 * Every item in order: map by map, skill by skill, flashcards before the quiz. A store
 * read that fails counts as not saved: making it reads the store again first, so a saved
 * item still costs no model call.
 */
export async function buildPlan(maps: readonly PlanMap[], kinds: readonly Kind[], isSaved: IsSaved): Promise<PlanItem[]> {
  const items: PlanItem[] = [];
  for (const map of maps) {
    for (const node of map.nodes) {
      for (const kind of kinds) {
        const saved = await isSaved(kind, map.mapId, node.id).catch(() => false);
        items.push({
          kind,
          sampleId: map.sampleId,
          label: map.label,
          mapId: map.mapId,
          nodeId: node.id,
          nodeTitle: node.title,
          saved,
        });
      }
    }
  }
  return items;
}

/** How long to wait before the next generation call starts. The first call never waits. */
export function waitBeforeNextMs(lastStartedAt: number | null, now: number, gapMs: number): number {
  if (lastStartedAt === null) return 0;
  return Math.max(0, lastStartedAt + gapMs - now);
}

/** Rough minutes for this many calls: the gaps between them, as calls usually finish inside one gap. */
export function estimateMinutes(calls: number, gapMs: number): number {
  if (calls <= 0) return 0;
  return Math.max(1, Math.round((calls * gapMs) / 60_000));
}

export function progressLine(index: number, total: number, item: PlanItem): string {
  return `[${index + 1}/${total}] ${item.kind} · ${item.label} · ${item.nodeTitle} …`;
}

export function countLabel(kind: Kind, count: number): string {
  if (kind === "flashcards") return `${count} ${count === 1 ? "card" : "cards"}`;
  return `${count} ${count === 1 ? "question" : "questions"}`;
}

/**
 * What a failure prints. Our own errors (an HTTP status, or the AI's AiUnavailableError)
 * carry sentences written for people. Anything else prints its name only, because its
 * message can hold provider text.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "an unknown error";
  const status = (error as { status?: unknown }).status;
  if (error.name === "AiUnavailableError" || typeof status === "number") return `${error.name}: ${error.message}`;
  return `${error.name} (details left out, as they can hold provider text)`;
}

export type Summary = { made: number; alreadyThere: number; failed: number };

export function summaryLine(summary: Summary): string {
  return `Done: made ${summary.made}, already there ${summary.alreadyThere}, failed ${summary.failed}.`;
}

/** True only when node was started on prepareSamples.ts itself, so importing the file (as tests do) runs nothing. */
export function isRunDirectly(argv1: string | undefined): boolean {
  return /(^|[\\/])prepareSamples\.ts$/.test(argv1 ?? "");
}

/**
 * One safe line for what app code passes to console.error, warn or info during a run.
 * Strings are the app's own words and pass through. An Error goes through describeError,
 * since a raw SDK error can carry request details such as an access key id. Anything else
 * is left out.
 */
export function safeConsoleLine(args: readonly unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return describeError(arg);
      return "(details left out)";
    })
    .join(" ");
}

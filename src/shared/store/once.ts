import { claimDoc, deleteDoc, getDoc, putDoc } from "./index";

/**
 * Generate once (wave 2). Guards a canonical key K so its content is produced by exactly one
 * writer at a time, across requests and server instances, and lets every viewer follow the
 * progress by polling.
 *
 * - Claim: `claims/K` holds a OnceClaim. A claim whose `heartbeatAt` is older than
 *   ONCE_DEAD_AFTER_MS is dead: the next `startOnce` takes it over with `attempt + 1`. Only one
 *   caller can take over a given attempt: it must first win `claims/K~takeover-<attempt>`.
 * - Progress: `partial/K` holds a OncePartial with the parts emitted so far.
 * - Success: `putDoc(K, value)`, then the partial doc and the claim are deleted.
 * - Failure: both are deleted and the error is logged. Nothing retries by itself: the next
 *   `startOnce` (the next POST) starts over.
 *
 * Every store write is a billed operation on Vercel Blob, so `emit` writes the partial doc at
 * most once every ONCE_WRITE_EVERY_MS, with a trailing write so the last part is always written,
 * and the claim's heartbeat at most once every ONCE_HEARTBEAT_EVERY_MS. Import from
 * `@/shared/store/once` (not re-exported by the store index).
 */

/** A claim older than this (by heartbeat) is a writer that died. */
export const ONCE_DEAD_AFTER_MS = 130_000;

/** At most one partial-doc write per key in this window (plus a trailing write). */
export const ONCE_WRITE_EVERY_MS = 1_500;

/** At most one heartbeat write per key in this window: far inside ONCE_DEAD_AFTER_MS. */
export const ONCE_HEARTBEAT_EVERY_MS = 20_000;

/** What `claims/K` holds. ISO timestamps. */
export type OnceClaim = { startedAt: string; heartbeatAt: string; attempt: number };

/** What `partial/K` holds. `attempt` changes on `restart()`, so a viewer can swap in new parts. */
export type OncePartial<P> = { attempt: number; parts: P[]; updatedAt: string };

/** Handed to `produce`. */
export type OnceContext<P> = {
  /** 1 for a first claim; higher after a dead claim was taken over. */
  attempt: number;
  /**
   * Appends a part. Writes the partial doc (and, less often, the heartbeat) serially, at most
   * once every ONCE_WRITE_EVERY_MS; a part inside that window is written by a trailing write.
   * Await it to keep order; it never throws for a store hiccup (it logs and the next write catches up).
   */
  emit(part: P): Promise<void>;
  /** Writes any pending parts now (call it at the end of a stream, before a slow check or repair). */
  flush(): Promise<void>;
  /** Starts a repair attempt: clears the parts, bumps `attempt`, writes the partial doc now. */
  restart(): Promise<void>;
  /** Refreshes the heartbeat without a part, for a long step that emits nothing. Throttled. */
  heartbeat(): Promise<void>;
};

/**
 * "ready": K already exists. "running": a live claim is writing K (this call does nothing).
 * `started`: this call won the claim; `work` resolves to the value written to K, or rejects with
 * the producer's error after the claim and partial doc are cleaned up. A caller that does not
 * await `work` (an `after()` task) must catch it.
 */
export type StartOnceResult<T> = "ready" | "running" | { started: true; work: Promise<T> };

/** What a viewer reads. A dead claim with no K reads as "idle". */
export type OnceRead<T, P> =
  | { state: "ready"; value: T }
  | { state: "running"; attempt: number; parts: P[]; updatedAt: string | null }
  | { state: "idle" };

export const onceClaimKey = (key: string) => `claims/${key}`;
export const oncePartialKey = (key: string) => `partial/${key}`;
const takeoverKey = (key: string, attempt: number) => `${onceClaimKey(key)}~takeover-${attempt}`;

/** Timings, changeable in tests only. */
const timing = { writeEveryMs: ONCE_WRITE_EVERY_MS, heartbeatEveryMs: ONCE_HEARTBEAT_EVERY_MS, deadAfterMs: ONCE_DEAD_AFTER_MS };

/** Tests only: shorter windows so a test does not wait seconds. Pass nothing to restore. */
export function setOnceTimingForTests(next: Partial<typeof timing> = {}): void {
  timing.writeEveryMs = next.writeEveryMs ?? ONCE_WRITE_EVERY_MS;
  timing.heartbeatEveryMs = next.heartbeatEveryMs ?? ONCE_HEARTBEAT_EVERY_MS;
  timing.deadAfterMs = next.deadAfterMs ?? ONCE_DEAD_AFTER_MS;
}

// On globalThis, because Next.js can load this file more than once (one copy per route), and a
// second start of K in this process must see the first. Entries are removed when the work settles.
const globalOnce = globalThis as typeof globalThis & { oryxOnceRunning?: Map<string, Promise<unknown>> };
const running = (globalOnce.oryxOnceRunning ??= new Map());

function isLive(claim: OnceClaim | null, now = Date.now()): boolean {
  if (!claim) return false;
  const beat = Date.parse(claim.heartbeatAt);
  return Number.isFinite(beat) && now - beat < timing.deadAfterMs;
}

const reason = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : "unknown error");

/** Takes K's claim if it is free or dead. Returns the attempt number, or null when someone else holds it. */
async function takeClaim(key: string): Promise<number | null> {
  const now = new Date().toISOString();
  if (await claimDoc(onceClaimKey(key), { startedAt: now, heartbeatAt: now, attempt: 1 } satisfies OnceClaim)) return 1;

  const current = await getDoc<OnceClaim>(onceClaimKey(key));
  if (!current) {
    // Finished or failed between our claim and this read: try once more.
    return (await claimDoc(onceClaimKey(key), { startedAt: now, heartbeatAt: now, attempt: 1 } satisfies OnceClaim)) ? 1 : null;
  }
  if (isLive(current)) return null;

  // Dead writer: exactly one caller wins the right to take over this attempt.
  const attempt = (Number.isInteger(current.attempt) ? current.attempt : 1) + 1;
  if (!(await claimDoc(takeoverKey(key, attempt), { at: now }))) return null;
  await putDoc(onceClaimKey(key), { startedAt: now, heartbeatAt: now, attempt } satisfies OnceClaim);
  console.warn(`[once] took over a dead claim on ${key} (attempt ${attempt})`);
  return attempt;
}

/**
 * Starts producing K unless it exists or a live claim is producing it. `produce` returns the
 * final value; startOnce stores it at K. Concurrent calls for one K start `produce` once.
 */
export async function startOnce<T, P = never>(
  key: string,
  produce: (context: OnceContext<P>) => Promise<T>,
): Promise<StartOnceResult<T>> {
  if (running.has(key)) return "running";
  if ((await getDoc(key)) !== null) return "ready";
  if (running.has(key)) return "running";

  const attempt = await takeClaim(key);
  if (attempt === null) return (await getDoc(key)) !== null ? "ready" : "running";
  // K may have been written between our first read and our claim.
  if ((await getDoc(key)) !== null) {
    await releaseClaim(key, attempt);
    return "ready";
  }
  if (running.has(key)) {
    // Another call in this process got here first after all; leave the claim to it.
    return "running";
  }

  const work = runProducer(key, attempt, produce);
  running.set(key, work);
  work.then(
    () => running.delete(key),
    () => running.delete(key),
  );
  return { started: true, work };
}

/** Deletes the claim only if it is still ours (a slow writer may have been taken over), plus our takeover markers. */
async function releaseClaim(key: string, attempt: number): Promise<void> {
  const current = await getDoc<OnceClaim>(onceClaimKey(key)).catch(() => null);
  if (!current || current.attempt === attempt) await deleteDoc(onceClaimKey(key));
  for (let n = 2; n <= attempt; n++) await deleteDoc(takeoverKey(key, n));
}

async function runProducer<T, P>(key: string, attempt: number, produce: (context: OnceContext<P>) => Promise<T>): Promise<T> {
  let parts: P[] = [];
  let partialAttempt = attempt;
  let closed = false;
  let dirty = false;
  let lastPartialAt = 0;
  let lastBeatAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Every store write goes through this chain, so writes never overlap or arrive out of order.
  let chain: Promise<void> = Promise.resolve();

  const enqueue = (write: () => Promise<void>): Promise<void> => {
    chain = chain.then(write).catch((error) => {
      console.warn(`[once] progress write for ${key} failed: ${reason(error)}`);
    });
    return chain;
  };

  const writePartial = () =>
    enqueue(async () => {
      if (closed) return;
      dirty = false;
      lastPartialAt = Date.now();
      const doc: OncePartial<P> = { attempt: partialAttempt, parts: [...parts], updatedAt: new Date().toISOString() };
      await putDoc(oncePartialKey(key), doc);
      if (Date.now() - lastBeatAt >= timing.heartbeatEveryMs) await writeBeat();
    });

  const writeBeat = async () => {
    if (closed) return;
    lastBeatAt = Date.now();
    const current = await getDoc<OnceClaim>(onceClaimKey(key));
    // Taken over (we were too slow): keep writing nothing to the new writer's claim.
    if (current && current.attempt !== attempt) return;
    await putDoc(onceClaimKey(key), {
      startedAt: current?.startedAt ?? new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      attempt,
    } satisfies OnceClaim);
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const context: OnceContext<P> = {
    attempt,
    async emit(part) {
      if (closed) return;
      parts.push(part);
      dirty = true;
      const wait = lastPartialAt + timing.writeEveryMs - Date.now();
      if (wait <= 0) {
        clearTimer();
        await writePartial();
      } else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          if (dirty) void writePartial();
        }, wait);
      }
    },
    async flush() {
      clearTimer();
      if (dirty) await writePartial();
      else await chain;
    },
    async restart() {
      parts = [];
      partialAttempt += 1;
      dirty = true;
      clearTimer();
      await writePartial();
    },
    async heartbeat() {
      if (Date.now() - lastBeatAt < timing.heartbeatEveryMs) return;
      await enqueue(writeBeat);
    },
  };

  const close = async () => {
    clearTimer();
    await chain;
    closed = true;
  };

  try {
    const value = await produce(context);
    await close();
    // A writer taken over as dead may still finish: K is final once written, so never rewrite it.
    const existing = await getDoc<T>(key);
    if (existing !== null) {
      await deleteDoc(oncePartialKey(key)).catch(() => {});
      await releaseClaim(key, attempt);
      return existing;
    }
    await putDoc(key, value);
    await deleteDoc(oncePartialKey(key));
    await releaseClaim(key, attempt);
    return value;
  } catch (error) {
    await close();
    console.warn(`[once] ${key} failed (attempt ${attempt}): ${reason(error)}`);
    await deleteDoc(oncePartialKey(key)).catch(() => {});
    await releaseClaim(key, attempt).catch(() => {});
    throw error;
  }
}

/** K if it exists, else the live claim's parts, else idle. Two or three reads, no writes. */
export async function readOnce<T, P = never>(key: string): Promise<OnceRead<T, P>> {
  const value = await getDoc<T>(key);
  if (value !== null) return { state: "ready", value };
  const claim = await getDoc<OnceClaim>(onceClaimKey(key));
  if (!claim) {
    // The writer may have finished between the two reads.
    const late = await getDoc<T>(key);
    return late !== null ? { state: "ready", value: late } : { state: "idle" };
  }
  if (!isLive(claim)) return { state: "idle" };
  const partial = await getDoc<OncePartial<P>>(oncePartialKey(key));
  return {
    state: "running",
    attempt: partial?.attempt ?? claim.attempt,
    parts: Array.isArray(partial?.parts) ? partial.parts : [],
    updatedAt: partial?.updatedAt ?? null,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * For a caller that lost the claim and needs the value in this request (quiz, flashcards, catch):
 * polls K every `everyMs` (default 1 500) for up to `timeoutMs`. Null on timeout or when the
 * claim disappears (or dies) without K (the writer failed).
 */
export async function waitForOnce<T>(key: string, options: { timeoutMs: number; everyMs?: number }): Promise<T | null> {
  const until = Date.now() + options.timeoutMs;
  const every = options.everyMs ?? 1_500;
  for (;;) {
    const value = await getDoc<T>(key);
    if (value !== null) return value;
    const claim = await getDoc<OnceClaim>(onceClaimKey(key));
    if (!isLive(claim)) {
      // One last look: the writer may have just finished.
      return getDoc<T>(key);
    }
    const left = until - Date.now();
    if (left <= 0) return null;
    await sleep(Math.min(every, left));
  }
}

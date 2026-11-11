/*
 * Tests only. A stand-in for `@/shared/store/once` with the same contract, on the memory store,
 * with no throttle, so tests of canonical content do not depend on its timing. Use it with
 *   vi.mock("@/shared/store/once", async () => await import("@/shared/store/onceFake"));
 * Claims are kept in this process (a Map), so concurrent starts in one test share one producer.
 */
import { deleteDoc, getDoc, putDoc } from "@/shared/store";
import type { OnceContext, OnceRead, StartOnceResult } from "@/shared/store/once";

export const onceClaimKey = (key: string) => `claims/${key}`;
export const oncePartialKey = (key: string) => `partial/${key}`;
export const ONCE_DEAD_AFTER_MS = 130_000;
export const ONCE_WRITE_EVERY_MS = 1_500;

const live = new Map<string, { attempt: number; parts: unknown[] }>();

export async function startOnce<T, P = never>(
  key: string,
  produce: (context: OnceContext<P>) => Promise<T>,
): Promise<StartOnceResult<T>> {
  if ((await getDoc(key)) !== null) return "ready";
  if (live.has(key)) return "running";
  const state = { attempt: 1, parts: [] as unknown[] };
  live.set(key, state);
  const write = () => putDoc(oncePartialKey(key), { attempt: state.attempt, parts: state.parts, updatedAt: new Date().toISOString() });
  const context: OnceContext<P> = {
    attempt: 1,
    async emit(part) {
      state.parts.push(part);
      await write();
    },
    async flush() {},
    async restart() {
      state.attempt += 1;
      state.parts = [];
      await write();
    },
    async heartbeat() {},
  };
  const work = (async () => {
    try {
      const value = await produce(context);
      await putDoc(key, value);
      return value;
    } finally {
      live.delete(key);
      await deleteDoc(oncePartialKey(key));
    }
  })();
  return { started: true, work };
}

export async function readOnce<T, P = never>(key: string): Promise<OnceRead<T, P>> {
  const value = await getDoc<T>(key);
  if (value !== null) return { state: "ready", value };
  const state = live.get(key);
  if (!state) return { state: "idle" };
  return { state: "running", attempt: state.attempt, parts: [...state.parts] as P[], updatedAt: null };
}

export async function waitForOnce<T>(key: string, options: { timeoutMs: number; everyMs?: number }): Promise<T | null> {
  const end = Date.now() + options.timeoutMs;
  for (;;) {
    const value = await getDoc<T>(key);
    if (value !== null) return value;
    if (!live.has(key) || Date.now() >= end) return null;
    await new Promise((resolve) => setTimeout(resolve, Math.min(options.everyMs ?? 5, 5)));
  }
}

/** Marks a key as being written by someone else (a live claim with these parts), for "running" cases. */
export function fakeRunning(key: string, parts: unknown[] = [], attempt = 1): () => void {
  live.set(key, { attempt, parts });
  return () => live.delete(key);
}

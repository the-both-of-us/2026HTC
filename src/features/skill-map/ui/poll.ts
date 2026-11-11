"use client";

import { useEffect, useRef } from "react";

/*
 * One serial polling loop, copied into programs/ui, skill-map/ui and lessons/ui (a feature may
 * not import another feature's internals). Rules:
 * - one request at a time: the next tick starts only after the last one settled and the interval passed;
 * - nothing runs while the page is hidden; the loop picks up again when it is visible;
 * - it stops when `tick` returns false or the signal aborts.
 */

function whenVisible(signal: AbortSignal): Promise<void> {
  if (typeof document === "undefined" || !document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      document.removeEventListener("visibilitychange", onChange);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const onChange = () => {
      if (!document.hidden) finish();
    };
    document.addEventListener("visibilitychange", onChange);
    signal.addEventListener("abort", finish);
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish);
  });
}

/** Runs `tick` until it answers false. `first: "now"` ticks at once, "after" waits one interval first. */
export async function pollLoop(
  tick: (signal: AbortSignal) => Promise<boolean>,
  intervalMs: number,
  signal: AbortSignal,
  first: "now" | "after" = "after",
): Promise<void> {
  if (first === "after") await sleep(intervalMs, signal);
  while (!signal.aborted) {
    await whenVisible(signal);
    if (signal.aborted) return;
    let more = false;
    try {
      more = await tick(signal);
    } catch {
      more = false;
    }
    if (!more || signal.aborted) return;
    await sleep(intervalMs, signal);
  }
}

/** Polls while `enabled`. `tick` returns true to keep going. The loop restarts when `enabled` flips back on. */
export function usePoll(enabled: boolean, tick: (signal: AbortSignal) => Promise<boolean>, intervalMs: number): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  });
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    void pollLoop((signal) => latest.current(signal), intervalMs, abort.signal);
    return () => abort.abort();
  }, [enabled, intervalMs]);
}

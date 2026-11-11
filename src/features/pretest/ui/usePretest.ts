"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PretestAnswersRequest, PretestView } from "../types";
import { dismissPretest, getPretest, startPretest, stopPretest, submitPretestAnswers, type PretestResult } from "./api";
import { usePoll } from "@/shared/ui";

/** How often to ask again while a unit's questions are being written. */
export const PRETEST_POLL_MS = 1_500;
/** After this long a unit is "taking longer than usual", and the learner may ask again. */
export const SLOW_AFTER_MS = 90_000;
/** A stalled writer is restarted by itself this many times before the learner is asked. */
const AUTO_RESTARTS = 2;

export type PretestPending = "start" | "answers" | "stop" | "dismiss" | null;

export type PretestSession = {
  /** Null until the first answer, and for a map that has no pre-test route (not yours, not found). */
  view: PretestView | null;
  pending: PretestPending;
  /** A sentence for the last request that failed; cleared by the next one. */
  error: string | null;
  /** Writing has gone on for a while. */
  slow: boolean;
  /** True once the learner may be asked to start again by hand. */
  stalledForGood: boolean;
  start: () => Promise<PretestView | null>;
  /** `onOk` runs in the same batch as the new view, so a screen can react without a flash in between. */
  submit: (body: PretestAnswersRequest, onOk?: (view: PretestView) => void) => Promise<PretestView | null>;
  stop: () => Promise<PretestView | null>;
  dismiss: () => Promise<PretestView | null>;
  clearError: () => void;
};

/**
 * One learner's pre-test of one map. Reads the view once (and again when `refreshKey` changes, as
 * a syllabus finishes), keeps at most one request in flight, and, while `active` (the test is on
 * screen), asks again every 1.5 s as long as questions are being written. A stalled writer is
 * restarted. Nothing polls while the tab is hidden.
 */
export function usePretest(mapId: string, enabled: boolean, active: boolean, refreshKey = ""): PretestSession {
  const [view, setView] = useState<PretestView | null>(null);
  const [pending, setPending] = useState<PretestPending>(null);
  const [error, setError] = useState<string | null>(null);
  const [slowKey, setSlowKey] = useState<string | null>(null);
  const [restartCount, setRestartCount] = useState(0);
  const busy = useRef(false);

  // Every view that arrives goes through here. Questions that are ready end a run of restarts.
  const accept = useCallback((next: PretestView) => {
    setView(next);
    if (next.state === "answering") setRestartCount(0);
  }, []);

  // Read the view. A failure here only means no offer is shown.
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    void getPretest(mapId, abort.signal).then((result) => {
      if (!abort.signal.aborted && result.ok) accept(result.view);
    });
    return () => abort.abort();
  }, [mapId, enabled, refreshKey, accept]);

  const run = useCallback(
    async (
      kind: Exclude<PretestPending, null>,
      call: () => Promise<PretestResult>,
      onOk?: (view: PretestView) => void,
    ): Promise<PretestView | null> => {
      if (busy.current) return null;
      busy.current = true;
      setPending(kind);
      setError(null);
      try {
        const result = await call();
        if (result.ok) {
          onOk?.(result.view);
          accept(result.view);
          return result.view;
        }
        setError(result.message);
        return null;
      } finally {
        busy.current = false;
        setPending(null);
      }
    },
    [accept],
  );

  const start = useCallback(() => run("start", () => startPretest(mapId)), [run, mapId]);
  const submit = useCallback(
    (body: PretestAnswersRequest, onOk?: (view: PretestView) => void) => run("answers", () => submitPretestAnswers(mapId, body), onOk),
    [run, mapId],
  );
  const stop = useCallback(() => run("stop", () => stopPretest(mapId)), [run, mapId]);
  const dismiss = useCallback(() => run("dismiss", () => dismissPretest(mapId)), [run, mapId]);

  const writing = active && view?.state === "writing";
  const pollTick = useCallback(
    async (signal: AbortSignal): Promise<boolean> => {
      // A request of ours is in flight: skip this tick, ask again after the next interval.
      if (busy.current) return true;
      const result = await getPretest(mapId, signal);
      if (signal.aborted) return false;
      if (!result.ok) return true;
      accept(result.view);
      return result.view.state === "writing";
    },
    [mapId, accept],
  );
  usePoll(writing, pollTick, PRETEST_POLL_MS);

  // Writing for a long time: say so, and offer to ask again.
  const writingKey = view?.pendingUnitId ?? "first";
  useEffect(() => {
    if (!writing) return;
    const timer = setTimeout(() => setSlowKey(writingKey), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [writing, writingKey]);
  const slow = writing && slowKey === writingKey;

  // Nobody is writing the questions: start again, a couple of times by itself, then ask the learner.
  const stalled = active && view?.state === "stalled" && pending === null;
  useEffect(() => {
    if (!stalled || restartCount >= AUTO_RESTARTS) return;
    void start().then(() => setRestartCount((count) => count + 1));
  }, [stalled, restartCount, start]);
  const stalledForGood = active && view?.state === "stalled" && restartCount >= AUTO_RESTARTS;

  const clearError = useCallback(() => setError(null), []);

  return { view, pending, error, slow, stalledForGood, start, submit, stop, dismiss, clearError };
}

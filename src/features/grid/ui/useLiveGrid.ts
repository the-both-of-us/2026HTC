"use client";

import { useCallback, useEffect, useState } from "react";
import { applyReading, markUnreachable, type LiveState } from "../live";
import type { GridReading } from "../types";

const CHECK_EVERY_MS = 60 * 1000;

/** Keeps a grid reading up to date in the browser. It pauses while the tab is hidden. */
export function useLiveGrid(initial: GridReading | null) {
  const [state, setState] = useState<LiveState>({ reading: initial, previous: null });

  const check = useCallback(async () => {
    try {
      const response = await fetch("/api/grid");
      const next = (await response.json()) as GridReading;
      if (typeof next?.status !== "string") throw new Error("Unexpected reply");
      setState((current) => applyReading(current, next));
    } catch {
      setState(markUnreachable);
    }
  }, []);

  useEffect(() => {
    const checkIfVisible = () => {
      if (!document.hidden) void check();
    };
    if (!initial) checkIfVisible();
    const timer = setInterval(checkIfVisible, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", checkIfVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", checkIfVisible);
    };
  }, [check, initial]);

  return { ...state, check };
}

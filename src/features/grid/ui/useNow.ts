"use client";

import { useEffect, useState } from "react";

/** The current time, updated on a timer. Null until hydrated, so server and browser render the same first frame. */
export function useNow(everyMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [everyMs]);

  return now;
}

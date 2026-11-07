"use client";

import clsx from "clsx";
import { ExternalLink, TriangleAlert } from "lucide-react";
import { isReadingStale } from "../live";
import { AESO_REPORT_URL, type GridReading, type GridSnapshot } from "../types";
import { useNow } from "./useNow";

function secondsAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 90) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

export function AesoSourceLink({ className }: { className?: string }) {
  return (
    <a
      href={AESO_REPORT_URL}
      target="_blank"
      rel="noreferrer"
      className={clsx("inline-flex items-center gap-1 underline underline-offset-4", className)}
    >
      AESO Current Supply Demand report
      <ExternalLink size={14} aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

type LiveReading = Extract<GridReading, { snapshot: GridSnapshot }>;

/** Says exactly how fresh the numbers are, and where they came from. */
export function GridStatus({ reading }: { reading: LiveReading }) {
  const now = useNow(1000);
  const { snapshot } = reading;
  const fetchFailed = reading.status === "stale";
  const stale = isReadingStale(reading, now);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink-soft">
        <span
          className={clsx(
            "inline-flex items-center gap-2 rounded-control border px-2 py-0.5 font-semibold",
            stale ? "border-contour border-dashed text-contour" : "border-proven text-ink",
          )}
        >
          {stale ? (
            <TriangleAlert size={14} aria-hidden="true" />
          ) : (
            <span aria-hidden="true" className="relative flex size-2">
              <span className="absolute inline-flex size-full rounded-full bg-proven opacity-75 motion-safe:animate-ping" />
              <span className="relative inline-flex size-2 rounded-full bg-proven" />
            </span>
          )}
          {stale ? "Stale" : "Live"}
        </span>
        <span>
          As of <strong className="font-semibold text-ink">{snapshot.asOfLabel}</strong> Alberta time
        </span>
        <span>
          Source: <AesoSourceLink />
        </span>
        <span>
          {now === null ? "Read just now" : `Read ${secondsAgo(reading.fetchedAt, now)}`}. Checks every
          minute.
        </span>
      </div>
      {stale && (
        <p
          role="status"
          className="rounded-control border border-dashed border-contour bg-sheet px-3 py-2 text-sm text-ink"
        >
          {fetchFailed
            ? `We can't reach AESO right now, so these are the last good figures, from ${snapshot.asOfLabel}. The grid has probably moved since then.`
            : `AESO's report hasn't updated since ${snapshot.asOfLabel}, so treat these figures as old.`}
        </p>
      )}
    </div>
  );
}

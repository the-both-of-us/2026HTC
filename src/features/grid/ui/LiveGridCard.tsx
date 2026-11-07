"use client";

import clsx from "clsx";
import { ArrowRight, Zap } from "lucide-react";
import Link from "next/link";
import { Card, Spinner } from "@/shared/ui";
import { isReadingStale } from "../live";
import { mw } from "../metrics";
import { AesoSourceLink } from "./GridStatus";
import { MixBarThin } from "./MixBar";
import { useLiveGrid } from "./useLiveGrid";
import { useNow } from "./useNow";

/**
 * One line for beside the map's tabs on a large screen, where the map fills the window. It
 * shows nothing until there is a figure, and says so when that figure is an old one.
 */
export function LiveGridStrip({ className }: { className?: string }) {
  const { reading } = useLiveGrid(null);
  const now = useNow(30_000);
  if (!reading || reading.status === "unavailable") return null;
  const stale = isReadingStale(reading, now);

  return (
    <Link
      href="/grid"
      title={`AESO, ${stale ? "last good reading from " : "as of "}${reading.snapshot.asOfLabel} Alberta time`}
      className={clsx(
        "items-center gap-2 px-4 text-sm text-ink-soft transition-control hover:text-ink",
        className,
      )}
    >
      <Zap size={15} aria-hidden="true" className="text-amber" />
      {stale ? "Alberta's grid, last good reading:" : "Alberta's grid now:"}
      <span className="font-medium text-ink tabular-nums">{mw(reading.snapshot.load)} MW</span>
      <span>of load</span>
      <ArrowRight size={15} aria-hidden="true" />
    </Link>
  );
}

/** A live AESO reading for a skill map whose posting is energy related. */
export function LiveGridCard({ className }: { className?: string }) {
  const { reading } = useLiveGrid(null);
  const now = useNow(30_000);
  const stale = reading && reading.status !== "unavailable" && isReadingStale(reading, now);

  return (
    <Card className={className}>
      <div className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Zap size={18} aria-hidden="true" />
          {stale ? "Alberta's grid, last good reading" : "Alberta's grid, right now"}
        </h2>

        {!reading && (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <Spinner size={16} />
            Reading AESO&apos;s latest report.
          </p>
        )}

        {reading?.status === "unavailable" && (
          <p className="text-sm text-ink-soft">
            AESO can&apos;t be reached right now and we have no earlier reading, so there are no figures to
            show.
          </p>
        )}

        {reading && reading.status !== "unavailable" && (
          <>
            <p className="text-sm text-ink-soft">
              <span className="text-3xl font-medium text-ink">{mw(reading.snapshot.load)}</span> MW of load
            </p>
            <MixBarThin snapshot={reading.snapshot} />
            <p className="text-sm text-ink-soft">
              {stale ? "Stale: last good reading from " : "As of "}
              {reading.snapshot.asOfLabel} Alberta time.
            </p>
          </>
        )}

        <p className="text-sm text-ink-soft">
          Source: <AesoSourceLink />
        </p>
        <Link href="/grid" className="inline-flex items-center gap-1.5 font-semibold underline underline-offset-4">
          Practise reading the live grid
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </Card>
  );
}

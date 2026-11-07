"use client";

import { ArrowRight, Zap } from "lucide-react";
import Link from "next/link";
import { Card, Spinner } from "@/shared/ui";
import { mw } from "../metrics";
import { AesoSourceLink } from "./GridStatus";
import { MixBarThin } from "./MixBar";
import { useLiveGrid } from "./useLiveGrid";

/** A live AESO reading for a skill map whose posting is energy related. */
export function LiveGridCard({ className }: { className?: string }) {
  const { reading } = useLiveGrid(null);

  return (
    <Card className={className}>
      <div className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Zap size={18} aria-hidden="true" />
          Alberta&apos;s grid, right now
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
              <span className="text-3xl font-bold text-ink">{mw(reading.snapshot.load)}</span> MW of load
            </p>
            <MixBarThin snapshot={reading.snapshot} />
            <p className="text-sm text-ink-soft">
              {reading.status === "stale" ? "Stale: last good reading from " : "As of "}
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

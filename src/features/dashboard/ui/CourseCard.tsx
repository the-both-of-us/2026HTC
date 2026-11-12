"use client";

import clsx from "clsx";
import { ListChecks } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Seal } from "@/shared/ui";

/** Cover colours: soft sage, mist and sand, each with ink text and ink seal lines in every theme. */
const TONES = ["--color-cover-1", "--color-cover-2", "--color-cover-3"] as const;

/** The same course always gets the same colour. */
function toneFor(fingerprint: string): string {
  let hash = 0;
  for (const char of fingerprint) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

/**
 * A course's cover: a band with the course's own seal, drawn from its id, so every course looks
 * different and always the same. Ink lines only: foil is for proven things. `tone="auto"`
 * picks the tint from the id too (cards); heroes use the sage tint.
 */
export function CourseCover({
  fingerprint,
  tone = "ink",
  className,
  sealClassName,
  children,
}: {
  fingerprint: string;
  tone?: "ink" | "auto";
  className?: string;
  /** Size and place the seal; it bleeds off the right edge by default. */
  sealClassName?: string;
  children?: ReactNode;
}) {
  // A soft tint with ink on it. Text inside that asks for on-ink colours gets ink, so heroes need no changes.
  const cover = {
    "--cover": `var(${tone === "auto" ? toneFor(fingerprint) : "--color-cover-1"})`,
    "--color-on-ink": "var(--color-ink)",
    "--color-on-ink-soft": "var(--color-ink-2)",
  } as CSSProperties;
  return (
    <div className={clsx("relative isolate overflow-hidden bg-(--cover) text-ink", className)} style={cover}>
      <div
        aria-hidden="true"
        className={clsx(
          "absolute top-1/2 -z-10 -translate-y-1/2 opacity-45 transition-transform duration-700 ease-out motion-safe:group-hover:rotate-12",
          sealClassName ?? "-right-10 size-56",
        )}
      >
        <Seal fingerprint={fingerprint} state="ink" detail="mid" />
      </div>
      {/* Keeps whatever sits on the left readable over the seal's lines. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-r from-(--cover) via-(--cover)/75 to-(--cover)/10" />
      {children}
    </div>
  );
}

type CourseCardProps = {
  href: string;
  /** The course's map id: its seal is drawn from it. */
  fingerprint: string;
  title: string;
  subtitle: string;
  skillCount: number;
  /** How far this learner is. */
  progress: { proven: number; total: number };
  /** A short line on the cover: "Your copy" or "Private". */
  coverLabel: ReactNode;
};

/** "1 skill", "3 skills". */
const skillsLabel = (count: number) => `${count} ${count === 1 ? "skill" : "skills"}`;

/** One of your courses on the dashboard, as a card with a seal cover. */
export function CourseCard({ href, fingerprint, title, subtitle, skillCount, progress, coverLabel }: CourseCardProps) {
  const percent = progress.total > 0 ? Math.round((progress.proven / progress.total) * 100) : 0;
  return (
    <Link
      href={href}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-rule-strong bg-sheet shadow-sm transition duration-200 hover:border-control-edge hover:shadow-lg motion-safe:hover:-translate-y-0.5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <CourseCover fingerprint={fingerprint} tone="auto" className="flex h-24 items-end px-5 pb-3">
        <span className="rounded-full bg-sheet/80 px-2.5 py-0.5 text-xs font-semibold text-ink">{coverLabel}</span>
      </CourseCover>
      <div className="flex flex-1 flex-col gap-1 p-5">
        <h3 className="line-clamp-2 text-lg leading-snug font-semibold break-words">{title}</h3>
        <p className="truncate text-sm text-ink-soft">{subtitle}</p>
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold">
              {progress.proven} of {progress.total} proven
            </span>
            <span className="text-ink-soft tabular-nums">{percent}%</span>
          </div>
          <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-proven transition-[width] duration-500" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <div className="mt-auto flex items-center pt-4 text-sm text-ink-soft">
          <span className="inline-flex shrink-0 items-center gap-1">
            <span className="sr-only">, </span>
            <ListChecks aria-hidden="true" size={15} />
            {skillsLabel(skillCount)}
          </span>
        </div>
      </div>
    </Link>
  );
}

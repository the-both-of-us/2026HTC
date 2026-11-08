"use client";

import clsx from "clsx";
import { Heart, ListChecks } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Seal } from "@/shared/ui";
import { likesLabel, skillsLabel } from "./courseView";

/** Cover colours for cards: ink, teal and violet, each readable under on-ink text in every theme. */
const TONES = ["--color-ink", "--color-proven", "--color-read-example"] as const;

/** The same course always gets the same colour. */
function toneFor(fingerprint: string): string {
  let hash = 0;
  for (const char of fingerprint) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

/**
 * A course's cover: a band with the course's own seal, drawn from its id, so every course looks
 * different and always the same. On-ink lines only: foil is for proven things. `tone="auto"`
 * picks the band's colour from the id too (cards); the default is ink, for heroes with text.
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
  const cover = { "--cover": `var(${tone === "auto" ? toneFor(fingerprint) : "--color-ink"})` } as CSSProperties;
  return (
    <div className={clsx("relative isolate overflow-hidden bg-(--cover) text-on-ink", className)} style={cover}>
      <div
        aria-hidden="true"
        className={clsx(
          "absolute top-1/2 -z-10 -translate-y-1/2 opacity-90 transition-transform duration-700 ease-out motion-safe:group-hover:rotate-12",
          sealClassName ?? "-right-10 size-56",
        )}
      >
        <Seal fingerprint={fingerprint} state="on-ink" detail="mid" />
      </div>
      {/* Keeps whatever sits on the left readable over the seal's lines. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-linear-to-r from-(--cover) via-(--cover)/75 to-(--cover)/10" />
      {children}
    </div>
  );
}

export type CourseCardProps = {
  href: string;
  /** The course's map id: its seal is drawn from it. */
  fingerprint: string;
  title: string;
  subtitle?: string;
  authorName?: string;
  skillCount: number;
  likeCount?: number;
  /** On the dashboard: how far this learner is. */
  progress?: { proven: number; total: number };
  /** A short line on the cover, such as "Your copy" or "Public". */
  coverLabel?: ReactNode;
  headingLevel?: "h2" | "h3";
};

/** A course as a card with a seal cover. Used by the directory and the dashboard. */
export function CourseCard({
  href,
  fingerprint,
  title,
  subtitle,
  authorName,
  skillCount,
  likeCount,
  progress,
  coverLabel,
  headingLevel: Heading = "h2",
}: CourseCardProps) {
  const percent = progress && progress.total > 0 ? Math.round((progress.proven / progress.total) * 100) : 0;
  return (
    <Link
      href={href}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-rule-strong bg-sheet shadow-sm transition duration-200 hover:border-control-edge hover:shadow-lg motion-safe:hover:-translate-y-0.5 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <CourseCover fingerprint={fingerprint} tone="auto" className="flex h-24 items-end px-5 pb-3">
        {coverLabel && <span className="text-xs font-semibold tracking-wide text-on-ink-soft uppercase">{coverLabel}</span>}
      </CourseCover>
      <div className="flex flex-1 flex-col gap-1 p-5">
        <Heading className="line-clamp-2 text-lg leading-snug font-semibold break-words">{title}</Heading>
        {subtitle && <p className="truncate text-sm text-ink-soft">{subtitle}</p>}
        {progress && (
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
        )}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-4 text-sm text-ink-soft">
          {authorName && (
            <span className="min-w-0 truncate">
              <span className="sr-only">, </span>by {authorName}
            </span>
          )}
          <span className="flex shrink-0 items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="sr-only">, </span>
              <ListChecks aria-hidden="true" size={15} />
              {skillsLabel(skillCount)}
            </span>
            {likeCount !== undefined && (
              <span className="inline-flex items-center gap-1">
                <span className="sr-only">, </span>
                <Heart aria-hidden="true" size={15} />
                {likesLabel(likeCount)}
              </span>
            )}
          </span>
        </div>
      </div>
    </Link>
  );
}

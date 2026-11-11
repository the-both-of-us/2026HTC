"use client";

import { ArrowLeft, Unlock } from "lucide-react";
import Link from "next/link";
import type { ProgramDepth, ProgramLink } from "@/shared/types";
import { degreeProofsToUnlock, proofsToUnlock } from "../unlock";

/**
 * "Course 2 of 6 · Backend developer", linking back to the program, plus how close
 * the learner is to opening the next course. Shown in a course map's header.
 */
export function ProgramCrumb({
  program,
  proven,
  total,
  depth,
}: {
  program: ProgramLink;
  proven: number;
  total: number;
  /** A degree course opens the next at a quarter of its planned topics, not half. */
  depth?: ProgramDepth;
}) {
  const next = program.unlocks[0];
  const needed = (depth === "degree" ? degreeProofsToUnlock(total) : proofsToUnlock(total)) - proven;

  return (
    <p className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Link
        href={`/program/${program.id}`}
        className="inline-flex min-h-6 items-center gap-1 text-accent-bright underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" size={14} />
        Course {program.courseNumber} of {program.courseCount} · {program.title}
      </Link>
      {next && needed > 0 && (
        <span className="text-ink-soft tabular-nums">
          Prove {needed} more to open &ldquo;{next}&rdquo;
        </span>
      )}
      {next && needed <= 0 && (
        <Link
          href={`/program/${program.id}`}
          className="inline-flex items-center gap-1 font-medium text-proven underline-offset-4 hover:underline"
        >
          <Unlock aria-hidden="true" size={14} />
          &ldquo;{next}&rdquo; is open
        </Link>
      )}
    </p>
  );
}

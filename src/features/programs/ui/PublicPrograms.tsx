"use client";

import { GraduationCap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/shared/ui";
import type { PublicProgram } from "../types";
import { coursesLabel, fetchPublicPrograms, programHref } from "./sharingApi";

/**
 * The "Programs" shelf in the /courses directory: shared programs matching the page's search.
 * It shows nothing while loading, when nothing matches, or if loading fails, so the courses
 * below are never held up by it.
 */
export function PublicPrograms({ query }: { query: string }) {
  const [programs, setPrograms] = useState<PublicProgram[]>([]);

  useEffect(() => {
    let current = true;
    fetchPublicPrograms(query).then((result) => {
      if (current) setPrograms(result.ok ? result.programs : []);
    });
    return () => {
      current = false;
    };
  }, [query]);

  if (programs.length === 0) return null;
  return (
    <section aria-labelledby="public-programs" className="flex flex-col gap-3 border-b border-rule-strong pb-8">
      <div>
        <h2 id="public-programs" className="text-2xl font-medium">
          Programs
        </h2>
        <p className="mt-1 text-ink-soft">Several courses in order, toward a role or a wide goal.</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {programs.map((program) => (
          <li key={program.programId} className="min-w-0">
            <ProgramCard program={program} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProgramCard({ program }: { program: PublicProgram }) {
  return (
    <Link
      href={programHref(program.programId)}
      className="flex h-full flex-col gap-2 rounded-sheet border border-control-edge bg-sheet p-5 shadow-[4px_4px_0_0_var(--color-rule-strong)] transition-control hover:border-ink"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-xl leading-snug font-medium break-words">{program.title}</h3>
        {program.isSample && (
          <Badge tone="sample" className="shrink-0">
            Sample
          </Badge>
        )}
      </div>
      {program.summary && <p className="line-clamp-3 break-words text-ink-soft">{program.summary}</p>}
      <p className="text-sm break-words">
        <span className="sr-only">, </span>by {program.authorName}
      </p>
      <p className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm text-ink-soft">
        <span className="sr-only">, </span>
        <GraduationCap aria-hidden="true" size={16} />
        Program · {coursesLabel(program.courseCount)}
      </p>
    </Link>
  );
}

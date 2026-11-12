"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button } from "@/shared/ui";
import {
  countLabel,
  startSharedCourse,
  startSharedProgram,
  type SharedCourseItem,
  type SharedProgramItem,
  type SharedResult,
} from "./sharedApi";

const AI_NOTE = "Written by AI once and shared. Start gives you your own copy to prove skills on.";

/** The sections only; nothing at all when both lists are empty. */
export function SharedCatalogView({ courses, programs }: { courses: SharedCourseItem[]; programs: SharedProgramItem[] }) {
  if (courses.length === 0 && programs.length === 0) return null;
  return (
    <>
      {programs.length > 0 && (
        <section aria-labelledby="shared-programs" className="flex flex-col gap-3 border-b border-rule-strong pb-8 last:border-b-0 last:pb-0">
          <div>
            <h2 id="shared-programs" className="text-2xl font-medium">
              Shared programs
            </h2>
            <p className="mt-1 text-ink-soft">{AI_NOTE}</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {programs.map((program) => (
              <li key={program.programId} className="min-w-0">
                <SharedProgramCard program={program} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {courses.length > 0 && (
        <section aria-labelledby="shared-courses" className="flex flex-col gap-3 border-b border-rule-strong pb-8 last:border-b-0 last:pb-0">
          <div>
            <h2 id="shared-courses" className="text-2xl font-medium">
              Shared courses
            </h2>
            <p className="mt-1 text-ink-soft">{AI_NOTE}</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <li key={course.courseId} className="min-w-0">
                <SharedCourseCard course={course} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function CardShell({
  title,
  summary,
  audience,
  facts,
  pending,
  error,
  onStart,
}: {
  title: string;
  summary: string;
  audience: string;
  facts: string;
  pending: boolean;
  error: string | null;
  onStart: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-2 rounded-sheet border border-control-edge bg-sheet p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-xl leading-snug font-medium break-words">{title}</h3>
        <Badge className="shrink-0">AI-written</Badge>
      </div>
      {summary && <p className="line-clamp-3 break-words text-ink-soft">{summary}</p>}
      {audience && <p className="text-sm break-words text-ink-soft">For {audience}</p>}
      <p className="text-sm text-ink-soft">{facts}</p>
      <div className="mt-auto flex flex-col gap-2 pt-2">
        <Button size="sm" pending={pending} onClick={onStart} aria-label={`Start ${title}`} className="self-start">
          Start
        </Button>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function useStarter<T>(run: () => Promise<SharedResult<T>>, go: (value: T) => string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await run();
    if (result.ok) router.push(go(result));
    else {
      setError(result.message);
      setPending(false);
    }
  }
  return { pending, error, start };
}

function SharedCourseCard({ course }: { course: SharedCourseItem }) {
  const { pending, error, start } = useStarter(
    () => startSharedCourse(course.courseId),
    (value) => `/map/${encodeURIComponent(value.id)}`,
  );
  return (
    <CardShell
      title={course.title}
      summary={course.summary}
      audience={course.audience}
      facts={`${countLabel(course.units, "unit", "units")} · ${countLabel(course.topics, "topic", "topics")} planned`}
      pending={pending}
      error={error}
      onStart={start}
    />
  );
}

function SharedProgramCard({ program }: { program: SharedProgramItem }) {
  const { pending, error, start } = useStarter(
    () => startSharedProgram(program.programId),
    (value) => `/program/${encodeURIComponent(value.programId)}`,
  );
  return (
    <CardShell
      title={program.title}
      summary={program.summary}
      audience={program.audience}
      facts={`Full degree · ${countLabel(program.courseCount, "course", "courses")}`}
      pending={pending}
      error={error}
      onStart={start}
    />
  );
}

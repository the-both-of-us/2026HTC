"use client";

import { ArrowLeft, ArrowRight, GraduationCap, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, buttonClasses, ErrorNotice, PageShell } from "@/shared/ui";
import type { PublicCourseOutline, PublicProgramView } from "../types";
import { coursesLabel, programHref, startProgram } from "./sharingApi";

/**
 * A program someone shared, for anyone but its owner: the courses in order, with their
 * topics once the author built them, and "Start this program" for a private copy.
 */
export function PublicProgramScreen({ program }: { program: PublicProgramView }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await startProgram(program.id);
    if (result.ok) {
      router.push(programHref(result.programId));
      return;
    }
    setPending(false);
    setError(result.message);
  }

  return (
    <PageShell width="reading">
      <Link href="/courses" className={`${buttonClasses("quiet", "sm")} -ml-0.5 self-start`}>
        <ArrowLeft aria-hidden="true" size={16} />
        All courses and programs
      </Link>

      <header className="mt-6 flex flex-col gap-3">
        <p className="inline-flex items-center gap-1.5 self-start rounded-control border border-accent/45 bg-accent/10 px-2.5 py-1 text-sm text-accent-bright">
          <GraduationCap aria-hidden="true" size={15} />
          Program · {coursesLabel(program.courses.length)}
        </p>
        <h1 className="font-serif text-3xl font-medium tracking-tight break-words sm:text-4xl">{program.title}</h1>
        {program.summary && <p className="text-lg break-words text-ink-soft">{program.summary}</p>}
        <p className="inline-flex items-center gap-1.5 text-base text-ink-soft">
          <UserRound aria-hidden="true" size={16} />
          Shared by {program.authorName}
        </p>
        <div className="flex flex-wrap gap-2">
          {program.isSample && <Badge tone="sample">Planned from sample text, not a real listing</Badge>}
          <Badge tone="sample">AI-planned courses, with no citations</Badge>
        </div>
      </header>

      <section
        aria-label="Start"
        className="mt-6 flex flex-col gap-3 rounded-sheet border border-rule-strong bg-sheet p-5 sm:p-6"
      >
        {program.myCopyId ? (
          <Link href={programHref(program.myCopyId)} className={`${buttonClasses("primary", "lg")} self-start`}>
            Continue your program
            <ArrowRight aria-hidden="true" size={18} />
          </Link>
        ) : (
          <Button size="lg" className="self-start" pending={pending} onClick={start}>
            Start this program
            <ArrowRight aria-hidden="true" size={18} />
          </Button>
        )}
        <p className="text-sm text-ink-soft">
          {program.myCopyId
            ? "You started this program, so your copy and your progress are waiting."
            : "Starting gives you your own copy of the path, so you prove each topic yourself. Nothing of yours is shared."}
        </p>
        {error && <ErrorNotice message={error} onRetry={start} />}
      </section>

      <section aria-labelledby="program-courses" className="mt-10">
        <h2 id="program-courses" className="text-2xl font-medium">
          The courses, in order
        </h2>
        <p className="mt-1 text-ink-soft">Each course opens once you have proved half of the one before it.</p>
        <ol className="mt-5 flex flex-col">
          {program.courses.map((course, index) => (
            <OutlineStep key={course.slug} course={course} isLast={index === program.courses.length - 1} />
          ))}
        </ol>
      </section>
    </PageShell>
  );
}

function OutlineStep({ course, isLast }: { course: PublicCourseOutline; isLast: boolean }) {
  return (
    <li className="relative flex gap-4 pb-5">
      <div className="flex flex-col items-center">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-accent/60 text-sm font-semibold">
          {course.number}
        </span>
        {!isLast && <span aria-hidden="true" className="mt-1 w-0.5 flex-1 rounded-full bg-rule-strong" />}
      </div>
      <article className="min-w-0 flex-1 rounded-sheet border border-rule-strong bg-sheet/90 p-4 sm:p-5">
        <p className="text-sm text-ink-soft">Course {course.number}</p>
        <h3 className="mt-1 text-xl font-medium break-words">{course.title}</h3>
        {course.summary && <p className="mt-1 text-ink-soft">{course.summary}</p>}
        {course.topics ? (
          <ul aria-label={`Topics in ${course.title}`} className="mt-3 flex flex-wrap gap-1.5">
            {course.topics.map((topic, index) => (
              <li key={`${index}-${topic}`} className="rounded-control border border-rule-strong px-2 py-0.5 text-sm">
                {topic}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-soft">Its 6 to 10 topics are laid out when you start it.</p>
        )}
      </article>
    </li>
  );
}

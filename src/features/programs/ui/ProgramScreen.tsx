"use client";

import clsx from "clsx";
import { Award, Check, ChevronRight, GraduationCap, Lock, PartyPopper, Sparkles, Unlock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, buttonClasses, ErrorNotice, PageShell, Spinner } from "@/shared/ui";
import type { CourseView, ProgramSharing as Sharing, ProgramView } from "../types";
import { ProgramSharing } from "./ProgramSharing";

/** How often to ask again while someone else's click is building the same course. */
const POLL_MS = 3000;
/** Stop asking after this long, and offer a retry instead. */
const GIVE_UP_MS = 150_000;

/** A program as a path of courses: one card each, with the next one to do lit up. The owner can share it. */
export function ProgramScreen({ program, sharing }: { program: ProgramView; sharing?: Sharing }) {
  const proven = program.courses.reduce((sum, course) => sum + course.proven, 0);
  const badges = program.courses.filter((course) => course.badge).length;
  const upNext = program.courses.find((course) => course.state === "open") ?? null;

  return (
    <PageShell width="reading">
      <header className="flex flex-col gap-3">
        <p className="inline-flex items-center gap-1.5 self-start rounded-control border border-accent/45 bg-accent/10 px-2.5 py-1 text-sm text-accent-bright">
          <GraduationCap aria-hidden="true" size={15} />
          Program · {program.courses.length} courses
        </p>
        <h1 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">{program.title}</h1>
        {program.summary && <p className="text-lg text-ink-soft">{program.summary}</p>}
        <div className="flex flex-wrap gap-2">
          {program.isSample && <Badge tone="sample">Planned from sample text, not a real listing</Badge>}
          <Badge tone="sample">AI-planned courses, with no citations</Badge>
        </div>
        <ProgramStats proven={proven} badges={badges} courseCount={program.courses.length} />
        <Celebration program={program} />
        <NextGoal courses={program.courses} />
      </header>

      {sharing && (
        <div className="mt-6">
          <ProgramSharing programId={program.id} sharing={sharing} />
        </div>
      )}

      <ol className="mt-8 flex flex-col">
        {program.courses.map((course, index) => (
          <CourseStep
            key={course.slug}
            programId={program.id}
            course={course}
            isUpNext={course.slug === upNext?.slug}
            isLast={index === program.courses.length - 1}
          />
        ))}
      </ol>
    </PageShell>
  );
}

/** Topics proved across the program, and a badge for each course whose final interview was passed. */
function ProgramStats({ proven, badges, courseCount }: { proven: number; badges: number; courseCount: number }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-sheet border border-rule-strong bg-sheet/90 px-4 py-3">
      <p className="flex items-center gap-2 tabular-nums">
        <Check aria-hidden="true" size={18} className="text-proven" />
        <span>
          <strong className="font-semibold">{proven}</strong> {proven === 1 ? "topic" : "topics"} proved
        </span>
      </p>
      <p className="flex items-center gap-2 tabular-nums">
        <Award aria-hidden="true" size={18} className="text-amber" />
        <span>
          <strong className="font-semibold">{badges}</strong> of {courseCount} course badges
        </span>
      </p>
      {/* One medal per course: earned ones are filled, the rest wait. */}
      <div aria-hidden="true" className="flex gap-1.5">
        {Array.from({ length: courseCount }, (_, i) => (
          <span
            key={i}
            className={clsx(
              "size-3 rounded-full border",
              i < badges ? "border-amber bg-amber" : "border-rule-strong",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The closest reward: the locked course that needs the fewest proofs to open. One clear,
 * near goal is what keeps a long path moving.
 */
function NextGoal({ courses }: { courses: CourseView[] }) {
  if (courses.every((course) => course.badge)) {
    return (
      <p className="flex items-center gap-2 rounded-sheet border border-proven/60 bg-proven/8 px-4 py-3 font-medium">
        <PartyPopper aria-hidden="true" size={18} className="text-proven" />
        You finished every course in this program.
      </p>
    );
  }

  const goals = courses
    .filter((course) => course.state === "locked" && course.blockers.every((b) => b.needed !== null))
    .map((course) => ({ course, needed: course.blockers.reduce((sum, b) => sum + (b.needed ?? 0), 0) }))
    .sort((a, b) => a.needed - b.needed);
  const goal = goals[0];
  if (!goal) return null;

  return (
    <p className="flex items-start gap-2 rounded-sheet border border-accent/45 bg-accent/10 px-4 py-3">
      <Unlock aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-accent-bright" />
      <span>
        Next unlock: <strong className="font-semibold">{goal.course.title}</strong>. Prove{" "}
        <span className="tabular-nums">{goal.needed}</span> more {goal.needed === 1 ? "topic" : "topics"} in &ldquo;
        {goal.course.blockers[0].title}&rdquo; to open it.
      </span>
    </p>
  );
}

/**
 * Cheers what changed since this browser last looked: a course that opened, or a badge
 * earned. The last states seen live in localStorage, so the first visit stays quiet.
 */
function Celebration({ program }: { program: ProgramView }) {
  const [news, setNews] = useState<string[]>([]);

  useEffect(() => {
    const key = `program-seen/${program.id}`;
    // "badge" is one step past "done": every topic proved, then the final interview passed.
    const now = Object.fromEntries(program.courses.map((course) => [course.slug, course.badge ? "badge" : course.state]));
    try {
      const before = JSON.parse(localStorage.getItem(key) ?? "null") as Record<string, string> | null;
      localStorage.setItem(key, JSON.stringify(now));
      if (!before) return;
      const lines = program.courses.flatMap((course) => {
        const was = before[course.slug];
        if (was === "locked" && course.state !== "locked") return [`New course open: ${course.title}`];
        if (was && was !== "badge" && course.badge) return [`Badge earned: ${course.title}`];
        if (was && was !== "done" && was !== "badge" && course.state === "done") {
          return [`Every topic proved in ${course.title}. Its final interview is open.`];
        }
        return [];
      });
      // A moment after the page appears, so the cheer is noticed and the server render still matches.
      if (lines.length > 0) setTimeout(() => setNews(lines), 400);
    } catch {
      // Storage can be blocked, for example in a private window. Then there is just no cheer.
    }
  }, [program]);

  if (news.length === 0) return null;
  return (
    <div role="status" className="flex items-center gap-3 rounded-sheet border border-proven/60 bg-proven/10 px-4 py-3">
      <span className="animate-tick flex size-9 shrink-0 items-center justify-center rounded-full bg-proven text-on-proven">
        <Sparkles aria-hidden="true" size={18} />
      </span>
      <ul className="font-medium">
        {news.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function CourseStep({
  programId,
  course,
  isUpNext,
  isLast,
}: {
  programId: string;
  course: CourseView;
  isUpNext: boolean;
  isLast: boolean;
}) {
  return (
    <li className="relative flex gap-4 pb-5">
      {/* The path: a marker per course, joined by a line that turns green once a course is done. */}
      <div className="flex flex-col items-center">
        <StepMarker course={course} isUpNext={isUpNext} />
        {!isLast && (
          <span
            aria-hidden="true"
            className={clsx("mt-1 w-0.5 flex-1 rounded-full", course.state === "done" ? "bg-proven" : "bg-rule-strong")}
          />
        )}
      </div>

      <article
        className={clsx(
          "min-w-0 flex-1 rounded-sheet border p-4 sm:p-5",
          course.state === "locked" && "border-dashed border-locked/70 bg-locked-surface/60",
          course.state === "done" && "border-proven/60 bg-proven/8",
          course.state === "open" && "border-rule-strong bg-sheet/90",
          isUpNext && "border-ink border-2",
        )}
      >
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          Course {course.number}
          {isUpNext && <Badge tone="available">Up next</Badge>}
          {course.badge && <Badge tone="proven">Badge earned</Badge>}
          {course.state === "done" && !course.badge && <Badge tone="available">Final interview open</Badge>}
        </p>
        <h2 className="mt-1 text-xl font-medium">{course.title}</h2>
        {course.summary && <p className="mt-1 text-ink-soft">{course.summary}</p>}
        <div className="mt-4">
          <CourseAction programId={programId} course={course} />
        </div>
      </article>
    </li>
  );
}

function StepMarker({ course, isUpNext }: { course: CourseView; isUpNext: boolean }) {
  return (
    <span
      className={clsx(
        "flex size-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold",
        course.state === "done" && "border-proven bg-proven text-on-proven",
        course.state === "locked" && "border-dashed border-locked text-ink-soft",
        course.state === "open" && (isUpNext ? "border-accent bg-accent/20 text-accent-bright" : "border-accent/60 text-ink"),
      )}
    >
      {course.state === "done" ? (
        <Check aria-hidden="true" size={18} />
      ) : course.state === "locked" ? (
        <Lock aria-hidden="true" size={15} />
      ) : (
        course.number
      )}
      <span className="sr-only">
        {course.state === "done" ? "Done" : course.state === "locked" ? "Locked" : "Open"}
      </span>
    </span>
  );
}

/** The one thing to do on a course: continue it, start it, or see what opens it. */
function CourseAction({ programId, course }: { programId: string; course: CourseView }) {
  if (course.state === "locked") {
    const blocker = course.blockers[0];
    const almost = blocker?.needed !== null && blocker?.needed !== undefined && blocker.needed <= 2;
    return (
      <p className="flex items-start gap-2 text-ink-soft">
        <Lock aria-hidden="true" size={16} className="mt-1 shrink-0" />
        <span>
          {blocker?.needed
            ? `Prove ${blocker.needed} more ${blocker.needed === 1 ? "topic" : "topics"} in "${blocker.title}" to open this.`
            : `Start "${blocker?.title}" first to open this.`}
          {almost && <Badge tone="available" className="ml-2">Almost there</Badge>}
        </span>
      </p>
    );
  }

  if (course.mapId && course.total !== null) {
    const percent = (course.proven / course.total) * 100;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div aria-hidden="true" className="h-1.5 w-28 overflow-hidden rounded-full bg-rule-strong sm:w-40">
            <div className="progress-fill h-full rounded-full bg-proven" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-sm text-ink-soft tabular-nums">
            {course.proven} of {course.total} topics proved
          </p>
        </div>
        <Link
          href={`/map/${course.mapId}`}
          className={clsx(buttonClasses(course.badge ? "secondary" : "primary"), "grow sm:grow-0")}
        >
          {course.badge ? "Review course" : course.state === "done" ? "Take the final interview" : course.proven === 0 ? "Start course" : "Continue"}
          <ChevronRight aria-hidden="true" size={17} />
        </Link>
      </div>
    );
  }

  return <StartCourseButton programId={programId} slug={course.slug} />;
}

/**
 * Builds the course the first time it is opened, then goes to its map. If another
 * tab is already building it, the server says so and this asks again shortly.
 */
function StartCourseButton({ programId, slug }: { programId: string; slug: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  // Stop polling if the person leaves the page.
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);

  async function start() {
    setPending(true);
    setSeconds(0);
    setError(null);
    const startedAt = Date.now();
    try {
      while (!stopped.current) {
        const response = await fetch(`/api/programs/${programId}/courses/${slug}`, { method: "POST" });
        const body = await response.json().catch(() => null);
        if (response.ok && typeof body?.mapId === "string") {
          router.push(`/map/${body.mapId}`);
          return;
        }
        if (response.status !== 202) {
          setError(typeof body?.error === "string" ? body.error : "This course could not be built this time. Please try again.");
          break;
        }
        if (Date.now() - startedAt > GIVE_UP_MS) {
          setError("This course is taking too long to build. Please try again.");
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    } catch {
      setError("OryxLearn could not be reached. Check your connection, then try again.");
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">6 to 10 topics, built when you start.</p>
        <Button onClick={start} pending={pending} className="grow sm:grow-0">
          {!pending && <Sparkles aria-hidden="true" size={17} />}
          {pending ? "Building this course" : "Start course"}
        </Button>
      </div>
      {pending && (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-soft tabular-nums">
          <Spinner size={15} />
          Laying out this course&apos;s topics. {seconds} {seconds === 1 ? "second" : "seconds"} so far, usually under 15.
        </p>
      )}
      {error && <ErrorNotice message={error} onRetry={start} />}
    </div>
  );
}

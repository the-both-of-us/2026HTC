"use client";

import clsx from "clsx";
import { Award, Check, ChevronRight, GraduationCap, Lock, PartyPopper, Sparkles, Unlock } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, buttonClasses, PageShell } from "@/shared/ui";
import type { CourseView, ProgramSharing as Sharing, ProgramView } from "../types";
import { ComparePanel } from "./ComparePanel";
import { formatHours, groupByTerm, plural, termProgressLine, topicDenominator } from "./format";
import { needsProgramPoll, PROGRAM_POLL_MS } from "./planning";
import { PlanningNotice } from "./PlanningNotice";
import { usePoll } from "./poll";
import { ProgramSharing } from "./ProgramSharing";
import { StartCourseButton } from "./StartCourse";

/** After this many failed polls in a row the page stops asking and offers a reconnect. */
const MAX_POLL_FAILURES = 4;

/**
 * A program as a path of courses: one card each, with the next one to do lit up. The owner can share it.
 * While the course list is being planned (or a course is still being registered) the page asks
 * `GET /api/programs/[id]` every 1.5 s, one request at a time and never while the tab is hidden.
 */
export function ProgramScreen({ program: initial, sharing }: { program: ProgramView; sharing?: Sharing }) {
  const [program, setProgram] = useState(initial);
  // A fresh server render (router.refresh) replaces what polling has built up.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (seenInitial !== initial) {
    setSeenInitial(initial);
    setProgram(initial);
  }
  const [lost, setLost] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const failures = useRef(0);

  const poll = useCallback(
    async (signal: AbortSignal): Promise<boolean> => {
      try {
        const response = await fetch(`/api/programs/${encodeURIComponent(program.id)}`, { signal, cache: "no-store" });
        if (response.status === 404) return false;
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { program?: ProgramView };
        if (!body.program) throw new Error("empty");
        failures.current = 0;
        setProgram(body.program);
        return needsProgramPoll(body.program);
      } catch {
        if (signal.aborted) return false;
        failures.current += 1;
        if (failures.current >= MAX_POLL_FAILURES) {
          setLost(true);
          return false;
        }
        return true;
      }
    },
    [program.id],
  );
  usePoll(needsProgramPoll(program) && !lost, poll, PROGRAM_POLL_MS);

  async function retryPlanning() {
    setRetrying(true);
    setRetryError(null);
    try {
      const response = await fetch(`/api/programs/${encodeURIComponent(program.id)}/plan`, { method: "POST" });
      const body = (await response.json().catch(() => null)) as { status?: string; error?: string } | null;
      if (!response.ok) {
        setRetryError(typeof body?.error === "string" ? body.error : "Planning could not be restarted. Please try again.");
      } else {
        const state = body?.status === "ready" ? "ready" : "planning";
        setProgram((current) => ({ ...current, planning: { planned: 0, expected: null, ...current.planning, state } }));
      }
    } catch {
      setRetryError("OryxLearn could not be reached. Check your connection, then try again.");
    }
    setRetrying(false);
  }

  const planning = program.planning;
  const stillPlanning = planning !== undefined && planning.state !== "ready";
  const proven = program.courses.reduce((sum, course) => sum + course.proven, 0);
  const badges = program.courses.filter((course) => course.badge).length;
  const upNext = program.courses.find((course) => course.state === "open") ?? null;
  const isDegree = program.depth === "degree";
  const terms = isDegree && program.courses.some((course) => course.year) ? groupByTerm(program.courses) : null;
  const showCompare = isDegree;

  return (
    <PageShell width="reading">
      <header className="flex flex-col gap-3">
        <p className="inline-flex items-center gap-1.5 self-start rounded-control border border-accent/45 bg-accent/10 px-2.5 py-1 text-sm text-accent-bright">
          <GraduationCap aria-hidden="true" size={15} />
          {stillPlanning
            ? `Program · planning${isDegree ? " · Degree" : ""}`
            : `Program · ${program.courses.length} courses${isDegree ? " · Degree" : ""}`}
        </p>
        <h1 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">
          {program.title || (stillPlanning ? "Naming your program" : "Program")}
        </h1>
        {program.summary && <p className="text-lg text-ink-soft">{program.summary}</p>}
        <div className="flex flex-wrap gap-2">
          {program.isSample && <Badge tone="sample">Planned from sample text, not a real listing</Badge>}
          <Badge tone="sample">AI-planned courses, with no citations</Badge>
        </div>
        <PlanningNotice
          planning={planning}
          lost={lost}
          retrying={retrying}
          error={retryError}
          onRetryPlanning={() => void retryPlanning()}
          onReconnect={() => {
            failures.current = 0;
            setLost(false);
          }}
        />
        <ProgramStats proven={proven} badges={badges} courseCount={program.courses.length} />
        {program.hours && (
          <p className="text-sm text-ink-soft tabular-nums">
            Reading time: {formatHours(program.hours.planned)}, {formatHours(program.hours.written)}, {formatHours(program.hours.measured)}.
          </p>
        )}
        <Celebration program={program} />
        <NextGoal courses={program.courses} />
      </header>

      {sharing && (
        <div className="mt-6">
          <ProgramSharing programId={program.id} sharing={sharing} />
        </div>
      )}

      {terms ? (
        <div className="mt-8 flex flex-col gap-4">
          {terms.map((group, index) => (
            <TermSection
              key={group.key}
              programId={program.id}
              depth={program.depth}
              label={group.label}
              courses={group.courses}
              upNextSlug={upNext?.slug}
              // The term holding the next course is open, and so is the first one when nothing is.
              defaultOpen={group.courses.some((c) => c.slug === upNext?.slug) || (!upNext && index === 0)}
            />
          ))}
        </div>
      ) : (
        <ol className="mt-8 flex flex-col">
          {program.courses.map((course, index) => (
            <CourseStep
              key={course.slug}
              programId={program.id}
              depth={program.depth}
              course={course}
              isUpNext={course.slug === upNext?.slug}
              isLast={index === program.courses.length - 1}
            />
          ))}
        </ol>
      )}

      {showCompare && (
        <ComparePanel
          programId={program.id}
          courses={program.courses.filter((c) => c.mapId).map((c) => ({ slug: c.slug, title: c.title }))}
        />
      )}
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
  // An empty list (a program whose courses are still being planned) is not a finished program.
  if (courses.length === 0) return null;
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

/** One year-and-term of a degree: a collapsible section with a single progress line. */
function TermSection({
  programId,
  depth,
  label,
  courses,
  upNextSlug,
  defaultOpen,
}: {
  programId: string;
  depth: ProgramView["depth"];
  label: string;
  courses: CourseView[];
  upNextSlug: string | undefined;
  defaultOpen: boolean;
}) {
  const finished = courses.every((c) => c.badge);
  return (
    <details open={defaultOpen} className="group rounded-sheet border border-rule-strong">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 select-none">
        <span
          aria-hidden="true"
          className={clsx("size-3 shrink-0 rounded-full border", finished ? "border-proven bg-proven" : "border-rule-strong")}
        />
        <span className="font-medium">{label}</span>
        <span className="text-sm text-ink-soft tabular-nums">
          {plural(courses.length, "course")} · {termProgressLine(courses)}
        </span>
      </summary>
      <ol className="flex flex-col px-4 pt-2">
        {courses.map((course, index) => (
          <CourseStep
            key={course.slug}
            programId={programId}
            depth={depth}
            course={course}
            isUpNext={course.slug === upNextSlug}
            isLast={index === courses.length - 1}
          />
        ))}
      </ol>
    </details>
  );
}

function CourseStep({
  programId,
  depth,
  course,
  isUpNext,
  isLast,
}: {
  programId: string;
  depth: ProgramView["depth"];
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
        {(course.level || course.area) && (
          <p className="mt-1 text-sm text-ink-soft">{[course.level ? `Level ${course.level}` : null, course.area].filter(Boolean).join(" · ")}</p>
        )}
        <div className="mt-4">
          <CourseAction programId={programId} depth={depth} course={course} />
        </div>
        {course.units && course.units.length > 0 && <UnitProgress units={course.units} final={course.final} />}
        {(course.hasSyllabus || course.units) && (
          <p className="mt-3 text-sm">
            <Link href={`/program/${programId}/courses/${course.slug}`} className="text-accent-bright underline-offset-4 hover:underline">
              Read the syllabus
            </Link>
          </p>
        )}
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
function CourseAction({ programId, depth, course }: { programId: string; depth: ProgramView["depth"]; course: CourseView }) {
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

  // A degree course builds a unit at a time, so progress counts against the topics the syllabus plans.
  const total = topicDenominator(course);
  if (course.mapId && total !== null) {
    const percent = total > 0 ? (course.proven / total) * 100 : 0;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div aria-hidden="true" className="h-1.5 w-28 overflow-hidden rounded-full bg-rule-strong sm:w-40">
            <div className="progress-fill h-full rounded-full bg-proven" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-sm text-ink-soft tabular-nums">
            {course.proven} of {total} topics proved
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

  return <StartCourseButton programId={programId} course={course} depth={depth} />;
}

/** Per-unit progress of a degree course, with its unit tests and the course final. */
function UnitProgress({ units, final }: { units: NonNullable<CourseView["units"]>; final: CourseView["final"] }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm text-ink-soft select-none">
        Units: {units.filter((u) => u.state === "done").length} of {units.length} done
      </summary>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {units.map((unit) => (
          <li key={unit.id} className="flex flex-wrap justify-between gap-x-3 tabular-nums">
            <span className={unit.state === "locked" ? "text-ink-soft" : undefined}>
              {unit.number}. {unit.title}
            </span>
            <span className="text-ink-soft">
              {unit.proved} of {unit.plannedTopics}
              {unit.test ? `, test ${unit.test}` : ""}
              {!unit.built && unit.state !== "locked" ? ", not built yet" : ""}
              {unit.state === "locked" ? ", locked" : ""}
            </span>
          </li>
        ))}
      </ul>
      {final && <p className="mt-1 text-sm text-ink-soft">Course final: {final}</p>}
    </details>
  );
}

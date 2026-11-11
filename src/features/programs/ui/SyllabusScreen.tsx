"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge, buttonClasses, ErrorNotice, PageShell, Spinner, pollLoop } from "@/shared/ui";
import type { SyllabusTopicView, SyllabusUnitView, SyllabusView } from "../types";
import { formatHours, plural } from "./format";

/** How often the page asks again while the syllabus is being written. */
const SYLLABUS_POLL_MS = 1500;

/**
 * The syllabus view, plus the planning flag the route sets while the canonical syllabus is still
 * being written (the units list then holds just the units committed so far).
 */
export type LiveSyllabusView = SyllabusView & { planning?: boolean };

/** Poll while the route says planning, or while a started course has no syllabus at all yet. */
export const syllabusIsPlanning = (view: LiveSyllabusView): boolean =>
  view.planning === true || (view.status === "none" && view.course.mapId !== null);

const comma = (items: string[]) => items.join(", ");

function TopicEntry({ topic, index }: { topic: SyllabusTopicView; index: number }) {
  return (
    <li className="border-t border-rule py-3 first:border-t-0">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        <span className="tabular-nums">{index + 1}.</span> {topic.title}
        {topic.proved ? <Badge tone="proven">Proved</Badge> : topic.built ? <Badge tone="available">Built</Badge> : null}
      </p>
      {topic.objectives.length > 0 && (
        <>
          <p className="mt-1 text-sm font-medium">After this topic you can</p>
          <ul className="list-disc pl-5 text-ink-soft">
            {topic.objectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>
        </>
      )}
      {topic.keyTerms.length > 0 && (
        <p className="mt-1 text-sm text-ink-soft">
          <span className="font-medium text-ink">Key terms:</span> {comma(topic.keyTerms)}
        </p>
      )}
      {(topic.inScope || topic.outOfScope) && (
        <p className="mt-1 text-sm text-ink-soft">
          {topic.inScope && (
            <>
              <span className="font-medium text-ink">Covers:</span> {topic.inScope}{" "}
            </>
          )}
          {topic.outOfScope && (
            <>
              <span className="font-medium text-ink">Leaves for elsewhere:</span> {topic.outOfScope}
            </>
          )}
        </p>
      )}
      {topic.buildsOn.length > 0 && (
        <p className="mt-1 text-sm text-ink-soft">
          <span className="font-medium text-ink">Builds on:</span>{" "}
          {comma(topic.buildsOn.map((b) => (b.courseTitle ? `${b.title} (${b.courseTitle})` : b.title)))}
        </p>
      )}
    </li>
  );
}

function UnitEntry({ unit }: { unit: SyllabusUnitView }) {
  return (
    <section aria-labelledby={`unit-${unit.id}`} className="mt-6">
      <h3 id={`unit-${unit.id}`} className="flex flex-wrap items-center gap-2 text-lg font-medium">
        Unit {unit.number}. {unit.title}
        {unit.state === "done" && <Badge tone="proven">Done</Badge>}
        {!unit.built && <Badge tone="sample">Not built yet</Badge>}
      </h3>
      <p className="text-sm text-ink-soft tabular-nums">
        {plural(unit.plannedTopics, "topic")} planned · {unit.proved} proved
        {unit.test ? ` · unit test ${unit.test === "passed" ? "passed" : unit.test === "open" ? "open" : "locked"}` : ""}
      </p>
      {unit.outcomes.length > 0 && <p className="mt-1 text-sm text-ink-soft">Serves outcomes: {comma(unit.outcomes)}</p>}
      <ol className="mt-2">
        {unit.topics.map((topic, index) => (
          <TopicEntry key={topic.id} topic={topic} index={index} />
        ))}
      </ol>
    </section>
  );
}

/** The syllabus as a plain printed calendar page: outcomes, units with their topics, then assessment. */
export function SyllabusDocument({ view }: { view: LiveSyllabusView }) {
  const { course } = view;
  const planning = syllabusIsPlanning(view);
  const meta = [
    course.year && course.term ? `Year ${course.year}, term ${course.term}` : null,
    course.level ? `Level ${course.level}` : null,
    course.area ?? null,
  ].filter(Boolean);

  return (
    <article>
      <Link href={`/program/${view.programId}`} className="inline-flex min-h-6 items-center gap-1 text-sm text-accent-bright underline-offset-4 hover:underline">
        <ArrowLeft aria-hidden="true" size={14} />
        {view.programTitle}
      </Link>
      <p className="mt-3 text-sm text-ink-soft">Course {course.number}{meta.length > 0 ? ` · ${meta.join(" · ")}` : ""}</p>
      <h1 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">{course.title}</h1>
      {course.summary && <p className="mt-2 text-lg text-ink-soft">{course.summary}</p>}
      {course.requires.length > 0 && (
        <p className="mt-2 text-sm">
          <span className="font-medium">Requires:</span> {comma(course.requires.map((r) => r.title))}
        </p>
      )}

      {planning && (
        <p role="status" className="mt-6 flex items-start gap-2.5 rounded-sheet border border-rule-strong bg-sheet/90 px-4 py-3">
          <Spinner size={16} className="mt-1 shrink-0" />
          <span>
            The syllabus is being written. Units appear here as they are planned
            {view.units.length > 0 ? ` (${plural(view.units.length, "unit")} so far).` : "."}
          </span>
        </p>
      )}

      {view.status === "none" && view.units.length === 0 ? (
        !planning && (
          <p className="mt-6 rounded-sheet border border-dashed border-locked/70 bg-locked-surface/60 px-4 py-3">
            This course has no syllabus yet. It is written when you start the course, and then it appears here.
          </p>
        )
      ) : (
        <>
          {view.status === "draft" && !planning && (
            <p className="mt-4 text-sm text-ink-soft">This is the written plan. Unit 1 is built when you start the course.</p>
          )}
          <section aria-labelledby="outcomes" className="mt-6">
            <h2 id="outcomes" className="text-xl font-medium">
              Course outcomes
            </h2>
            <ol className="mt-2 list-decimal pl-5">
              {view.outcomes.map((outcome) => (
                <li key={outcome.id}>{outcome.text}</li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="units" className="mt-8">
            <h2 id="units" className="text-xl font-medium">
              Units and topics
            </h2>
            {view.units.map((unit) => (
              <UnitEntry key={unit.id} unit={unit} />
            ))}
          </section>

          <section aria-labelledby="assessment" className="mt-8">
            <h2 id="assessment" className="text-xl font-medium">
              Assessment
            </h2>
            <ul className="mt-2 list-disc pl-5">
              <li>Each topic is proved by teaching it back in your own words.</li>
              {view.assessment.unitTests && (
                <li>
                  A unit test after each unit: {view.assessment.unitTestQuestions} questions, pass mark {view.assessment.unitTestPassMark}.
                </li>
              )}
              <li>
                Course final: {view.assessment.finalQuestions} questions, pass mark {view.assessment.finalPassMark}
                {view.assessment.final === "passed" ? " (passed)" : view.assessment.final === "open" ? " (open now)" : ""}.
              </li>
            </ul>
            <p className="mt-3 text-sm text-ink-soft">
              Reading time: {formatHours(view.hours.planned)}, {formatHours(view.hours.written)}, {formatHours(view.hours.measured)}.
            </p>
          </section>
        </>
      )}

      {course.mapId && (
        <Link href={`/map/${course.mapId}`} className={`${buttonClasses("primary")} mt-8`}>
          Open the course map
        </Link>
      )}
    </article>
  );
}

/** Loads the syllabus from its route, then shows it. */
export function SyllabusScreen({ programId, slug, initial = null }: { programId: string; slug: string; initial?: LiveSyllabusView | null }) {
  const [view, setView] = useState<LiveSyllabusView | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initial === null);

  const [attempt, setAttempt] = useState(0);

  const retry = () => {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  };

  useEffect(() => {
    if (initial !== null && attempt === 0) return;
    let live = true;
    (async () => {
      try {
        const response = await fetch(`/api/programs/${programId}/courses/${slug}/syllabus`);
        if (!live) return;
        if (response.status === 404) {
          setError("This syllabus is not here. The program may be private or deleted, or the link may be incomplete.");
        } else if (!response.ok) {
          throw new Error();
        } else {
          setView((await response.json()) as LiveSyllabusView);
        }
      } catch {
        if (live) setError("The syllabus could not be loaded. Please try again.");
      }
      if (live) setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [initial, attempt, programId, slug]);

  // While the syllabus is being written, ask again: one request at a time, paused when the tab is hidden.
  const planning = view !== null && syllabusIsPlanning(view);
  const failures = useRef(0);
  useEffect(() => {
    if (!planning) return;
    const abort = new AbortController();
    const startedAt = Date.now();
    void pollLoop(
      async (signal) => {
        // A syllabus that is still not there after 4 minutes will not arrive by itself.
        if (Date.now() - startedAt > 240_000) return false;
        try {
          const response = await fetch(`/api/programs/${programId}/courses/${slug}/syllabus`, { signal, cache: "no-store" });
          if (!response.ok) throw new Error(String(response.status));
          const next = (await response.json()) as LiveSyllabusView;
          failures.current = 0;
          setView(next);
          return syllabusIsPlanning(next);
        } catch {
          if (signal.aborted) return false;
          failures.current += 1;
          return failures.current < 4;
        }
      },
      SYLLABUS_POLL_MS,
      abort.signal,
    );
    return () => abort.abort();
  }, [planning, programId, slug]);

  return (
    <PageShell width="reading">
      {loading && (
        <p role="status" className="flex items-center gap-2.5 text-ink-soft">
          <Spinner size={16} />
          Loading the syllabus.
        </p>
      )}
      {error && <ErrorNotice message={error} onRetry={retry} />}
      {view && <SyllabusDocument view={view} />}
    </PageShell>
  );
}

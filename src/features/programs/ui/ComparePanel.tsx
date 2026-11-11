"use client";

import { ExternalLink, Scale } from "lucide-react";
import { useState } from "react";
import { Button, ErrorNotice, Spinner } from "@/shared/ui";
import { NOT_EQUIVALENT, type ComparisonView, type HoursBreakdown, type PracticeCounts, type SourcedNorm } from "../types";
import { formatHours, plural } from "./format";

/** The "Not equivalent" box. Always rendered with the comparison, whatever has or has not loaded. */
export function NotEquivalentBox() {
  return (
    <aside aria-label="Not equivalent" className="rounded-sheet border-2 border-ink bg-sheet p-4">
      <h3 className="font-semibold">Not equivalent to a university degree</h3>
      <ul className="mt-2 list-disc pl-5 text-ink-soft">
        {NOT_EQUIVALENT.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </aside>
  );
}

const range = (n: { value: number; valueMax?: number }) => (n.valueMax !== undefined ? `${n.value} to ${n.valueMax}` : `${n.value}`);

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b border-rule py-1.5 last:border-b-0">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function HoursRows({ hours }: { hours: HoursBreakdown }) {
  return (
    <>
      <Row label="Reading time, planned" value={formatHours(hours.planned)} />
      <Row label="Reading time, written so far" value={formatHours(hours.written)} />
      <Row label="Time you measurably spent" value={formatHours(hours.measured)} />
    </>
  );
}

function PracticeRows({ practice }: { practice: PracticeCounts }) {
  return (
    <>
      <Row label="Teach-backs" value={String(practice.teachBacks)} />
      <Row label="Quiz questions" value={String(practice.quizQuestions)} />
      {practice.practiceCases > 0 && <Row label="Practice cases" value={String(practice.practiceCases)} />}
      {practice.unitTestQuestions > 0 && <Row label="Unit test questions" value={String(practice.unitTestQuestions)} />}
      <Row label="Final questions" value={String(practice.finalQuestions)} />
    </>
  );
}

function NormItem({ norm }: { norm: SourcedNorm }) {
  return (
    <li className="border-b border-rule py-2 last:border-b-0">
      <p className="flex flex-wrap justify-between gap-x-4">
        <span>{norm.label}</span>
        <span className="font-medium tabular-nums">
          {range(norm)} {norm.unit}
        </span>
      </p>
      {norm.derived && <p className="text-sm text-ink-soft">Worked out as: {norm.derived}</p>}
      <p className="text-sm text-ink-soft">
        <a href={norm.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-bright underline-offset-4 hover:underline">
          {norm.source}
          <ExternalLink aria-hidden="true" size={13} />
        </a>
        , read on {norm.retrievedOn}
      </p>
    </li>
  );
}

/** Our computed numbers beside sourced university norms. No match score. */
export function ComparisonBody({ view }: { view: ComparisonView }) {
  const { ours, course, norms } = view;
  const topicCount = (t: { planned: number | null; built: number; proved: number }) =>
    `${t.planned !== null ? `${t.planned} planned, ` : ""}${t.built} built, ${t.proved} proved`;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 md:grid-cols-2">
        <section aria-labelledby="cmp-ours">
          <h3 id="cmp-ours" className="font-semibold">
            Ours, computed from this program
          </h3>
          <dl className="mt-2">
            <Row label="Courses" value={`${ours.courses} planned, ${ours.coursesBuilt} started`} />
            <Row label="Units" value={ours.units.planned !== null ? `${ours.units.planned} planned, ${ours.units.built} built` : `${ours.units.built} built`} />
            <Row label="Topics" value={topicCount(ours.topics)} />
            <HoursRows hours={ours.hours} />
            <PracticeRows practice={ours.practice} />
          </dl>
        </section>
        <section aria-labelledby="cmp-norms">
          <h3 id="cmp-norms" className="font-semibold">
            University norms, from published sources
          </h3>
          {norms.length === 0 ? (
            <p className="mt-2 text-ink-soft">No sourced norms are available.</p>
          ) : (
            <ul className="mt-2">
              {norms.map((norm) => (
                <NormItem key={norm.id} norm={norm} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {course && (
        <section aria-labelledby="cmp-course">
          <h3 id="cmp-course" className="font-semibold">
            One course on its own: {course.title}
          </h3>
          <div className="mt-2 grid gap-5 md:grid-cols-2">
            <div>
              <dl>
                <Row label="Topics" value={topicCount(course.topics)} />
                <HoursRows hours={course.hours} />
                <PracticeRows practice={course.practice} />
              </dl>
              <p className="mt-3 text-sm font-medium">Our {course.unitTitles.length > 0 ? plural(course.unitTitles.length, "unit title") : "unit titles"}</p>
              <ol className="list-decimal pl-5 text-ink-soft">
                {course.unitTitles.map((title) => (
                  <li key={title}>{title}</li>
                ))}
              </ol>
            </div>
            <div>
              {course.reference ? (
                <>
                  <p className="text-sm font-medium">
                    <a href={course.reference.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-bright underline-offset-4 hover:underline">
                      {course.reference.title}
                      <ExternalLink aria-hidden="true" size={13} />
                    </a>{" "}
                    <span className="font-normal text-ink-soft">(read on {course.reference.retrievedOn})</span>
                  </p>
                  <ol className="list-decimal pl-5 text-ink-soft">
                    {course.reference.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="text-ink-soft">We know no published outline for this subject to set beside it.</p>
              )}
            </div>
          </div>
        </section>
      )}

      <p className="text-sm text-ink-soft">
        Reading time is planned topics times the lesson length at 200 words a minute, so it is far below a university course&apos;s contact and study hours. The
        gap is shown as it is.
      </p>
    </div>
  );
}

/**
 * The Compare panel. The comparison is fetched when it is opened, so the program page costs
 * nothing extra. The "Not equivalent" box is part of the panel and shown before, during and after.
 */
export function ComparePanel({
  programId,
  courses = [],
  initial = null,
}: {
  programId: string;
  /** Started courses, to pick which one is compared on its own. */
  courses?: { slug: string; title: string }[];
  initial?: ComparisonView | null;
}) {
  const [open, setOpen] = useState(initial !== null);
  const [view, setView] = useState<ComparisonView | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(slug?: string) {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/programs/${programId}/comparison${slug ? `?course=${encodeURIComponent(slug)}` : ""}`);
      const body = await response.json().catch(() => null);
      if (!response.ok || !body) throw new Error();
      setView(body as ComparisonView);
    } catch {
      setError("The comparison could not be loaded. Please try again.");
    }
    setLoading(false);
  }

  return (
    <section aria-labelledby="compare-heading" className="mt-10 flex flex-col gap-4 border-t border-rule-strong pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="compare-heading" className="flex items-center gap-2 text-xl font-medium">
          <Scale aria-hidden="true" size={20} />
          Compare with a university degree
        </h2>
        {!open && <Button variant="secondary" onClick={() => load()}>Show the comparison</Button>}
      </div>
      {open && courses.length > 1 && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Course to compare on its own
          <select
            className="min-h-9 border border-rule-strong bg-sheet px-2"
            defaultValue={view?.course?.slug ?? courses[0].slug}
            onChange={(event) => load(event.target.value)}
          >
            {courses.map((course) => (
              <option key={course.slug} value={course.slug}>
                {course.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {loading && (
        <p role="status" className="flex items-center gap-2 text-ink-soft">
          <Spinner size={15} />
          Working out the numbers.
        </p>
      )}
      {error && <ErrorNotice message={error} onRetry={() => load()} />}
      {view && !loading && <ComparisonBody view={view} />}
      <NotEquivalentBox />
    </section>
  );
}

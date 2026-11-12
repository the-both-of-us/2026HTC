"use client";

import clsx from "clsx";
import { Check, Minus, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { Button, ErrorNotice, Spinner } from "@/shared/ui";
import type { PretestResultView, PretestReviewView, PretestUnitView, PretestView } from "../types";

/*
 * The pre-test's presentational pieces: the offer, one unit of questions, the results of a unit,
 * the waiting note and the end screen. They hold no requests, so they render the same on the server
 * (tests) and in the browser. None of them ever receives an answer key: the API sends none.
 */

/** Moves focus to the heading when a screen appears, so a screen reader starts at its title. */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: false });
  }, []);
  return ref;
}

const HEADING = "text-xl font-semibold outline-none sm:text-2xl";

/* ------------------------------------------------------------------ the offer */

/** "Already know some of this?" Shown on a course's first open. "Not now" hides it. */
export function PretestOffer({
  onStart,
  onDismiss,
  pending = false,
  error,
}: {
  onStart: () => void;
  onDismiss: () => void;
  pending?: boolean;
  error?: string | null;
}) {
  return (
    <section
      aria-labelledby="pretest-offer-title"
      className="flex flex-col gap-3 border-b border-rule bg-raised/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6"
    >
      <div className="min-w-0">
        <h2 id="pretest-offer-title" className="font-semibold">
          Already know some of this?
        </h2>
        <p className="text-sm text-ink-soft">
          Take the pre-test and skip what you know. One multiple-choice question per topic, a unit at a time. You can stop
          whenever you like.
        </p>
        {error && (
          <p role="alert" className="mt-1 text-sm font-semibold text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button size="sm" onClick={onStart} disabled={pending}>
          Take the pre-test
        </Button>
        <Button size="sm" variant="quiet" onClick={onDismiss} disabled={pending}>
          Not now
        </Button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ intro */

/** The page before the first question: what the pre-test is, and what it does not change. */
export function PretestIntro({
  resumed,
  onStart,
  onClose,
  pending,
}: {
  resumed: boolean;
  onStart: () => void;
  onClose: () => void;
  pending: boolean;
}) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div className="flex flex-col gap-4">
      <h2 ref={heading} tabIndex={-1} className={HEADING}>
        {resumed ? "Continue the pre-test" : "Skip what you already know"}
      </h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink-soft">
        <li>One multiple-choice question per topic, one unit at a time. Pick one answer for each.</li>
        <li>Answer from memory. If you do not know, choose &ldquo;I don&rsquo;t know this&rdquo;; nothing is held against you.</li>
        <li>A topic you get right is marked &ldquo;Known (pre-test)&rdquo;. Its lesson stays open to read, and you can still explain it later.</li>
        <li>A guess can be right by chance, so unit tests and the final test still count. A pre-test alone never finishes the course.</li>
        <li>You can take it once per course, and stop at any time.</li>
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onStart} disabled={pending}>
          {pending ? "Starting…" : resumed ? "Continue" : "Start the pre-test"}
        </Button>
        <Button variant="quiet" onClick={onClose} disabled={pending}>
          Not now
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ a unit of questions */

/** What the learner picked for a question: an option index, or "dont-know". Absent until they choose. */
export type QuestionDraft = number | "dont-know";
export type UnitDrafts = Record<string, QuestionDraft>;

/** True when the learner has chosen anything on this unit yet. */
export function hasAnyAnswer(drafts: UnitDrafts): boolean {
  return Object.keys(drafts).length > 0;
}

/** The choice to send for a draft: the option index, or null for "I don't know this" and for no choice. */
export function choiceOf(draft: QuestionDraft | undefined): number | null {
  return typeof draft === "number" ? draft : null;
}

const CHOICE_BOX = "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5";

/** One radio choice with a label that is the whole tap target. */
function Choice({
  name,
  id,
  value,
  checked,
  disabled,
  onSelect,
  children,
}: {
  name: string;
  id: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className={clsx(CHOICE_BOX, checked ? "border-ink bg-raised" : "border-rule", disabled && "cursor-default opacity-70")}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-0.5 size-5 shrink-0 accent-[var(--color-ink)]"
      />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

/**
 * One unit: every question is a radio group of options plus a separate "I don't know this"; "Stop
 * here" is always in view. A question left alone counts as "I don't know this".
 */
export function UnitQuestions({
  unit,
  unitsTotal,
  drafts,
  onChange,
  onSubmit,
  onStop,
  pending,
  error,
}: {
  unit: PretestUnitView;
  unitsTotal: number;
  drafts: UnitDrafts;
  onChange: (topicId: string, draft: QuestionDraft) => void;
  onSubmit: () => void;
  onStop: () => void;
  pending: "answers" | "stop" | null;
  error: string | null;
}) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const baseId = useId();
  const busy = pending !== null;

  return (
    <form
      aria-labelledby={`${baseId}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSubmit();
      }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-ink-soft tabular-nums">
          Unit {unit.number}
          {unitsTotal > 0 && <> of {unitsTotal}</>}
        </p>
        <h2 id={`${baseId}-title`} ref={heading} tabIndex={-1} className={HEADING}>
          {unit.title}
        </h2>
        <p className="text-ink-soft">
          Pick one answer for each question, from memory. Do not look anything up: this only decides what you can skip.
        </p>
      </div>

      <ol className="flex flex-col gap-6">
        {unit.questions.map((question, index) => {
          const draft = drafts[question.topicId];
          const id = `${baseId}-q${index}`;
          return (
            <li key={question.topicId} className="border-t border-rule pt-4">
              <fieldset className="flex min-w-0 flex-col gap-2" disabled={busy}>
                <legend className="mb-2 flex flex-col gap-1.5">
                  <span className="text-sm text-ink-soft">
                    Topic {index + 1} of {unit.questions.length}: {question.topicTitle}
                  </span>
                  <span className="text-base font-semibold">{question.question}</span>
                </legend>
                {question.options.map((option, optionIndex) => (
                  <Choice
                    key={optionIndex}
                    id={`${id}-o${optionIndex}`}
                    name={id}
                    value={String(optionIndex)}
                    checked={draft === optionIndex}
                    disabled={busy}
                    onSelect={() => onChange(question.topicId, optionIndex)}
                  >
                    {option}
                  </Choice>
                ))}
                <Choice
                  id={`${id}-dk`}
                  name={id}
                  value="dont-know"
                  checked={draft === "dont-know"}
                  disabled={busy}
                  onSelect={() => onChange(question.topicId, "dont-know")}
                >
                  <span className="text-ink-soft">I don&rsquo;t know this</span>
                </Choice>
              </fieldset>
            </li>
          );
        })}
      </ol>

      {error && <ErrorNotice message={error} />}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-rule bg-paper px-4 py-3 sm:-mx-6 sm:px-6">
        <Button type="submit" disabled={busy}>
          {pending === "answers" ? (
            <>
              <Spinner size={16} />
              Checking…
            </>
          ) : (
            "Check my answers"
          )}
        </Button>
        <Button type="button" variant="subtle" onClick={onStop} disabled={busy}>
          {pending === "stop" ? "Stopping…" : "Stop here"}
        </Button>
        <p className="text-sm text-ink-soft">
          Stopping grades what you answered on this unit, then ends the pre-test.
        </p>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ results of a unit */

const OUTCOME_TEXT: Record<PretestResultView["outcome"], string> = {
  known: "Known (pre-test)",
  missed: "Not yet. The lesson will teach it.",
  skipped: "Skipped (I don’t know this)",
};

/**
 * Per-question results for the unit just graded (the unit is submitted, so the key is shown): the
 * question, the learner's choice, the correct option and the explanation. A result from before
 * multiple choice has no review and shows the outcome only.
 */
export function UnitResults({
  unitNumber,
  unitTitle,
  results,
  last,
  onContinue,
}: {
  unitNumber: number;
  unitTitle: string;
  results: PretestResultView[];
  /** The test ends after this screen, so the button leads to the summary. */
  last: boolean;
  onContinue: () => void;
}) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const known = results.filter((result) => result.outcome === "known").length;
  return (
    <div className="flex flex-col gap-4">
      <h2 ref={heading} tabIndex={-1} className={HEADING}>
        Unit {unitNumber} results
      </h2>
      <p className="text-ink-soft">
        {unitTitle}: {known} of {results.length} {results.length === 1 ? "topic" : "topics"} known.
      </p>
      <ul className="flex flex-col divide-y divide-rule border-y border-rule">
        {results.map((result) => (
          <li key={result.topicId} className="flex items-start gap-3 py-3">
            <OutcomeIcon outcome={result.outcome} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{result.topicTitle}</span>
              <span className="block text-sm text-ink-soft">{OUTCOME_TEXT[result.outcome]}</span>
              {result.review && <ReviewDetail review={result.review} />}
            </span>
          </li>
        ))}
      </ul>
      <div>
        <Button onClick={onContinue}>{last ? "See the summary" : "Next unit"}</Button>
      </div>
    </div>
  );
}

function ReviewDetail({ review }: { review: PretestReviewView }) {
  const right = review.chosen === review.correctIndex;
  return (
    <span className="mt-2 flex flex-col gap-1 text-sm">
      <span className="text-ink-soft">{review.question}</span>
      <span>
        <span className="font-semibold">Your answer: </span>
        {review.chosen === null ? "I don’t know this" : review.options[review.chosen]}
      </span>
      {!right && (
        <span>
          <span className="font-semibold">Correct answer: </span>
          {review.options[review.correctIndex]}
        </span>
      )}
      <span className="text-ink-soft">{review.explanation}</span>
    </span>
  );
}

function OutcomeIcon({ outcome }: { outcome: PretestResultView["outcome"] }) {
  const Icon = outcome === "known" ? Check : outcome === "missed" ? X : Minus;
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px]",
        outcome === "known" ? "border-ink bg-ink text-on-ink" : "border-rule-strong text-ink-soft",
      )}
    >
      <Icon size={14} />
    </span>
  );
}

/* ------------------------------------------------------------------ waiting */

/** Questions are being written, or answers are being checked. A polite status, never a bare spinner. */
export function PretestWaiting({
  what,
  unitNumber,
  slow = false,
  stalled = false,
  onAskAgain,
}: {
  what: "writing" | "starting";
  unitNumber?: number;
  slow?: boolean;
  stalled?: boolean;
  onAskAgain?: () => void;
}) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const unit = unitNumber ? `Unit ${unitNumber}` : "the next unit";
  return (
    <div className="flex flex-col items-start gap-3">
      <h2 ref={heading} tabIndex={-1} className={HEADING}>
        {what === "starting" ? "Getting ready" : `Writing the questions for ${unit}`}
      </h2>
      {stalled ? (
        <ErrorNotice
          message="The questions could not be written this time. Nothing is lost."
          onRetry={onAskAgain}
          retryLabel="Try again"
        />
      ) : (
        <>
          <p className="flex items-center gap-2.5 text-ink-soft">
            <Spinner size={18} className="shrink-0" />
            {slow ? "This is taking longer than usual. You can keep waiting." : "This takes a few seconds."}
          </p>
          {slow && onAskAgain && (
            <Button variant="subtle" onClick={onAskAgain}>
              Check again
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the end */

const END_TEXT = {
  completed: "You answered a question for every unit.",
  stopped: "You stopped here.",
  "unit-missed": "Nothing was right in a unit, so the pre-test ended there. Later units build on it.",
} as const;

/** Which topics are now known and what to do next. `nextStep` is the map's own next-step view. */
export function PretestEnd({
  view,
  nextStep,
  onClose,
}: {
  view: PretestView;
  nextStep: ReactNode;
  onClose: () => void;
}) {
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const known = view.results.filter((result) => result.outcome === "known");
  const asked = view.results.length;
  return (
    <div className="flex flex-col gap-4">
      <h2 ref={heading} tabIndex={-1} className={HEADING}>
        {view.ended?.reason === "stopped" ? "Pre-test stopped" : "Pre-test finished"}
      </h2>
      <p className="text-ink-soft">
        {view.ended ? END_TEXT[view.ended.reason] : ""} {known.length} of {asked} {asked === 1 ? "topic" : "topics"} asked{" "}
        {known.length === 1 ? "is" : "are"} now known.
      </p>
      {known.length > 0 ? (
        <section aria-labelledby="pretest-known-title" className="flex flex-col gap-2">
          <h3 id="pretest-known-title" className="font-semibold">
            Known from the pre-test
          </h3>
          <ul className="flex flex-col divide-y divide-rule border-y border-rule">
            {known.map((result) => (
              <li key={result.topicId} className="flex items-center gap-3 py-2.5">
                <OutcomeIcon outcome="known" />
                <span className="min-w-0 flex-1">{result.topicTitle}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p>No topic was marked known, so you start from the beginning. Nothing is lost.</p>
      )}
      <p className="text-sm text-ink-soft">
        These topics count as done, and their lessons stay open. Their unit tests and the final test are still ahead, and you can
        explain a topic later to replace its pre-test mark.
      </p>
      <div className="flex flex-col items-start gap-3">
        <h3 className="font-semibold">What to do next</h3>
        {nextStep}
        <Button variant="quiet" onClick={onClose}>
          Back to the map
        </Button>
      </div>
    </div>
  );
}

"use client";

import clsx from "clsx";
import { Check, Lock, Trophy, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Button, ErrorNotice } from "@/shared/ui";
import type { FinalQuestionView, FinalReviewItem, FinalView } from "../final";
import { testScoreLabel } from "../testLabel";
import { fetchFinal, startFinal, submitFinal } from "./api";
import "./challenges.css";

type FinalTestProps = {
  mapId: string;
  provenCount: number;
  topicCount: number;
  /** Set for a degree unit's test instead of the course final. */
  unitId?: string;
  unitTitle?: string;
};

/**
 * The course's final test, or a degree unit's test when `unitId` is given. Locked until every
 * topic is proven, then multiple choice: one answer per question, the whole test submitted at
 * once and graded by code. Afterwards each question shows the learner's choice, the correct
 * option and why. A fail can be retaken with new questions.
 */
export function FinalTest({ mapId, provenCount, topicCount, unitId, unitTitle }: FinalTestProps) {
  const allProven = topicCount > 0 && provenCount === topicCount;
  const isUnit = unitId !== undefined;
  const name = isUnit ? "Unit test" : "Final test";
  const [view, setView] = useState<FinalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [loadCount, setLoadCount] = useState(0);

  useEffect(() => {
    let current = true;
    fetchFinal(mapId, unitId).then((result) => {
      if (!current) return;
      if (result.ok) setView(result.data);
      else setError(result.message);
    });
    return () => {
      current = false;
    };
  }, [mapId, unitId, allProven, loadCount]);

  async function start() {
    setPending(true);
    setError(null);
    const result = await startFinal(mapId, unitId);
    setPending(false);
    setJustSubmitted(false);
    if (result.ok) setView(result.data);
    else setError(result.message);
  }

  async function submit(testId: string, answers: number[]) {
    setPending(true);
    setError(null);
    const result = await submitFinal(mapId, unitId, testId, answers);
    setPending(false);
    if (!result.ok) return setError(result.message);
    forgetDraft(testId);
    setJustSubmitted(true);
    setView(result.data);
  }

  if (!view) {
    return error ? (
      <Strip label={name}>
        <ErrorNotice
          message={error}
          onRetry={() => {
            setError(null);
            setLoadCount((count) => count + 1);
          }}
        />
      </Strip>
    ) : null;
  }

  const { questionCount, passMark } = view;
  const score = view.result ? testScoreLabel(view.result, questionCount) : "";

  if (view.state === "locked") {
    return (
      <Strip label={name}>
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Lock aria-hidden="true" size={15} className="shrink-0" />
          {allProven && !isUnit ? (
            <span>
              <span className="font-medium text-ink">Final test</span> unlocks once every unit test is passed.
            </span>
          ) : (
            <span>
              <span className="font-medium text-ink">{name}</span> unlocks when every topic{isUnit ? " in this unit" : ""} is proven.{" "}
              <span className="tabular-nums">{topicCount - provenCount} to go.</span>
            </span>
          )}
        </p>
      </Strip>
    );
  }

  if (view.state === "passed" && isUnit) {
    return (
      <Strip label={name}>
        <p role="status" className="flex items-center gap-2 text-sm text-ink-soft">
          <Check aria-hidden="true" size={15} className="shrink-0 text-proven" />
          <span>
            <span className="font-medium text-ink">Unit test passed{unitTitle ? `: ${unitTitle}` : ""}</span>, {score}.
          </span>
        </p>
        {view.review && <Review items={view.review} open={justSubmitted} />}
      </Strip>
    );
  }

  if (view.state === "passed") {
    return (
      <Strip tone="gold" label={name}>
        <div className="relative flex items-center gap-3">
          <span
            className={clsx(
              "relative flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-amber bg-amber/15 text-amber",
              justSubmitted && "badge-rise",
            )}
          >
            <Trophy aria-hidden="true" size={22} />
            {justSubmitted && <Burst />}
          </span>
          <div role="status">
            <p className="font-semibold">{justSubmitted ? "Course badge earned!" : "Course badge"}</p>
            <p className="text-sm text-ink-soft">
              Passed the final test, {score}. It&apos;s on your evidence page.
            </p>
          </div>
        </div>
        {view.review && <Review items={view.review} open={justSubmitted} />}
      </Strip>
    );
  }

  if (view.state === "ready" || view.state === "failed") {
    const reward = isUnit ? "to pass the unit" : "for the course badge";
    return (
      <Strip tone="gold" label={name}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Trophy aria-hidden="true" size={22} className="mt-0.5 shrink-0 text-amber" />
            <div role={view.state === "failed" ? "status" : undefined}>
              <p className="font-semibold">
                {view.state === "failed"
                  ? `${name}: ${score}. You need ${passMark} right to pass.`
                  : isUnit
                    ? `The test for ${unitTitle ? `"${unitTitle}"` : "this unit"} is open.`
                    : "The final test is open."}
              </p>
              <p className="text-sm text-ink-soft">
                {view.state === "failed"
                  ? "A retake has new questions."
                  : `${questionCount} multiple-choice questions on your topics. Pick one answer for each, then submit. Get ${passMark} right ${reward}.`}
              </p>
            </div>
          </div>
          <Button pending={pending} onClick={start} className="shrink-0">
            {view.state === "failed" ? "Retake with new questions" : isUnit ? "Start the unit test" : "Start the final test"}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm font-semibold text-danger">{error}</p>}
        {view.review && <Review items={view.review} open={justSubmitted} />}
      </Strip>
    );
  }

  if (view.format !== "multiple-choice" || !view.testId) return null;
  return (
    <Strip tone="gold" label={name}>
      <TestForm
        key={view.testId}
        name={name}
        testId={view.testId}
        questions={view.questions}
        passMark={passMark}
        pending={pending}
        error={error}
        onSubmit={submit}
      />
    </Strip>
  );
}

type TestFormProps = {
  name: string;
  testId: string;
  questions: FinalQuestionView[];
  passMark: number;
  pending: boolean;
  error: string | null;
  onSubmit: (testId: string, answers: number[]) => void;
};

/** Every question as a radio group, and one submit for the whole test. Choices survive a reload. */
function TestForm({ name, testId, questions, passMark, pending, error, onSubmit }: TestFormProps) {
  const [chosen, setChosen] = useState<(number | null)[]>(() => readDraft(testId, questions.length));
  const answered = chosen.filter((choice) => choice !== null).length;
  const complete = answered === questions.length;

  function choose(index: number, option: number) {
    const next = chosen.map((choice, at) => (at === index ? option : choice));
    setChosen(next);
    saveDraft(testId, next);
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (complete && !pending) onSubmit(testId, chosen as number[]);
      }}
    >
      <div>
        <p className="font-semibold">
          {name}: {questions.length} questions, multiple choice
        </p>
        <p className="text-sm text-ink-soft">
          Pick one answer for each question, then submit the whole test. {passMark} right passes. You can submit it once.
        </p>
      </div>
      <ol className="flex flex-col gap-5">
        {questions.map((question, index) => (
          <li key={index}>
            <QuestionField
              number={index + 1}
              question={question}
              chosen={chosen[index]}
              disabled={pending}
              onChoose={(option) => choose(index, option)}
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" pending={pending} disabled={!complete}>
          Submit the test
        </Button>
        <p className="text-sm text-ink-soft tabular-nums" aria-live="polite">
          {answered} of {questions.length} answered
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

function QuestionField({
  number,
  question,
  chosen,
  disabled,
  onChoose,
}: {
  number: number;
  question: FinalQuestionView;
  chosen: number | null;
  disabled: boolean;
  onChoose: (option: number) => void;
}) {
  const group = useId();
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-2">
      <legend className="mb-2 font-medium">
        <span className="tabular-nums">{number}.</span> {question.question}
      </legend>
      {question.options.map((option, index) => (
        <label
          key={index}
          className={clsx(
            "flex min-h-11 cursor-pointer items-start gap-3 rounded-control border px-3 py-2.5",
            "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
            chosen === index ? "border-ink bg-raised" : "border-rule-strong bg-paper hover:border-ink-soft",
          )}
        >
          <input
            type="radio"
            name={group}
            value={index}
            checked={chosen === index}
            onChange={() => onChoose(index)}
            className="mt-0.5 size-5 shrink-0 accent-ink focus-visible:outline-none"
          />
          <span>{option}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** After submitting: each question with the learner's choice, the correct option and why. */
function Review({ items, open }: { items: FinalReviewItem[]; open: boolean }) {
  return (
    <details open={open} className="mt-3">
      <summary className="cursor-pointer text-sm font-medium select-none">Review your answers</summary>
      <ol className="mt-3 flex flex-col gap-4">
        {items.map((item, index) => {
          const right = item.chosen === item.correctIndex;
          return (
            <li key={index} className="text-sm">
              <p className="flex items-start gap-2 font-medium">
                {right ? (
                  <Check aria-label="Right" size={16} className="mt-0.5 shrink-0 text-proven" />
                ) : (
                  <X aria-label="Wrong" size={16} className="mt-0.5 shrink-0 text-danger" />
                )}
                <span>
                  <span className="tabular-nums">{index + 1}.</span> {item.question}
                </span>
              </p>
              <div className="mt-1 flex flex-col gap-0.5 pl-6 text-ink-soft">
                <p>
                  Your answer: <span className="text-ink">{item.chosen === null ? "none" : item.options[item.chosen]}</span>
                </p>
                {!right && (
                  <p>
                    Correct answer: <span className="text-ink">{item.options[item.correctIndex]}</span>
                  </p>
                )}
                <p>{item.explanation}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function draftKey(testId: string) {
  return `final-test/${testId}`;
}

/** The choices made so far on this set, so a reload loses nothing. Empty when storage is unavailable. */
function readDraft(testId: string, count: number): (number | null)[] {
  const empty = Array.from({ length: count }, () => null);
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(draftKey(testId)) ?? "null");
    if (!Array.isArray(saved) || saved.length !== count) return empty;
    return saved.map((choice) => (typeof choice === "number" && Number.isInteger(choice) ? choice : null));
  } catch {
    return empty;
  }
}

function saveDraft(testId: string, chosen: (number | null)[]) {
  try {
    sessionStorage.setItem(draftKey(testId), JSON.stringify(chosen));
  } catch {
    // Storage is a convenience only.
  }
}

function forgetDraft(testId: string) {
  try {
    sessionStorage.removeItem(draftKey(testId));
  } catch {
    // Storage is a convenience only.
  }
}

function Strip({ children, tone, label }: { children: ReactNode; tone?: "gold"; label: string }) {
  return (
    <section
      aria-label={label}
      className={clsx("border-b px-4 py-3 sm:px-6", tone === "gold" ? "border-amber/40 bg-amber/5" : "border-rule")}
    >
      {children}
    </section>
  );
}

const BURST_COLOURS = ["var(--color-amber)", "var(--color-proven)", "var(--color-accent-bright)"];

/** Fourteen bits of colour that fly out from the badge, once. */
function Burst() {
  return (
    <span aria-hidden="true">
      {Array.from({ length: 14 }, (_, index) => {
        const angle = (index / 14) * Math.PI * 2;
        const distance = 46 + (index % 3) * 14;
        const style = {
          "--burst-x": `${Math.cos(angle) * distance}px`,
          "--burst-y": `${Math.sin(angle) * distance}px`,
          background: BURST_COLOURS[index % BURST_COLOURS.length],
          animationDelay: `${(index % 4) * 40}ms`,
        } as CSSProperties;
        return <span key={index} className="burst-bit" style={style} />;
      })}
    </span>
  );
}

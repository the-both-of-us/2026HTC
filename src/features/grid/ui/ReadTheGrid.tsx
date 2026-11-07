"use client";

import clsx from "clsx";
import { Check, CircleDashed, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/shared/ui";
import {
  answerText,
  buildExercises,
  checkChoice,
  checkNumber,
  type CheckResult,
  type Exercise,
} from "../exercises";
import type { GridSnapshot } from "../types";

type Attempt = {
  typed: string;
  chosen: string | null;
  result: CheckResult | null;
  /** The working is on screen. */
  revealed: boolean;
  /** Got it right without looking at the working first. */
  earned: boolean;
};

const NEW_ATTEMPT: Attempt = { typed: "", chosen: null, result: null, revealed: false, earned: false };

function Feedback({ result }: { result: CheckResult | null }) {
  if (!result) return null;
  if (result.outcome === "correct") {
    return (
      <p className="flex items-center gap-2 font-semibold">
        <Check size={18} className="text-proven" aria-hidden="true" />
        Correct, checked against the live figure.
      </p>
    );
  }
  if (result.outcome === "unreadable") {
    return <p>Type a number, such as 12.5.</p>;
  }
  const way = "direction" in result && result.direction ? ` Your answer is too ${result.direction}.` : "";
  return (
    <p className="flex items-start gap-2 font-semibold">
      {result.outcome === "close" ? (
        <TriangleAlert size={18} className="mt-0.5 shrink-0 text-contour" aria-hidden="true" />
      ) : (
        <X size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
      )}
      {result.outcome === "close" ? "Nearly." : "Not quite."}
      {way} Try again, or show the working.
    </p>
  );
}

/** Practice on real numbers: each question is built from one AESO reading, and code checks it. */
export function ReadTheGrid({ snapshot }: { snapshot: GridSnapshot }) {
  // The numbers are pinned while someone works, so an answer can't shift under them.
  const [pinned, setPinned] = useState(snapshot);
  const exercises = useMemo(() => buildExercises(pinned), [pinned]);
  const [activeId, setActiveId] = useState(exercises[0]?.id ?? "");
  const [attempts, setAttempts] = useState<Record<string, Attempt>>({});

  const activeIndex = Math.max(0, exercises.findIndex((item) => item.id === activeId));
  const exercise = exercises[activeIndex];
  if (!exercise) return null;

  const attempt = attempts[exercise.id] ?? NEW_ATTEMPT;
  const solved = exercises.filter((item) => attempts[item.id]?.earned).length;
  const newer = snapshot.asOf !== pinned.asOf;

  const update = (change: Partial<Attempt>) =>
    setAttempts((current) => ({
      ...current,
      [exercise.id]: { ...(current[exercise.id] ?? NEW_ATTEMPT), ...change },
    }));

  const record = (result: CheckResult, extra: Partial<Attempt> = {}) => {
    const correct = result.outcome === "correct";
    update({
      ...extra,
      result,
      revealed: attempt.revealed || correct,
      earned: attempt.earned || (correct && !attempt.revealed),
    });
  };

  const submitNumber = (event: FormEvent) => {
    event.preventDefault();
    if (exercise.kind === "number") record(checkNumber(exercise, attempt.typed));
  };

  const useNewest = () => {
    setPinned(snapshot);
    setAttempts({});
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-ink-soft">
        <p>
          Every question uses AESO&apos;s figures from <strong className="font-semibold text-ink">{pinned.asOfLabel}</strong>.
          Code builds and checks them, not an AI.
        </p>
        <p className="font-semibold text-ink" aria-live="polite">
          {solved} of {exercises.length} solved
        </p>
      </div>

      {newer && (
        <div className="flex flex-col items-start gap-2 rounded-control border border-control-edge px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            AESO has newer figures, from {snapshot.asOfLabel}. Your questions hold still until you switch.
          </p>
          <Button variant="subtle" size="sm" className="shrink-0" onClick={useNewest}>
            <RefreshCw size={16} aria-hidden="true" />
            Use the newest numbers
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <ol className="flex flex-wrap gap-1 lg:flex-col">
          {exercises.map((item, index) => {
            const itemAttempt = attempts[item.id];
            const current = item.id === exercise.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  onClick={() => setActiveId(item.id)}
                  className={clsx(
                    "flex min-h-11 w-full items-center gap-2.5 rounded-control border px-3 text-left text-sm font-medium transition-control",
                    current ? "border-forest bg-highlight text-ink" : "border-transparent text-ink-soft hover:bg-rule hover:text-ink",
                  )}
                >
                  {itemAttempt?.earned ? (
                    <Check size={16} className="text-proven" aria-hidden="true" />
                  ) : (
                    <CircleDashed size={16} aria-hidden="true" />
                  )}
                  <span>
                    <span className="sr-only">{`Question ${index + 1}: `}</span>
                    {item.title}
                    {itemAttempt?.earned && <span className="sr-only"> (solved)</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="flex min-w-0 flex-col gap-4">
          <h3 className="text-xl font-bold">{exercise.prompt}</h3>

          <dl className="grid gap-2 sm:grid-cols-2">
            {exercise.figures.map((figure) => (
              <div key={figure.label} className="rounded-control border border-rule px-3 py-2">
                <dt className="text-sm text-ink-soft">{figure.label}</dt>
                <dd className="font-semibold tabular-nums">{figure.value}</dd>
              </div>
            ))}
          </dl>

          <AnswerControl
            exercise={exercise}
            attempt={attempt}
            onSubmitNumber={submitNumber}
            onType={(typed) => update({ typed })}
            onChoose={(choice) => {
              if (exercise.kind === "choice") record(checkChoice(exercise, choice), { chosen: choice });
            }}
          />

          <div role="status" className="text-base">
            <Feedback result={attempt.result} />
          </div>

          {attempt.revealed ? (
            <Working exercise={exercise} />
          ) : (
            <div>
              <Button variant="quiet" size="sm" className="px-0!" onClick={() => update({ revealed: true })}>
                Show the working
              </Button>
            </div>
          )}

          {attempt.revealed && activeIndex < exercises.length - 1 && (
            <div>
              <Button onClick={() => setActiveId(exercises[activeIndex + 1].id)}>Next question</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type AnswerControlProps = {
  exercise: Exercise;
  attempt: Attempt;
  onSubmitNumber: (event: FormEvent) => void;
  onType: (typed: string) => void;
  onChoose: (choice: string) => void;
};

function AnswerControl({ exercise, attempt, onSubmitNumber, onType, onChoose }: AnswerControlProps) {
  if (exercise.kind === "choice") {
    return (
      <div className="flex flex-wrap gap-2" role="group" aria-label="Your answer">
        {exercise.choices.map((choice) => (
          <Button
            key={choice}
            variant="subtle"
            aria-pressed={attempt.chosen === choice}
            onClick={() => onChoose(choice)}
          >
            {choice}
          </Button>
        ))}
      </div>
    );
  }

  const inputId = `grid-answer-${exercise.id}`;
  return (
    <form onSubmit={onSubmitNumber} className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-semibold">
          Your answer, in {exercise.unit === "%" ? "percent" : "MW"}
        </label>
        <div className="flex items-center gap-2">
          <input
            key={inputId}
            id={inputId}
            // A phone's decimal keypad has no minus sign, and the reserve margin can be negative.
            inputMode={exercise.id === "reserve-margin" ? "text" : "decimal"}
            autoComplete="off"
            value={attempt.typed}
            onChange={(event) => onType(event.target.value)}
            className="min-h-11 w-36 rounded-control border-2 border-control-edge bg-sheet px-3 text-base text-ink tabular-nums"
          />
          <span aria-hidden="true" className="text-ink-soft">{exercise.unit}</span>
        </div>
      </div>
      <Button type="submit">Check</Button>
    </form>
  );
}

function Working({ exercise }: { exercise: Exercise }) {
  return (
    <div className="flex flex-col gap-3 rounded-control border border-control-edge p-4">
      <p className="font-semibold">Answer: {answerText(exercise)}</p>
      <ol className="flex flex-col gap-1 text-sm tabular-nums">
        {exercise.working.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <p className="text-sm">
        <strong className="font-semibold">Why a {exercise.role.toLowerCase()} cares: </strong>
        <span className="text-ink-soft">{exercise.why}</span>
      </p>
      {exercise.caveat && <p className="text-sm text-ink-soft">{exercise.caveat}</p>}
    </div>
  );
}

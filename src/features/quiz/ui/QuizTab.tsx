"use client";

import clsx from "clsx";
import { Check, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Citation, QuizQuestion, SkillNode } from "@/shared/types";
import { Button, ErrorNotice, Spinner } from "@/shared/ui";
import { createQuiz, fetchSavedQuiz } from "./api";
import {
  answeredNow,
  choose,
  currentChoice,
  currentQuestionIndex,
  focusAfterPanelChange,
  isPanelSettled,
  keyAction,
  listNumbers,
  next,
  restartRun,
  score,
  startRun,
  type QuizRun,
} from "./quizState";

export type QuizTabProps = {
  mapId: string;
  skill: SkillNode;
};

type Status =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "generating" }
  | { kind: "ready"; questions: QuizQuestion[]; focusOnStart: boolean }
  | { kind: "error"; message: string; retry: "load" | "make" };

/** Rendered inside the skill panel on the map. Switching skills starts it afresh. */
export function QuizTab(props: QuizTabProps) {
  return <Quiz key={`${props.mapId}/${props.skill.id}`} {...props} />;
}

function Quiz({ mapId, skill }: QuizTabProps) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [loadCount, setLoadCount] = useState(0);
  // True from a button press until the panel settles. Each control the press removes hands focus to its replacement.
  const learnerActed = useRef(false);
  const loadingLine = useRef<HTMLParagraphElement>(null);
  const makeArea = useRef<HTMLDivElement>(null);
  const errorArea = useRef<HTMLDivElement>(null);

  // Only the cheap read happens on its own. Making a quiz costs a model call, so it waits for a click.
  useEffect(() => {
    let current = true;
    fetchSavedQuiz(mapId, skill.id).then((result) => {
      if (!current) return;
      if (!result.ok) setStatus({ kind: "error", message: result.message, retry: "load" });
      // After "Try again" on a load error, the first question takes focus from the removed button.
      else if (result.items?.length) setStatus({ kind: "ready", questions: result.items, focusOnStart: learnerActed.current });
      else setStatus({ kind: "none" });
    });
    return () => {
      current = false;
    };
  }, [mapId, skill.id, loadCount]);

  useEffect(() => {
    if (!learnerActed.current) return;
    if (isPanelSettled(status.kind)) learnerActed.current = false;
    const target = focusAfterPanelChange(status.kind);
    if (target === "status") loadingLine.current?.focus();
    if (target === "make") makeArea.current?.querySelector("button")?.focus();
    if (target === "retry") errorArea.current?.querySelector("button")?.focus();
    // "quiz": QuizRunner focuses its first question itself.
  }, [status]);

  async function makeQuiz() {
    learnerActed.current = true;
    setStatus({ kind: "generating" });
    const result = await createQuiz(mapId, skill.id);
    if (result.ok && result.items?.length) setStatus({ kind: "ready", questions: result.items, focusOnStart: true });
    else setStatus({ kind: "error", message: result.ok ? "The quiz came back empty. Please try again." : result.message, retry: "make" });
  }

  function retry() {
    if (status.kind !== "error") return;
    if (status.retry === "make") {
      void makeQuiz();
    } else {
      learnerActed.current = true;
      setStatus({ kind: "loading" });
      setLoadCount((count) => count + 1);
    }
  }

  return (
    <section className="border-t border-rule pt-5">
      <h3 className="mb-1 text-base font-semibold">Quiz</h3>

      {status.kind === "loading" && (
        <p
          ref={loadingLine}
          tabIndex={-1}
          role="status"
          className="flex items-center gap-2.5 text-sm text-ink-soft outline-none"
        >
          <Spinner size={16} className="shrink-0" />
          Looking for a saved quiz.
        </p>
      )}

      {(status.kind === "none" || status.kind === "generating") && (
        <div ref={makeArea} className="flex flex-col items-start gap-3">
          <p className="text-ink-soft">
            Check what you know about {skill.title} with a short multiple-choice quiz. Every answer is explained.
          </p>
          <Button variant="secondary" pending={status.kind === "generating"} onClick={makeQuiz}>
            {status.kind === "generating" ? "Making your quiz" : "Make a quiz"}
          </Button>
          <p role="status" className="text-sm text-ink-soft">
            {status.kind === "generating" && "Writing the questions. This takes a few seconds."}
          </p>
        </div>
      )}

      {status.kind === "error" && (
        <div ref={errorArea}>
          <ErrorNotice message={status.message} onRetry={retry} className="mt-2" />
        </div>
      )}

      {status.kind === "ready" && (
        <QuizRunner questions={status.questions} skillTitle={skill.title} focusOnStart={status.focusOnStart} />
      )}
    </section>
  );
}

type FocusTarget = "question" | "next" | "results" | null;

/** One question at a time, then the score. Keys work only while focus is inside the quiz. */
function QuizRunner({
  questions,
  skillTitle,
  focusOnStart,
}: {
  questions: QuizQuestion[];
  skillTitle: string;
  focusOnStart: boolean;
}) {
  const [run, setRun] = useState<QuizRun>(() => startRun(questions.length));
  const questionHeading = useRef<HTMLParagraphElement>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const nextArea = useRef<HTMLDivElement>(null);
  const focusNext = useRef<FocusTarget>(focusOnStart ? "question" : null);

  // Move focus only after something the learner did, once the new content is on screen.
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "question") questionHeading.current?.focus();
    if (target === "next") nextArea.current?.querySelector("button")?.focus();
    if (target === "results") resultsHeading.current?.focus();
  }, [run]);

  const question = questions[currentQuestionIndex(run)];
  const choice = currentChoice(run);
  const answered = choice !== null;
  const isLast = run.position === run.order.length - 1;

  // After an answer, focus moves to "Next question", beside the feedback. Enter on the option
  // just pressed would otherwise do nothing, since answered options ignore clicks.
  function pick(optionIndex: number) {
    const after = choose(run, questions, optionIndex);
    if (!answeredNow(run, after)) return;
    focusNext.current = "next";
    setRun(after);
  }

  function goNext() {
    focusNext.current = isLast ? "results" : "question";
    setRun((state) => next(state));
  }

  function tryAgain() {
    focusNext.current = "question";
    setRun((state) => restartRun(state));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const action = keyAction(
      {
        key: event.key,
        targetTag: target.tagName,
        targetIsEditable: target.isContentEditable,
        hasModifier: event.ctrlKey || event.metaKey || event.altKey,
      },
      run,
      question?.options.length ?? 0,
    );
    if (!action) return;
    event.preventDefault();
    if (action.type === "choose") pick(action.optionIndex);
    else goNext();
  }

  if (run.finished) {
    const result = score(run, questions);
    return (
      <div className="flex flex-col items-start gap-3">
        <h4 ref={resultsHeading} tabIndex={-1} className="font-display text-xl outline-none">
          You got {result.correct} of {result.total}.
        </h4>
        {result.missed.length === 0 ? (
          <p>Every answer was right.</p>
        ) : (
          <>
            <p>
              You missed question{result.missed.length > 1 ? "s" : ""} {listNumbers(result.missed)}.
            </p>
            <ul className="flex flex-col gap-2">
              {result.missed.map((number) => {
                const missed = questions[run.order[number - 1]];
                return (
                  <li key={missed.id} className="border-l-2 border-rule pl-3">
                    <p className="font-semibold">
                      Question {number}: {missed.prompt}
                    </p>
                    <p className="text-ink-soft">Answer: {missed.options[missed.answerIndex]}</p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <Button variant="secondary" onClick={tryAgain}>
          Try again
        </Button>
        <p className="text-sm text-ink-soft">Try again asks the same questions in a new order.</p>
      </div>
    );
  }

  if (!question) return null;
  const promptId = `quiz-prompt-${question.id}`;

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={`Quiz on ${skillTitle}. Press 1 to ${question.options.length} to choose an answer, then Enter for the next question.`}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-4 rounded-control"
    >
      <p className="text-sm text-ink-soft">
        Question {run.position + 1} of {run.order.length}
        <span aria-hidden="true"> · keys 1 to {question.options.length} answer</span>
      </p>

      <p
        id={promptId}
        ref={questionHeading}
        tabIndex={-1}
        className="font-display text-lg leading-7 outline-none"
      >
        <span className="sr-only">
          Question {run.position + 1} of {run.order.length}:{" "}
        </span>
        {question.prompt}
      </p>

      <div role="group" aria-labelledby={promptId} className="flex flex-col gap-2">
        {question.options.map((option, index) => (
          <OptionButton
            key={index}
            number={index + 1}
            text={option}
            answered={answered}
            chosen={choice === index}
            correct={question.answerIndex === index}
            onPick={() => pick(index)}
          />
        ))}
      </div>

      <div aria-live="polite" className="flex flex-col gap-2">
        {answered && <Feedback question={question} choice={choice} />}
      </div>

      {answered && (
        <div ref={nextArea} className="self-start">
          <Button variant="primary" onClick={goNext}>
            {isLast ? "See your score" : "Next question"}
          </Button>
        </div>
      )}
    </div>
  );
}

function OptionButton({
  number,
  text,
  answered,
  chosen,
  correct,
  onPick,
}: {
  number: number;
  text: string;
  answered: boolean;
  chosen: boolean;
  correct: boolean;
  onPick: () => void;
}) {
  // Answered options stay focusable (aria-disabled, not disabled), so focus never drops to the page.
  return (
    <button
      type="button"
      aria-disabled={answered || undefined}
      onClick={answered ? undefined : onPick}
      className={clsx(
        "flex min-h-11 w-full items-start gap-3 rounded-control border-2 px-3 py-2.5 text-left",
        "motion-safe:transition-colors",
        !answered && "cursor-pointer border-control-edge bg-sheet hover:border-ink",
        answered && "cursor-default",
        answered && correct && "border-proven bg-paper",
        answered && chosen && !correct && "border-danger bg-danger-surface",
        answered && !chosen && !correct && "border-rule text-ink-soft",
      )}
    >
      <span className="font-semibold">{number}.</span>
      <span className="flex-1">{text}</span>
      {answered && (correct || chosen) && (
        <span className="flex shrink-0 items-center gap-1 text-sm font-semibold">
          {correct ? (
            <Check size={16} aria-hidden="true" className="text-proven" />
          ) : (
            <X size={16} aria-hidden="true" className="text-danger" />
          )}
          {correct && chosen && "Your answer, correct"}
          {correct && !chosen && "Correct answer"}
          {!correct && chosen && "Your answer"}
        </span>
      )}
    </button>
  );
}

function Feedback({ question, choice }: { question: QuizQuestion; choice: number }) {
  const right = choice === question.answerIndex;
  const answerNumber = question.answerIndex + 1;
  return (
    <>
      <p className="flex items-start gap-2 font-semibold">
        {right ? (
          <Check size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-proven" />
        ) : (
          <X size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
        )}
        <span>
          {right
            ? "Correct."
            : `Not quite. The answer is ${answerNumber}: ${question.options[question.answerIndex]}`}
        </span>
      </p>
      <p>{question.explanation}</p>
      {question.citation?.verified && <PostingQuote citation={question.citation} />}
    </>
  );
}

function PostingQuote({ citation }: { citation: Citation }) {
  return (
    <figure className="flex flex-col gap-1 text-sm">
      <figcaption className="font-semibold text-ink-soft">
        From the {citation.kind === "pdf" ? "PDF" : "posting"}
        {citation.page ? `, page ${citation.page}` : ""}:
      </figcaption>
      <blockquote className="border-l-2 border-rule pl-3 font-display">{citation.quote}</blockquote>
    </figure>
  );
}

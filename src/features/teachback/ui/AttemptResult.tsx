import type { Ref } from "react";
import { PASS_SCORE } from "@/shared/types";
import type { Attempt, CheckpointResult } from "@/shared/types";
import { integritySentence, nextStepSentence, scoreBreakdown, verdictTitle } from "./format";

type AttemptResultProps = {
  attempt: Attempt;
  skillTitle: string;
  /** How many checkpoints the skill has. See scoreBreakdown for why it is passed in. */
  checkpointTotal: number;
  /** Receives keyboard focus when a new result arrives. */
  headingRef: Ref<HTMLHeadingElement>;
};

/** The result screen: the verdict, the score, then the evidence behind the score. */
export function AttemptResult({
  attempt,
  skillTitle,
  checkpointTotal,
  headingRef,
}: AttemptResultProps) {
  const { grade } = attempt;
  const breakdown = scoreBreakdown(attempt, checkpointTotal);

  // Proven keeps the detail one click away, so the banner and the next step share one view.
  if (attempt.status === "proven") {
    return (
      <div className="flex flex-col gap-5">
        <ProvenBanner skillTitle={skillTitle} headingRef={headingRef} attempt={attempt} />
        <ScoreScale score={grade.score} breakdown={breakdown} />
        {attempt.followUp?.feedback && (
          <p>
            <span className="font-semibold text-forest">Follow-up passed.</span>{" "}
            {attempt.followUp.feedback}
          </p>
        )}
        <Misconceptions items={grade.misconceptions} />
        <IntegrityNote attempt={attempt} />
        <details>
          <summary className="min-h-10 cursor-pointer py-2 font-semibold underline decoration-1 underline-offset-4 hover:decoration-2">
            Show checkpoints and follow-up
          </summary>
          <div className="mt-3 flex flex-col gap-6">
            <Checkpoints attempt={attempt} />
            <FollowUpRecord attempt={attempt} />
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h3 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
          {verdictTitle(attempt)}
        </h3>
        <p className="text-ink-soft">{nextStepSentence(attempt)}</p>
      </div>
      <ScoreScale score={grade.score} breakdown={breakdown} />
      <Checkpoints attempt={attempt} />
      <Misconceptions items={grade.misconceptions} />
      <FollowUpRecord attempt={attempt} />
      <IntegrityNote attempt={attempt} />
    </div>
  );
}

function Checkpoints({ attempt }: { attempt: Attempt }) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="font-semibold">What your explanation covered</h4>
      <p className="text-sm text-ink-soft">
        Highlights are your exact words, checked by code against what you wrote.
      </p>
      <ul className="mt-1 divide-y divide-rule">
        {attempt.grade.checkpoints.map((checkpoint) => (
          <CheckpointRow key={checkpoint.checkpoint} result={checkpoint} />
        ))}
      </ul>
    </section>
  );
}

function Misconceptions({ items }: { items: string[] }) {
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 border-l-4 border-danger pl-4">
      <h4 className="font-semibold">{items.length === 1 ? "One thing to correct" : "Things to correct"}</h4>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

/** The question and the learner's answer, once they have answered it. */
function FollowUpRecord({ attempt }: { attempt: Attempt }) {
  const { followUp } = attempt;
  if (!followUp?.answer) return null;

  return (
    <section className="flex flex-col gap-2">
      <h4 className="font-semibold">
        {followUp.passed ? "Follow-up question, passed" : "Follow-up question, not passed"}
      </h4>
      <p className="font-display">{followUp.question}</p>
      <p className="border-l-2 border-control-edge pl-3 text-ink-soft">{followUp.answer}</p>
      {!followUp.passed && followUp.feedback && <p>{followUp.feedback}</p>}
    </section>
  );
}

function IntegrityNote({ attempt }: { attempt: Attempt }) {
  return (
    <p className="text-sm text-ink-soft">
      On your evidence page: {lowerFirst(integritySentence(attempt.integrity))}
    </p>
  );
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function ProvenBanner({
  attempt,
  skillTitle,
  headingRef,
}: {
  attempt: Attempt;
  skillTitle: string;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex items-center gap-4 rounded-sheet bg-proven-surface p-5 text-on-proven">
      <svg
        width={56}
        height={56}
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="animate-stamp shrink-0"
      >
        <path
          d="M12 2.5 22.5 21h-21z"
          fill="var(--color-on-proven)"
          stroke="var(--color-on-proven)"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="14.5" r="2.6" fill="var(--color-proven)" />
      </svg>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 ref={headingRef} tabIndex={-1} className="text-3xl font-semibold">
          {verdictTitle(attempt)}
        </h3>
        <p className="font-semibold">{skillTitle}</p>
        <p className="text-sm">{nextStepSentence(attempt)}</p>
      </div>
    </div>
  );
}

/** The score on a map-style scale bar, with the pass mark always visible. */
function ScoreScale({ score, breakdown }: { score: number; breakdown: string }) {
  const passed = score >= PASS_SCORE;

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-3">
        <span className="font-display text-4xl font-semibold tabular-nums">{score}</span>
        <span className="min-w-0 text-ink-soft">out of 100. {breakdown}</span>
      </p>
      {/* The numbers above say all this in words, so the bar is hidden from screen readers. */}
      <div aria-hidden="true">
        <div className="relative h-4 border-2 border-ink bg-sheet">
          <div
            className={passed ? "h-full bg-forest" : "h-full bg-contour"}
            style={{ width: `${score}%` }}
          />
          <div
            className="absolute -top-1.5 -bottom-1.5 w-1.5 -translate-x-1/2 border-x border-sheet bg-ink"
            style={{ left: `${PASS_SCORE}%` }}
          />
        </div>
        <div className="relative mt-2 h-5 text-sm text-ink-soft tabular-nums">
          <span className="absolute left-0">0</span>
          <span
            className="absolute -translate-x-1/2 font-semibold text-ink"
            style={{ left: `${PASS_SCORE}%` }}
          >
            {PASS_SCORE} to pass
          </span>
          <span className="absolute right-0">100</span>
        </div>
      </div>
    </div>
  );
}

function CheckpointRow({ result }: { result: CheckpointResult }) {
  return (
    <li className="flex gap-3 py-3">
      <CheckpointMark met={result.met} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p>
          <span className={result.met ? "font-semibold text-forest" : "font-semibold text-contour"}>
            {result.met ? "Met." : "Missed."}
          </span>{" "}
          {result.checkpoint}
        </p>
        {result.quote && (
          <p>
            <span className="sr-only">Your words: </span>
            <mark className="animate-highlight bg-highlight box-decoration-clone px-1 py-0.5 text-ink">
              &ldquo;{result.quote}&rdquo;
            </mark>
          </p>
        )}
      </div>
    </li>
  );
}

/** A filled tick for met and a dashed ring for missed, so the two differ without colour. */
function CheckpointMark({ met }: { met: boolean }) {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 shrink-0">
      {met ? (
        <>
          <circle cx="12" cy="12" r="11" fill="var(--color-forest)" />
          <path
            d="m6.5 12.5 3.8 3.8 7.2-8"
            fill="none"
            stroke="var(--color-on-dark)"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <circle
          cx="12"
          cy="12"
          r="9.5"
          fill="none"
          stroke="var(--color-contour)"
          strokeWidth="2.5"
          strokeDasharray="4 3.2"
        />
      )}
    </svg>
  );
}

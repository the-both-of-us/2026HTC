import clsx from "clsx";
import { Check, CircleDashed, MessageCircleQuestion, Timer } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { PASS_SCORE } from "@/shared/types";
import type { Attempt, CheckpointResult } from "@/shared/types";
import { InlineText, ReadAloudButton } from "@/shared/ui";
import {
  integritySentence,
  metCount,
  nextStepSentence,
  resultReadAloud,
  scoreBreakdown,
  secondsText,
  verdictTitle,
} from "./format";

type AttemptResultProps = {
  attempt: Attempt;
  skillTitle: string;
  /** How many checkpoints the skill has. See scoreBreakdown for why it is passed in. */
  checkpointTotal: number;
  /** Receives keyboard focus when a new result arrives. */
  headingRef: Ref<HTMLHeadingElement>;
  /** The open follow-up question. It goes right under the score, so nobody has to scroll to find it. */
  children?: ReactNode;
  /** What this proof opened. It goes right under the verdict, so the two share one view. */
  nextStep?: ReactNode;
  /** Opens the evidence page. See TeachBackPanel. */
  evidenceAction?: ReactNode;
};

/** The result screen: the verdict, the score, then the evidence behind the score. */
export function AttemptResult({
  attempt,
  skillTitle,
  checkpointTotal,
  headingRef,
  children,
  nextStep,
  evidenceAction,
}: AttemptResultProps) {
  const { grade } = attempt;
  const breakdown = scoreBreakdown(attempt, checkpointTotal);
  // Only shows in Accessible learning mode.
  const readAloud = (
    <ReadAloudButton
      what="this result"
      text={resultReadAloud(attempt, skillTitle, checkpointTotal)}
      className="self-start"
    />
  );

  // Proven keeps the quotes one click away, so the verdict, the next step and every
  // checkpoint share one view.
  if (attempt.status === "proven") {
    return (
      <div className="flex flex-col gap-5">
        <ProvenBanner
          skillTitle={skillTitle}
          headingRef={headingRef}
          attempt={attempt}
          showNextStep={!nextStep}
        />
        {readAloud}
        {nextStep}
        {evidenceAction}
        <ScoreScale score={grade.score} breakdown={breakdown} />
        <TimingChip attempt={attempt} />
        <CheckpointsAtAGlance attempt={attempt} total={checkpointTotal} />
        {attempt.followUp?.feedback && (
          <p>
            <span className="font-medium text-proven">Follow-up passed.</span>{" "}
            <InlineText text={attempt.followUp.feedback} />
          </p>
        )}
        <Misconceptions items={grade.misconceptions} />
        <IntegrityNote attempt={attempt} />
        <details className="rounded-control border border-rule-strong">
          <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium transition-control hover:bg-raised">
            {attempt.followUp ? "Show your words and the follow-up" : "Show your words"}
          </summary>
          <div className="flex flex-col gap-5 p-3 pt-2">
            <Checkpoints attempt={attempt} />
            <FollowUpRecord attempt={attempt} />
          </div>
        </details>
      </div>
    );
  }

  const waitingOnFollowUp = attempt.status === "needs-followup";

  return (
    <div className="flex flex-col gap-5">
      <div
        className={clsx(
          "flex items-start gap-3.5 rounded-sheet border p-4",
          waitingOnFollowUp
            ? "border-accent/60 bg-available-surface"
            : "border-dashed border-amber/60 bg-amber/5",
        )}
      >
        {waitingOnFollowUp ? (
          <MessageCircleQuestion aria-hidden="true" size={26} className="mt-0.5 shrink-0 text-accent-bright" />
        ) : (
          <CircleDashed aria-hidden="true" size={26} className="mt-0.5 shrink-0 text-amber" />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <h3 ref={headingRef} tabIndex={-1} className="text-xl font-medium">
            {verdictTitle(attempt)}
          </h3>
          <p className="text-ink-soft">{nextStepSentence(attempt)}</p>
        </div>
      </div>
      {readAloud}
      <ScoreScale score={grade.score} breakdown={breakdown} />
      <TimingChip attempt={attempt} />
      <CheckpointBar attempt={attempt} total={checkpointTotal} />
      {children}
      <FollowUpRecord attempt={attempt} />
      <Checkpoints attempt={attempt} />
      <Misconceptions items={grade.misconceptions} />
      <IntegrityNote attempt={attempt} />
    </div>
  );
}

/** The real time the server measured. Nothing shows for an attempt saved before it was measured. */
function TimingChip({ attempt }: { attempt: Attempt }) {
  if (!attempt.timing) return null;
  const { gradeMs, followUpMs } = attempt.timing;

  return (
    <p
      className="inline-flex items-center gap-1.5 self-start rounded-control border border-rule-strong bg-raised/60 px-2.5 py-1 text-sm text-ink-soft tabular-nums"
      title="Measured on the server: the AI finding your exact words, then code checking each one and computing the score."
    >
      <Timer aria-hidden="true" size={14} />
      Graded in {secondsText(gradeMs)}
      {followUpMs !== null && <>, follow-up checked in {secondsText(followUpMs)}</>}
    </p>
  );
}

/**
 * One segment per checkpoint: solid green with a tick for met, dashed amber for missed.
 * While a follow-up is open the server hides the rest, so those segments stay plain.
 */
function CheckpointBar({ attempt, total }: { attempt: Attempt; total: number }) {
  const { checkpoints } = attempt.grade;
  const met = metCount(attempt.grade);
  const missed = checkpoints.length - met;
  const hidden = Math.max(0, total - checkpoints.length);
  const ordered = [...checkpoints].sort((a, b) => Number(b.met) - Number(a.met));

  return (
    <div className="flex flex-col gap-1.5">
      <div aria-hidden="true" className="flex gap-1">
        {ordered.map((checkpoint) => (
          <span
            key={checkpoint.checkpoint}
            className={clsx(
              "flex h-5 flex-1 items-center justify-center rounded-md",
              checkpoint.met
                ? "bg-proven text-on-proven"
                : "border-[1.5px] border-dashed border-amber bg-amber/10",
            )}
          >
            {checkpoint.met && <Check size={13} strokeWidth={3.5} />}
          </span>
        ))}
        {Array.from({ length: hidden }, (_, index) => (
          <span key={index} className="h-5 flex-1 rounded-md border border-rule-strong bg-raised" />
        ))}
      </div>
      <p className="text-sm tabular-nums">
        <span className="font-medium text-proven">{met} met</span>
        {missed > 0 && (
          <>
            {", "}
            <span className="font-medium text-amber">{missed} missed</span>
          </>
        )}
        {hidden > 0 && <span className="text-ink-soft">, {hidden} shown after your answer</span>}
      </p>
    </div>
  );
}

/** The bar plus one short line per checkpoint. Used when the result needs to stay compact. */
function CheckpointsAtAGlance({ attempt, total }: { attempt: Attempt; total: number }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h4 className="sr-only">Checkpoints</h4>
      <CheckpointBar attempt={attempt} total={total} />
      <ul className="flex flex-col gap-1.5">
        {attempt.grade.checkpoints.map((checkpoint) => (
          <li key={checkpoint.checkpoint} className="flex gap-2 text-sm">
            <CheckpointMark met={checkpoint.met} size={17} />
            <span>
              <span className="sr-only">{checkpoint.met ? "Met: " : "Missed: "}</span>
              <InlineText text={checkpoint.checkpoint} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Checkpoints({ attempt }: { attempt: Attempt }) {
  // What is missing is what the learner needs next, so it comes first until they pass.
  const ordered = [...attempt.grade.checkpoints].sort((a, b) =>
    attempt.status === "proven" ? Number(b.met) - Number(a.met) : Number(a.met) - Number(b.met),
  );

  return (
    <section className="flex flex-col gap-2">
      <div>
        <h4 className="font-medium">What your explanation covered</h4>
        <p className="text-sm text-ink-soft">
          Highlights are your exact words, checked by code against what you wrote.
          {attempt.status === "not-yet" && " Repeating a checkpoint word for word earns nothing, so say it your own way."}
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {ordered.map((checkpoint) => (
          <CheckpointRow key={checkpoint.checkpoint} result={checkpoint} />
        ))}
      </ul>
    </section>
  );
}

function Misconceptions({ items }: { items: string[] }) {
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 rounded-control border border-danger/60 bg-danger-surface p-3.5">
      <h4 className="font-medium">{items.length === 1 ? "One thing to correct" : "Things to correct"}</h4>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item}>
            <InlineText text={item} />
          </li>
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
      <h4 className="font-medium">
        {followUp.passed ? "Follow-up question, passed" : "Follow-up question, not passed"}
        {followUp.inputMethod === "voice" && <span className="font-normal text-ink-soft"> · answered aloud</span>}
      </h4>
      <p>
        <InlineText text={followUp.question} />
      </p>
      <p className="border-l-2 border-control-edge pl-3 text-ink-soft">{followUp.answer}</p>
      {!followUp.passed && followUp.feedback && (
        <p>
          <InlineText text={followUp.feedback} />
        </p>
      )}
    </section>
  );
}

function IntegrityNote({ attempt }: { attempt: Attempt }) {
  return (
    <p className="text-sm text-ink-soft">
      {attempt.status === "proven" ? "On your evidence page: " : "How you wrote this: "}
      {lowerFirst(integritySentence(attempt.integrity))}
    </p>
  );
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The payoff: the big green moment a learner works for. */
function ProvenBanner({
  attempt,
  skillTitle,
  headingRef,
  showNextStep,
}: {
  attempt: Attempt;
  skillTitle: string;
  headingRef: Ref<HTMLHeadingElement>;
  showNextStep: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-sheet border border-proven/70 bg-proven-surface p-5">
      <div className="flex items-center gap-4">
        <span className="animate-tick flex size-14 shrink-0 items-center justify-center rounded-full bg-proven text-on-proven">
          <Check aria-hidden="true" size={32} strokeWidth={3} />
        </span>
        <div className="flex min-w-0 flex-col">
          <h3 ref={headingRef} tabIndex={-1} className="font-serif text-5xl font-semibold">
            {verdictTitle(attempt)}
          </h3>
          <p className="font-medium">{skillTitle}</p>
        </div>
      </div>
      {showNextStep && <p className="text-sm text-ink-soft">{nextStepSentence(attempt)}</p>}
    </div>
  );
}

/** The score on a bar, with the pass mark always visible. */
function ScoreScale({ score, breakdown }: { score: number; breakdown: string }) {
  const passed = score >= PASS_SCORE;

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-baseline gap-2.5">
        <span className="text-4xl font-semibold tabular-nums">{score}</span>
        <span className="min-w-0 text-sm text-ink-soft">out of 100. {breakdown}</span>
      </p>
      {/* The numbers above say all this in words, so the bar is hidden from screen readers. */}
      <div aria-hidden="true">
        <div className="relative h-2.5 rounded-full bg-rule-strong">
          <div
            className={clsx("animate-bar h-full rounded-full", passed ? "bg-proven" : "bg-amber")}
            style={{ width: `${score}%` }}
          />
          <div
            className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-ink"
            style={{ left: `${PASS_SCORE}%` }}
          />
        </div>
        <div className="relative mt-1.5 h-5 text-sm text-ink-soft tabular-nums">
          <span
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${PASS_SCORE}%` }}
          >
            {PASS_SCORE} to pass
          </span>
        </div>
      </div>
    </div>
  );
}

function CheckpointRow({ result }: { result: CheckpointResult }) {
  return (
    <li
      className={clsx(
        "flex gap-3 rounded-control border p-3",
        result.met ? "border-proven/40 bg-proven-surface/70" : "border-dashed border-amber/55 bg-amber/5",
      )}
    >
      <CheckpointMark met={result.met} size={20} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p>
          <span className={clsx("font-medium", result.met ? "text-proven" : "text-amber")}>
            {result.met ? "Met." : "Missed."}
          </span>{" "}
          <InlineText text={result.checkpoint} />
        </p>
        {result.quote && (
          <p>
            <span className="sr-only">Your words: </span>
            <mark className="animate-highlight rounded-sm bg-highlight box-decoration-clone px-1 py-0.5 text-ink">
              &ldquo;{result.quote}&rdquo;
            </mark>
          </p>
        )}
      </div>
    </li>
  );
}

/** A filled tick for met and a dashed ring for missed, so the two differ without colour. */
function CheckpointMark({ met, size }: { met: boolean; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 shrink-0">
      {met ? (
        <>
          <circle cx="12" cy="12" r="11" fill="var(--color-proven)" />
          <path
            d="m6.5 12.5 3.8 3.8 7.2-8"
            fill="none"
            stroke="var(--color-on-proven)"
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
          stroke="var(--color-amber)"
          strokeWidth="2.5"
          strokeDasharray="4 3.2"
        />
      )}
    </svg>
  );
}

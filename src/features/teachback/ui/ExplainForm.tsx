import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Button, ErrorNotice, Field, Textarea } from "@/shared/ui";
import { MAX_KID_GRADE, readingGrade } from "../formats";
import { countWords } from "../learnerText";
import { MIN_WORDS, wordCountMessage } from "./format";
import { PendingNote } from "./PendingNote";
import type { Integrity } from "./useIntegrity";
import "./challenges.css";
import { useYoungLearner } from "./YoungLearner";

type ExplainFormProps = {
  /** Used to make the input's id unique on the page. */
  nodeId: string;
  skillTitle: string;
  checkpointCount: number;
  text: string;
  onTextChange: (text: string) => void;
  integrity: Integrity;
  /** True after a not-yet result: the same text comes back for editing. */
  revising: boolean;
  pending: boolean;
  requestError: string | null;
  onSubmit: () => void;
  /** "kid" adds a live reading-level check, "timed" a 30-second clock. */
  format?: "explain" | "kid" | "timed";
};

/** How long "Say it in 30 seconds" gives. */
const CLOCK_SECONDS = 30;

export function ExplainForm({
  nodeId,
  skillTitle,
  checkpointCount,
  text,
  onTextChange,
  integrity,
  revising,
  pending,
  requestError,
  onSubmit,
  format = "explain",
}: ExplainFormProps) {
  const young = useYoungLearner();
  const [tooShort, setTooShort] = useState(false);

  // "Say it in 30 seconds": the clock starts on the first word and the
  // box locks when it runs out. Start over clears it for another go.
  const timed = format === "timed";
  const [clock, setClock] = useState<{ endsAt: number; left: number; stoppedAt?: number } | null>(null);
  const clockRunning = clock !== null && clock.stoppedAt === undefined;
  const timeUp = clock?.stoppedAt !== undefined;

  // A not-yet result keeps the text "for editing", so unlock it: the next edit starts a fresh clock.
  // Without this the box stayed locked, and "Check again" could only resend the text that just failed.
  const [wasPending, setWasPending] = useState(pending);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (!pending && timed && revising) setClock(null);
  }

  const endsAt = clockRunning ? clock.endsAt : null;
  useEffect(() => {
    if (endsAt === null) return;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      if (left > 0) return setClock((current) => current && { ...current, left });
      setClock((current) => current && { ...current, left: 0, stoppedAt: 0 });
    }, 250);
    return () => clearInterval(timer);
  }, [endsAt]);

  function startClock(now: number) {
    if (timed && clock === null) setClock({ endsAt: now + CLOCK_SECONDS * 1000, left: CLOCK_SECONDS });
  }

  function stopClock() {
    setClock((current) => current && { ...current, stoppedAt: current.left });
  }

  function startOver() {
    integrity.reset();
    onTextChange("");
    setClock(null);
  }

  const words = countWords(text);
  const inputId = `explain-${nodeId}`;
  const countId = `${inputId}-count`;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (words < MIN_WORDS) {
      setTooShort(true);
      return;
    }
    if (clockRunning) stopClock();
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <h3 className="text-lg font-medium">
        {revising && !timed ? "Revise your explanation" : young && format === "kid" ? `Explain ${skillTitle} to a friend.` : HEADINGS[format](skillTitle)}
      </h3>
      {format === "kid" && (
        <p className="-mt-2 text-sm text-ink-soft">
          Short sentences, everyday words. The reading level below is a tip: it never stops you passing.
        </p>
      )}
      {timed && (
        <Clock seconds={clock?.left ?? CLOCK_SECONDS} running={clockRunning} spare={timeUp ? (clock?.stoppedAt ?? 0) : null} />
      )}

      <Field
        id={inputId}
        label="Your explanation"
        hint="Your evidence page will show how you wrote this: word count, active typing time, and any pasting."
        error={tooShort ? `Write at least ${MIN_WORDS} words, so there is enough to check.` : null}
      >
        {(control) => (
          <Textarea
            {...control}
            aria-describedby={[control["aria-describedby"], countId].filter(Boolean).join(" ")}
            rows={5}
            value={text}
            readOnly={pending || timeUp}
            onPaste={integrity.recordPaste}
            onDrop={integrity.recordPaste}
            onChange={(event) => {
              const next = event.target.value;
              if (next.trim() === "") integrity.reset();
              else integrity.recordTyping();
              startClock(Date.now());
              setTooShort(false);
              onTextChange(next);
            }}
          />
        )}
      </Field>

      <p id={countId} className="text-sm text-ink-soft tabular-nums">
        {wordCountMessage(words)}
      </p>
      {format === "kid" && words > 0 && <ReadingLevel grade={readingGrade(text)} young={young} />}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" pending={pending}>
          {pending ? "Checking" : revising ? "Check again" : "Check my explanation"}
        </Button>
        {timed && clockRunning && (
          <Button variant="subtle" onClick={stopClock}>
            Stop the clock
          </Button>
        )}
        {timed && timeUp && !pending && (
          <Button variant="subtle" onClick={startOver}>
            Start over
          </Button>
        )}
      </div>

      {pending && (
        <PendingNote message={`Checking what you wrote against ${checkpointCount} checkpoints.`} />
      )}
      {requestError && !pending && <ErrorNotice message={requestError} onRetry={onSubmit} />}
    </form>
  );
}

const HEADINGS = {
  explain: (title: string) => `Explain ${title} as if to a curious friend.`,
  kid: (title: string) => `Explain ${title} to a 10-year-old.`,
  timed: (title: string) => `Say ${title} in 30 seconds. Go!`,
};

/** The live reading level for "Explain it to a 10-year-old". A tip only; the server records it for the evidence page. */
function ReadingLevel({ grade, young }: { grade: number; young: boolean }) {
  const ok = grade <= MAX_KID_GRADE;
  return (
    <p className={`text-sm font-medium tabular-nums ${ok ? "text-proven" : "text-amber"}`}>
      Reading level: grade {Math.round(grade)}. {ok ? (young ? "A friend could follow this." : "A 10-year-old could follow this.") : "Shorter sentences would make it easier to follow."}
    </p>
  );
}

/** The 30-second clock. spare is set once it stopped: the seconds that were left. */
function Clock({ seconds, running, spare }: { seconds: number; running: boolean; spare: number | null }) {
  return (
    <div className="flex items-center gap-3" role="timer" aria-live="off">
      <span
        className={`inline-flex min-w-20 justify-center rounded-control border px-3 py-1.5 text-2xl font-semibold tabular-nums ${
          running && seconds <= 10 ? "clock-urgent border-amber text-amber" : "border-accent/50 text-accent-bright"
        }`}
      >
        0:{String(seconds).padStart(2, "0")}
      </span>
      <span className="text-sm text-ink-soft">
        {spare === null
          ? running
            ? "Keep going."
            : "Starts on your first word."
          : spare > 0
            ? `Done with ${spare} ${spare === 1 ? "second" : "seconds"} to spare.`
            : "Time! Check it, or start over."}
      </span>
    </div>
  );
}

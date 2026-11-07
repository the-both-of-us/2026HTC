"use client";

import clsx from "clsx";
import { CheckCircle2, Layers } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Button, buttonClasses, ErrorNotice, PageShell, Spinner } from "@/shared/ui";
import { formatInterval } from "../sm2";
import { GRADES, type Grade, type QueueItem, type ReviewQueue } from "../types";
import { fetchQueue, sendGrade } from "./api";
import { createSaveQueue } from "./saves";
import { cardCounter, dueIn, earliest, GRADE_LABELS, keyAction, remainingLabel } from "./session";

type Phase = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: ReviewQueue };

/** /review: one card at a time, due reviews first, graded Again, Hard, Good or Easy. */
export function ReviewScreen() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [loadCount, setLoadCount] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let current = true;
    fetchQueue().then((result) => {
      if (!current) return;
      setPhase(result.ok ? { kind: "ready", data: result.queue } : { kind: "error", message: result.message });
    });
    return () => {
      current = false;
    };
  }, [loadCount]);

  function reload() {
    // The button pressed is about to go, so focus moves to the heading, which stays.
    heading.current?.focus();
    setPhase({ kind: "loading" });
    setLoadCount((count) => count + 1);
  }

  return (
    <PageShell width="reading">
      <h1 ref={heading} tabIndex={-1} className="text-3xl font-medium outline-none">
        Review
      </h1>
      <p className="mt-2 text-lg text-ink-soft">
        Flashcards from your own maps, spaced out so each one comes back just before you would forget it.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        {phase.kind === "loading" && (
          <p role="status" className="flex items-center gap-3 text-lg">
            <Spinner size={22} />
            Loading your cards.
          </p>
        )}
        {phase.kind === "error" && <ErrorNotice message={phase.message} onRetry={reload} />}
        {phase.kind === "ready" &&
          (phase.data.totalCards === 0 ? (
            <NoCards />
          ) : (
            // Keyed, so checking again starts a fresh session.
            <ReviewSession key={loadCount} data={phase.data} onReload={reload} />
          ))}
      </div>
    </PageShell>
  );
}

function NoCards() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-sheet border border-rule-strong bg-sheet/90 p-5 sm:p-6">
      <Layers aria-hidden="true" size={28} className="text-accent-bright" />
      <h2 className="text-xl font-medium">No flashcards yet</h2>
      <p>
        Cards appear here after you make flashcards on a skill. Open one of your maps, choose a skill, and press
        &ldquo;Make flashcards&rdquo; under the teach-back. They come back here on a schedule.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/dashboard" className={buttonClasses("primary")}>
          Go to your maps
        </Link>
        <Link href="/courses" className={buttonClasses("secondary")}>
          Browse courses
        </Link>
      </div>
    </div>
  );
}

type SessionProps = { data: ReviewQueue; onReload: () => void };

/** One pass through a loaded queue. Exported for tests. */
export function ReviewSession({ data, onReload }: SessionProps) {
  const queue = data.queue;
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [nextDueAt, setNextDueAt] = useState<string | null>(data.nextDueAt);
  // Answers still being saved. While any are, the learner cannot leave the session, so a
  // failed save always comes back here with its card and an error.
  const [pending, setPending] = useState(0);
  const [saves] = useState(() => createSaveQueue(setPending));
  const face = useRef<HTMLDivElement>(null);
  // Set when the card on screen changes and should take focus once it renders.
  const focusFace = useRef(false);
  const doneHeading = useRef<HTMLHeadingElement>(null);
  const ids = useId();
  const contextId = `${ids}-context`;
  const frontId = `${ids}-front`;
  const backId = `${ids}-back`;
  const hintId = `${ids}-hint`;

  const done = index >= queue.length;
  const item: QueueItem | undefined = queue[index];

  useEffect(() => {
    if (done && queue.length > 0) doneHeading.current?.focus();
  }, [done, queue.length]);

  // The card is keyed, so each one is a new element: focusing it reads its question out.
  useEffect(() => {
    if (!focusFace.current) return;
    focusFace.current = false;
    face.current?.focus();
  }, [index]);

  function reveal() {
    setRevealed(true);
    setAnnouncement("");
    face.current?.focus();
  }

  function grade(choice: Grade) {
    if (!item) return;
    const at = index;
    const days = item.intervals[choice];

    focusFace.current = at + 1 < queue.length;
    setIndex(at + 1);
    setRevealed(false);
    setError(null);
    setAnnouncement(`${GRADE_LABELS[choice]}. Back in ${formatInterval(days)}.`);

    // Saved one after another; a failure drops the answers queued behind it (see saves.ts).
    void saves.add(async () => {
      const result = await sendGrade(item, choice);
      if (result.ok) {
        setNextDueAt((current) => earliest(current, result.schedule.dueAt));
        return true;
      }
      focusFace.current = true;
      setIndex(at);
      setRevealed(true);
      setError(`Your answer was not saved, so this card is back on screen. ${result.message}`);
      setAnnouncement("");
      return false;
    });
  }

  function checkAgain() {
    // The button is pending while saves are in flight; this is the backstop.
    if (saves.pending() === 0) onReload();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const action = keyAction(event, revealed);
    if (!action) return;
    // Stops Space scrolling the page, only while focus is inside the card.
    event.preventDefault();
    if (action.kind === "reveal") reveal();
    else grade(action.grade);
  }

  if (queue.length === 0 || done) {
    return (
      <>
        {error && <ErrorNotice message={error} />}
        <Done
          headingRef={doneHeading}
          reviewed={queue.length > 0}
          saving={pending > 0}
          moreNew={data.moreNew}
          nextDueAt={nextDueAt}
          announcement={announcement}
          onReload={checkAgain}
        />
      </>
    );
  }

  const side = revealed ? "Answer" : "Question";

  return (
    <>
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-base">
        <span className="font-semibold">{cardCounter(index, queue.length)}</span>
        <span className="text-ink-soft">{remainingLabel(queue.slice(index))}</span>
      </p>

      {error && <ErrorNotice message={error} />}

      {/* Keys are handled here only, never on the document, so they never reach other controls. */}
      <div role="group" aria-label="Review card" onKeyDown={onKeyDown} className="flex flex-col gap-4">
        {/* Named by its own words, so moving focus here reads the question; the keys are its description. */}
        <div
          key={item.cardId}
          ref={face}
          tabIndex={0}
          role="group"
          aria-roledescription="flashcard"
          aria-labelledby={revealed ? `${contextId} ${frontId} ${backId}` : `${contextId} ${frontId}`}
          aria-describedby={hintId}
          className={clsx(
            "min-h-44 rounded-control border-2 bg-paper p-5",
            revealed ? "border-ink" : "border-control-edge",
          )}
        >
          <p id={contextId} className="text-sm text-ink-soft">
            {item.mapTitle} · {item.skillTitle}
            {item.isNew && (
              <>
                {" · "}
                <span className="font-semibold text-accent-bright">New</span>
              </>
            )}
          </p>
          <p id={frontId} className="mt-3 font-display text-xl font-medium break-words">
            {item.front}
          </p>
          {/* Stays mounted, so the answer is announced when it appears. */}
          <div aria-live="polite">
            {revealed && (
              <div
                key={`${item.cardId}-${side}`}
                className="mt-4 border-t border-rule pt-4 motion-safe:transition-opacity motion-safe:duration-200 starting:opacity-0"
              >
                <p className="text-sm font-semibold tracking-wide text-ink-soft uppercase">Answer</p>
                <p id={backId} className="mt-1 text-base break-words">
                  {item.back}
                </p>
              </div>
            )}
          </div>
        </div>
        <p id={hintId} hidden>
          {revealed
            ? `${side} showing. Press 1 for Again, 2 for Hard, 3 for Good or 4 for Easy.`
            : `${side}. Press Space to show the answer.`}
        </p>

        {revealed ? (
          <div>
            <p id="grade-help" className="mb-2 text-base font-semibold">
              How well did you know it?
            </p>
            <div role="group" aria-labelledby="grade-help" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {GRADES.map((choice, position) => (
                <Button
                  key={choice}
                  variant={choice === "good" ? "primary" : "secondary"}
                  onClick={() => grade(choice)}
                  className="flex-col gap-0 py-1.5"
                  aria-keyshortcuts={String(position + 1)}
                >
                  <span>{GRADE_LABELS[choice]}</span>
                  <span className="text-sm font-normal opacity-85">{formatInterval(item.intervals[choice])}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <Button onClick={reveal} className="self-start" aria-keyshortcuts="Space">
            Show answer
          </Button>
        )}
      </div>

      <p className="sr-only" role="status">
        {announcement}
      </p>
      <p className="hidden text-sm text-ink-soft sm:block">
        With a keyboard: focus the card, press Space to show the answer, then 1 to 4 to grade it.
      </p>
    </>
  );
}

type DoneProps = {
  headingRef?: RefObject<HTMLHeadingElement | null>;
  reviewed: boolean;
  /** An answer is still being saved: both ways out wait for it. */
  saving: boolean;
  /** New cards past the per-queue cap, due now. */
  moreNew: number;
  nextDueAt: string | null;
  announcement: string;
  onReload: () => void;
};

/** The end of a session. Exported for tests. */
export function Done({ headingRef, reviewed, saving, moreNew, nextDueAt, announcement, onReload }: DoneProps) {
  // Rendered only in the browser, after the queue loads, so the clock and locale are the viewer's.
  const [now] = useState(() => new Date());
  const when = nextDueAt
    ? `Your next card is due ${dueIn(nextDueAt, now)}, ${new Date(nextDueAt).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })}.`
    : "No cards are scheduled yet.";
  const more = reviewed && moreNew > 0;

  return (
    <div className="flex flex-col items-start gap-4 rounded-sheet border border-rule-strong bg-sheet/90 p-5 sm:p-6">
      <CheckCircle2 aria-hidden="true" size={28} className="text-proven" />
      <h2 ref={headingRef} tabIndex={-1} className="text-xl font-medium outline-none">
        {more ? "Set finished" : "All caught up"}
      </h2>
      <p>
        {more
          ? `${moreNew === 1 ? "1 more new card is" : `${moreNew} more new cards are`} ready now. New cards come 20 at a time so reviews never pile up behind them.`
          : `${reviewed ? "That is every card due right now. " : "Nothing is due right now. "}${when}`}
      </p>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {saving && (
        <p role="status" className="flex items-center gap-3">
          <Spinner size={18} />
          Saving your last answer…
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {/* Hidden while a save is in flight, so leaving can never drop a failed save unseen. */}
        {!saving && (
          <Link href="/dashboard" className={buttonClasses(more ? "secondary" : "primary")}>
            Back to the dashboard
          </Link>
        )}
        <Button variant={more ? "primary" : "secondary"} pending={saving} onClick={onReload}>
          Check for more cards
        </Button>
      </div>
    </div>
  );
}

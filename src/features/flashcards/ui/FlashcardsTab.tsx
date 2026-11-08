"use client";

import clsx from "clsx";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Citation, SkillNode } from "@/shared/types";
import type { Flashcard } from "../types";
import { Button, buttonClasses, ErrorNotice, Spinner } from "@/shared/ui";
import { createFlashcards, fetchSavedFlashcards } from "./api";
import { cardCounter, deckActionForEvent, deckStep, START, type DeckAction } from "./deck";

export type FlashcardsTabProps = {
  mapId: string;
  skill: SkillNode;
};

/** Rendered inside the skill panel on the map, below the teach-back. */
export function FlashcardsTab({ mapId, skill }: FlashcardsTabProps) {
  // Stays mounted whatever the body shows, so focus has somewhere to land.
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <section className="border-t border-rule pt-5">
      <h3 ref={heading} tabIndex={-1} className="mb-1 text-base font-semibold outline-none">
        Flashcards
      </h3>
      {/* Keyed, so opening another skill starts from a clean slate. */}
      <FlashcardsBody
        key={`${mapId}/${skill.id}`}
        mapId={mapId}
        skill={skill}
        focusHeading={() => heading.current?.focus()}
      />
    </section>
  );
}

/**
 * A failed generation stays in "none" with its message, so the Make flashcards button the
 * learner pressed stays mounted and keeps focus. It is also how they try again.
 */
type Phase =
  | { kind: "loading" }
  | { kind: "none"; error?: string }
  | { kind: "generating" }
  | { kind: "ready"; cards: Flashcard[]; justMade: boolean }
  | { kind: "loadError"; message: string };

function FlashcardsBody({ mapId, skill, focusHeading }: FlashcardsTabProps & { focusHeading: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [loadCount, setLoadCount] = useState(0);

  // The cheap read only. Making cards costs a model call, so it waits for a click.
  useEffect(() => {
    let cancelled = false;
    fetchSavedFlashcards(mapId, skill.id).then((result) => {
      if (cancelled) return;
      if (!result.ok) setPhase({ kind: "loadError", message: result.message });
      else if (result.items) setPhase({ kind: "ready", cards: result.items, justMade: false });
      else setPhase({ kind: "none" });
    });
    return () => {
      cancelled = true;
    };
  }, [mapId, skill.id, loadCount]);

  function reload() {
    // The Try again button is about to disappear, so move focus first to the heading,
    // which stays. Otherwise a keyboard user would be dropped on the page body.
    focusHeading();
    setPhase({ kind: "loading" });
    setLoadCount((count) => count + 1);
  }

  async function generate() {
    setPhase({ kind: "generating" });
    const result = await createFlashcards(mapId, skill.id);
    setPhase(
      result.ok
        ? { kind: "ready", cards: result.items, justMade: true }
        : { kind: "none", error: result.message },
    );
  }

  switch (phase.kind) {
    case "loading":
      return (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-soft">
          <Spinner size={16} />
          Checking for saved flashcards…
        </p>
      );
    case "none":
    case "generating":
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="text-ink-soft">
            Quick cards to check yourself on {skill.title}, written from this skill&apos;s checkpoints.
          </p>
          <Button variant="secondary" pending={phase.kind === "generating"} onClick={generate}>
            {phase.kind === "generating" ? "Making flashcards" : "Make flashcards"}
          </Button>
          {phase.kind === "generating" && (
            <p role="status" className="text-sm text-ink-soft">
              Writing your flashcards. This takes a few seconds.
            </p>
          )}
          {/* No retry button of its own: Make flashcards above tries again, and keeps focus. */}
          {phase.kind === "none" && phase.error && <ErrorNotice message={phase.error} className="w-full" />}
        </div>
      );
    case "loadError":
      return <ErrorNotice message={phase.message} onRetry={reload} />;
    case "ready":
      return <Deck cards={phase.cards} focusOnMount={phase.justMade} />;
  }
}

function Deck({ cards, focusOnMount }: { cards: Flashcard[]; focusOnMount: boolean }) {
  const [state, setState] = useState(START);
  const cardRef = useRef<HTMLDivElement>(null);
  const total = cards.length;
  const card = cards[state.index];
  const atStart = state.index === 0;
  const atEnd = state.index === total - 1;

  // Cards that were just made replace the button the learner pressed, so focus follows them.
  useEffect(() => {
    if (focusOnMount) cardRef.current?.focus();
  }, [focusOnMount]);

  const act = (action: DeckAction) => setState((current) => deckStep(current, action, total));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const action = deckActionForEvent(event);
    if (!action) return;
    // Stops Space scrolling the panel, only while the card itself has focus.
    event.preventDefault();
    act(action);
  }

  const side = state.flipped ? "Answer" : "Question";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-ink-soft">{cardCounter(state.index, total)}</p>

      <div
        ref={cardRef}
        tabIndex={0}
        role="group"
        aria-roledescription="flashcard"
        aria-label="Flashcard. Space or Enter flips it, the arrow keys move between cards."
        onKeyDown={onKeyDown}
        className={clsx(
          // Taller, roomier card in the full-page view (data-reading-page on the skill panel).
          "min-h-40 rounded-control border-2 bg-paper p-5 lg:in-data-[reading-page]:min-h-56 lg:in-data-[reading-page]:p-8",
          state.flipped ? "border-ink" : "border-control-edge",
        )}
      >
        {/* The live region stays mounted, so each new face is announced. */}
        <div aria-live="polite">
          <div
            key={`${state.index}-${side}`}
            className="flex flex-col gap-2 motion-safe:transition-opacity motion-safe:duration-200 starting:opacity-0"
          >
            <p className="text-sm font-semibold tracking-wide text-ink-soft uppercase">
              <span className="sr-only">{cardCounter(state.index, total)}, </span>
              {side}
            </p>
            <p
              className={
                state.flipped
                  ? "text-base lg:in-data-[reading-page]:text-xl lg:in-data-[reading-page]:leading-8"
                  : "font-display text-lg font-medium lg:in-data-[reading-page]:text-2xl"
              }
            >
              {state.flipped ? card.back : card.front}
            </p>
            {state.flipped && card.citation?.verified && <CardCitation citation={card.citation} />}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Plain buttons, because aria-disabled keeps focus on them at either end of the deck. */}
        <button
          type="button"
          onClick={() => act("previous")}
          aria-disabled={atStart || undefined}
          className={clsx(buttonClasses("subtle", "sm"), "aria-disabled:opacity-60")}
        >
          <ChevronLeft size={18} aria-hidden="true" />
          Previous
        </button>
        <Button variant="secondary" size="sm" onClick={() => act("flip")}>
          <RotateCcw size={18} aria-hidden="true" />
          {state.flipped ? "Show question" : "Show answer"}
        </Button>
        <button
          type="button"
          onClick={() => act("next")}
          aria-disabled={atEnd || undefined}
          className={clsx(buttonClasses("subtle", "sm"), "aria-disabled:opacity-60")}
        >
          Next
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <p className="hidden text-sm text-ink-soft sm:block">
        With a keyboard: focus the card, press Space to flip it, and use the arrow keys to move.
      </p>
    </div>
  );
}

function CardCitation({ citation }: { citation: Citation }) {
  const source = citation.kind === "pdf" ? "the PDF" : "the posting";
  return (
    <figure className="mt-2 flex flex-col gap-1 border-t border-rule pt-3">
      <figcaption className="text-sm text-ink-soft">
        From {source}
        {citation.page ? `, page ${citation.page}` : ""}:
      </figcaption>
      <blockquote className="font-display text-sm leading-6">
        <span className="box-decoration-clone bg-highlight px-1">{citation.quote}</span>
      </blockquote>
    </figure>
  );
}

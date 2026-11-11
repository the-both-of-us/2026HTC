"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Button, ErrorNotice, Spinner } from "@/shared/ui";
import type { PretestResultView } from "../types";
import {
  hasAnyAnswer,
  PretestEnd,
  PretestIntro,
  PretestWaiting,
  UnitQuestions,
  UnitResults,
  type QuestionDraft,
  type UnitDrafts,
} from "./parts";
import type { PretestSession } from "./usePretest";

/** The unit just graded, shown before the next one. */
type Review = {
  unitId: string;
  number: number;
  title: string;
  results: PretestResultView[];
};

const NONE_TEXT = {
  "not-a-course": "A pre-test is only offered on courses built from a topic.",
  "not-ready":
    "The course is still being written. The pre-test opens once its units are planned.",
  "nothing-left":
    "Every topic is proven already, so there is nothing left to skip.",
} as const;

/**
 * The whole pre-test, in place of the map. `nextStep` is the map's next-step view for the end screen
 * (it agrees with the header button). `onProgress` runs after a unit is graded, so the map can show
 * what is now known behind this screen.
 */
export function PretestScreen({
  session,
  nextStep,
  onClose,
  onProgress,
  unitNumbers = {},
}: {
  /** Unit id to its number in the course, for the waiting note. */
  unitNumbers?: Record<string, number>;
  session: PretestSession;
  nextStep: ReactNode;
  onClose: () => void;
  onProgress: () => void;
}) {
  const { view, pending, error } = session;
  const [drafts, setDrafts] = useState<Record<string, UnitDrafts>>({});
  const [review, setReview] = useState<Review | null>(null);

  if (!view) {
    return (
      <Frame status="Loading the pre-test.">
        {error ? (
          <ErrorNotice message={error} onRetry={() => void session.start()} />
        ) : (
          <p className="flex items-center gap-2.5 text-ink-soft">
            <Spinner size={18} />
            Loading the pre-test.
          </p>
        )}
      </Frame>
    );
  }

  async function answer(stop: boolean) {
    const current = view?.current;
    if (!current) return;
    const unitDrafts = drafts[current.unitId] ?? {};
    const next = await session.submit(
      {
        unitId: current.unitId,
        answers: current.questions.map((question) => {
          const draft = unitDrafts[question.topicId];
          return draft?.dontKnow
            ? { topicId: question.topicId, dontKnow: true }
            : {
                topicId: question.topicId,
                answer: draft?.text.trim() ? draft.text : null,
              };
        }),
        ...(stop && { stop: true }),
      },
      (graded) => {
        const results = graded.results.filter(
          (result) => result.unitId === current.unitId,
        );
        if (results.length > 0)
          setReview({
            unitId: current.unitId,
            number: current.number,
            title: current.title,
            results,
          });
      },
    );
    if (next) onProgress();
  }

  async function stopNow() {
    // With something typed on this unit, grade it first so it counts; otherwise just end.
    const current = view?.current;
    if (current && hasAnyAnswer(drafts[current.unitId] ?? {}))
      return answer(true);
    await session.stop();
  }

  function setDraft(unitId: string, topicId: string, draft: QuestionDraft) {
    setDrafts((all) => ({
      ...all,
      [unitId]: { ...all[unitId], [topicId]: draft },
    }));
  }

  // 1. The unit just graded.
  if (review) {
    const last = view.state === "ended";
    return (
      <Frame
        status={`Unit ${review.number} checked. ${review.results.filter((r) => r.outcome === "known").length} known.`}
      >
        <UnitResults
          key={`review-${review.unitId}`}
          unitNumber={review.number}
          unitTitle={review.title}
          results={review.results}
          last={last}
          onContinue={() => setReview(null)}
        />
      </Frame>
    );
  }

  // 2. Over: the summary.
  if (view.state === "ended") {
    return (
      <Frame status="The pre-test is over.">
        <PretestEnd view={view} nextStep={nextStep} onClose={onClose} />
      </Frame>
    );
  }

  // 3. Questions to answer.
  if (view.state === "answering" && view.current) {
    const unit = view.current;
    return (
      <Frame
        status={
          pending === "answers"
            ? "Checking your answers."
            : `Unit ${unit.number} questions are ready.`
        }
      >
        <UnitQuestions
          key={unit.unitId}
          unit={unit}
          unitsTotal={view.unitsTotal}
          drafts={drafts[unit.unitId] ?? {}}
          onChange={(topicId, draft) => setDraft(unit.unitId, topicId, draft)}
          onSubmit={() => void answer(false)}
          onStop={() => void stopNow()}
          pending={pending === "answers" || pending === "stop" ? pending : null}
          error={error}
          maxCharacters={view.maxAnswerCharacters}
        />
      </Frame>
    );
  }

  // 4. Questions are being written.
  if (view.state === "writing" || view.state === "stalled") {
    const number =
      (view.pendingUnitId && unitNumbers[view.pendingUnitId]) ||
      view.unitsDone + 1;
    const stalled =
      view.state === "stalled" && session.stalledForGood && pending === null;
    return (
      <Frame
        status={
          stalled
            ? "The questions could not be written."
            : `Writing the questions for unit ${number}.`
        }
      >
        <PretestWaiting
          what="writing"
          unitNumber={number}
          slow={session.slow}
          stalled={stalled}
          onAskAgain={() => void session.start()}
        />
        {error && <ErrorNotice message={error} />}
        <StopLink
          onStop={() => void session.stop()}
          disabled={pending !== null}
          show
        />
      </Frame>
    );
  }

  // 5. Not started (or no pre-test to take).
  if (view.offer === "none") {
    return (
      <Frame status="">
        <p>
          {view.reason
            ? NONE_TEXT[view.reason]
            : "There is no pre-test for this map."}
        </p>
        <div>
          <Button variant="subtle" onClick={onClose}>
            Back to the map
          </Button>
        </div>
      </Frame>
    );
  }

  return (
    <Frame status="">
      <PretestIntro
        resumed={view.offer === "in-progress"}
        pending={pending === "start"}
        onStart={() => void session.start()}
        onClose={onClose}
      />
      {error && <ErrorNotice message={error} />}
    </Frame>
  );
}

/** Between questions being written, a learner who has answered some can still end it. */
function StopLink({
  onStop,
  disabled,
  show,
}: {
  onStop: () => void;
  disabled: boolean;
  show: boolean;
}) {
  if (!show) return null;
  return (
    <div>
      <Button variant="subtle" onClick={onStop} disabled={disabled}>
        Stop here
      </Button>
    </div>
  );
}

/** The page column and the live region that announces each change. */
function Frame({ status, children }: { status: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <div role="status" aria-live="polite" className="sr-only">
        {status}
      </div>
      {children}
    </div>
  );
}

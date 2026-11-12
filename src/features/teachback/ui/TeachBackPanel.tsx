"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Attempt, NodeState, PublicSkillNode } from "@/shared/types";
import { ErrorNotice, PretestBadge, Spinner } from "@/shared/ui";
import { fetchAttempt, fetchProvenAttempt, submitExplanation, submitFollowUp } from "./api";
import { formatLabel, type TopicFormat } from "../formats";
import { AttemptResult } from "./AttemptResult";
import { CatchResult, CatchRound } from "./CatchRound";
import { clearDraft, loadDraft, saveDraft } from "./draft";
import { ExplainForm } from "./ExplainForm";
import { FollowUpForm } from "./FollowUpForm";
import { FormatBadge } from "./FormatBadge";
import { useYoungLearner } from "./YoungLearner";
import { resultAnnouncement } from "./format";
import { useIntegrity } from "./useIntegrity";

export type TeachBackPanelProps = {
  mapId: string;
  node: PublicSkillNode;
  state: NodeState;
  /**
   * The skill is proved by a pre-test question, not by an explanation. The panel says so and still
   * offers the teach-back; a pass there replaces the pre-test pass.
   */
  pretest?: boolean;
  /** Called once, when this panel's learner proves the skill. */
  onProven: (nodeId: string) => void;
  /** What proving this skill opened. Shown right under the "Proven" verdict. */
  nextStep?: ReactNode;
  /** Opens the evidence page. It comes from the map, which knows how many skills are proven. */
  evidenceAction?: ReactNode;
  /** How this topic is proved. See assignFormats. */
  format?: TopicFormat;
};

/** The teach-back for one skill. Switching skills starts this panel afresh. */
export function TeachBackPanel(props: TeachBackPanelProps) {
  return <Panel key={`${props.mapId}/${props.node.id}`} {...props} />;
}

function Panel({ mapId, node, state, pretest = false, onProven, nextStep, evidenceAction, format = "explain" }: TeachBackPanelProps) {
  // This panel only mounts after a click in the browser, so sessionStorage is safe to read here.
  const [draft] = useState(() => loadDraft(mapId, node.id));
  const young = useYoungLearner();
  const [text, setText] = useState(draft?.text ?? "");
  const [attempt, setAttempt] = useState<Attempt | null>(draft?.openAttempt ?? null);
  const [pending, setPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const integrity = useIntegrity(draft?.integrity);
  // The topic's format, unless the learner swapped to plain "Explain it" (once per topic).
  const [swapped, setSwapped] = useState(draft?.swapped ?? false);
  const active: TopicFormat = swapped ? "explain" : format;

  // Keep what the learner has so far, so clicking another skill or reloading loses nothing.
  useEffect(() => {
    if (state === "proven" && !pretest) return;
    saveDraft(mapId, node.id, {
      text,
      openAttempt: attempt?.status === "needs-followup" ? attempt : null,
      integrity: integrity.toSave(),
      swapped,
    });
  }, [mapId, node.id, state, pretest, text, attempt, integrity, swapped]);

  const resultHeading = useRef<HTMLHeadingElement>(null);
  const followUpArea = useRef<HTMLDivElement>(null);
  const shouldFocusResult = useRef(false);

  // For the evidence page: how long after the question appeared the learner began to answer.
  // Unknown after a reload, because this panel didn't see the question appear.
  const questionShownAt = useRef<number | null>(null);
  const startedAfterMs = useRef<number | undefined>(undefined);
  function markBegan() {
    if (startedAfterMs.current === undefined && questionShownAt.current !== null) {
      startedAfterMs.current = Date.now() - questionShownAt.current;
    }
  }

  // Move focus to a result the learner just asked for, once it is on screen. A follow-up
  // question needs an answer right away, so it goes straight to the answer box.
  useEffect(() => {
    if (!shouldFocusResult.current) return;
    shouldFocusResult.current = false;
    if (attempt?.status === "needs-followup") {
      followUpArea.current?.scrollIntoView({ block: "start" });
      followUpArea.current?.querySelector<HTMLElement>("textarea, button")?.focus({ preventScroll: true });
    } else {
      resultHeading.current?.focus();
    }
  }, [attempt]);

  function showResult(next: Attempt) {
    shouldFocusResult.current = true;
    if (next.status === "needs-followup") {
      questionShownAt.current = Date.now();
      startedAfterMs.current = undefined;
    }
    setAttempt(next);
    // A catch round's checkpoints are its planted mistakes, not the topic's checkpoints.
    const total = next.format === "catch" ? next.grade.checkpoints.length : node.checkpointCount;
    setAnnouncement(resultAnnouncement(next, node.title, total));
    if (next.status === "proven") {
      clearDraft(mapId, node.id);
      onProven(node.id);
    }
  }

  async function sendExplanation() {
    const explanation = text.trim();
    setPending(true);
    setRequestError(null);
    setAnnouncement("Checking your explanation.");

    const result = await submitExplanation({
      mapId,
      nodeId: node.id,
      explanation,
      integrity: integrity.signalsFor(explanation),
      ...(active !== "explain" && { format: active }),
    });

    setPending(false);
    if (result.ok) {
      showResult(result.attempt);
      return;
    }

    // 409 here means the skill is already proven, and the reply saying so never arrived.
    const proven = result.status === 409 ? await fetchProvenAttempt(mapId, node.id) : null;
    if (proven?.ok) showResult(proven.attempt);
    else setRequestError(result.message);
  }

  /** Sends the answer. Returns the finished attempt, or null once the error is on screen. */
  async function sendFollowUp(attemptId: string, answer: string): Promise<Attempt | null> {
    setPending(true);
    setRequestError(null);
    setAnnouncement("Checking your answer.");

    const result = await submitFollowUp(attemptId, answer, { startedAfterMs: startedAfterMs.current });

    setPending(false);
    if (result.ok) return result.attempt;

    // 409 means this answer was already sent: the reply was lost, or another click sent it.
    // Ask the server what became of it. While it is still being checked, the form stays.
    const saved = result.status === 409 ? await fetchAttempt(attemptId) : null;
    if (saved?.ok && saved.attempt.status !== "needs-followup") return saved.attempt;
    setRequestError(result.message);
    return null;
  }

  async function sendTypedFollowUp(attemptId: string, answer: string) {
    const finished = await sendFollowUp(attemptId, answer);
    if (finished) finishFollowUp(finished);
  }

  function finishFollowUp(finished: Attempt) {
    // This panel may have closed while grading ran, and only the draft outlives it.
    // Without this, coming back would show a question that can't be answered again.
    saveDraft(mapId, node.id, { text, openAttempt: null, integrity: integrity.toSave(), swapped });
    showResult(finished);
  }

  const liveRegion = (
    <div role="status" aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );

  function swapToExplain() {
    setSwapped(true);
    setAttempt(null);
    setRequestError(null);
  }

  // A proven skill with no result in memory: this panel was opened after the fact.
  if (state === "proven" && attempt?.status !== "proven" && !pretest) {
    return (
      <>
        {liveRegion}
        <ProvenSummary mapId={mapId} node={node} evidenceAction={evidenceAction} />
      </>
    );
  }

  const catchResult = attempt?.format === "catch";
  const formatHeader = !(attempt?.status === "proven") && (
    <div className="flex flex-col items-start gap-2">
      <FormatBadge format={active} />
      <p className="text-sm text-ink-soft">{formatLabel(active, young).prompt}</p>
      {/* One swap per topic, and only before a follow-up question is waiting. */}
      {format !== "explain" && !swapped && attempt?.status !== "needs-followup" && !catchResult && (
        <button
          type="button"
          onClick={swapToExplain}
          className="cursor-pointer text-sm text-accent-bright underline underline-offset-4"
        >
          Not feeling it? Swap to plain &ldquo;Explain it&rdquo; (once per topic)
        </button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      {liveRegion}
      {pretest && attempt?.status !== "proven" && <PretestKnownNote title={node.title} />}
      {formatHeader}

      {attempt && catchResult && (
        <CatchResult
          attempt={attempt}
          headingRef={resultHeading}
          nextStep={nextStep}
          evidenceAction={evidenceAction}
          onExplainInstead={swapToExplain}
        />
      )}

      {active === "catch" && !attempt && (
        <CatchRound mapId={mapId} nodeId={node.id} integrity={integrity} onResult={showResult} onExplainInstead={swapToExplain} />
      )}

      {attempt && !catchResult && (
        <AttemptResult
          attempt={attempt}
          skillTitle={node.title}
          checkpointTotal={node.checkpointCount}
          headingRef={resultHeading}
          nextStep={nextStep}
          evidenceAction={evidenceAction}
        >
          {attempt.status === "needs-followup" && attempt.followUp && (
            <div ref={followUpArea} className="scroll-mt-4">
              <FollowUpForm
                attemptId={attempt.id}
                question={attempt.followUp.question}
                pending={pending}
                requestError={requestError}
                onBegin={markBegan}
                onSubmit={(answer) => sendTypedFollowUp(attempt.id, answer)}
              />
            </div>
          )}
        </AttemptResult>
      )}

      {active !== "catch" && (!attempt || attempt.status === "not-yet") && (
        <ExplainForm
          format={active}
          nodeId={node.id}
          skillTitle={node.title}
          checkpointCount={node.checkpointCount}
          text={text}
          onTextChange={setText}
          integrity={integrity}
          revising={attempt !== null}
          pending={pending}
          requestError={requestError}
          onSubmit={sendExplanation}
        />
      )}
    </div>
  );
}

/** A topic proved by a pre-test question: said as that, with no explanation, transcript or score to show. */
function PretestKnownNote({ title }: { title: string }) {
  return (
    <section aria-label="Known from the pre-test" className="flex flex-col items-start gap-2 rounded-sheet border border-dashed border-ink-soft p-4">
      <PretestBadge />
      <h3 className="text-lg font-semibold">{title}: known from the pre-test</h3>
      <p className="text-ink-soft">
        You passed a pre-test question on this topic, so it counts as done. Nothing more is required, and the lesson, flashcards and
        quiz stay open. If you explain it below and pass, that replaces the pre-test mark.
      </p>
    </section>
  );
}

/** Loads and shows the attempt that proved this skill. */
function ProvenSummary({
  mapId,
  node,
  evidenceAction,
}: {
  mapId: string;
  node: PublicSkillNode;
  evidenceAction?: ReactNode;
}) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [failed, setFailed] = useState(false);
  const [byPretest, setByPretest] = useState(false);
  const [loadCount, setLoadCount] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let current = true;
    fetchProvenAttempt(mapId, node.id).then((result) => {
      if (!current) return;
      if (result.ok) setAttempt(result.attempt);
      else if ("pretest" in result) setByPretest(true);
      else setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [mapId, node.id, loadCount]);

  if (byPretest) return <PretestKnownNote title={node.title} />;

  if (attempt?.format === "catch") {
    return <CatchResult attempt={attempt} headingRef={heading} evidenceAction={evidenceAction} />;
  }

  if (attempt) {
    return (
      <AttemptResult
        attempt={attempt}
        skillTitle={node.title}
        checkpointTotal={node.checkpointCount}
        headingRef={heading}
        evidenceAction={evidenceAction}
      />
    );
  }

  if (failed) {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-xl font-semibold">{node.title} is proven</h3>
        <ErrorNotice
          message="Your result could not be loaded just now. The skill is still proven."
          onRetry={() => {
            setFailed(false);
            setLoadCount((count) => count + 1);
          }}
        />
      </div>
    );
  }

  return (
    <p role="status" className="flex items-center gap-2.5 text-ink-soft">
      <Spinner size={18} className="shrink-0" />
      Loading your result.
    </p>
  );
}

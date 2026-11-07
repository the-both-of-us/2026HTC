"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Attempt, NodeState, PublicSkillNode } from "@/shared/types";
import { ErrorNotice, Spinner } from "@/shared/ui";
import { fetchAttempt, fetchProvenAttempt, submitExplanation, submitFollowUp } from "./api";
import { AttemptResult } from "./AttemptResult";
import { clearDraft, loadDraft, saveDraft } from "./draft";
import { ExplainForm } from "./ExplainForm";
import { FollowUpForm } from "./FollowUpForm";
import { resultAnnouncement } from "./format";
import { useIntegrity } from "./useIntegrity";

export type TeachBackPanelProps = {
  mapId: string;
  node: PublicSkillNode;
  state: NodeState;
  /** Called once, when this panel's learner proves the skill. */
  onProven: (nodeId: string) => void;
  /** What proving this skill opened. Shown right under the "Proven" verdict. */
  nextStep?: ReactNode;
  /** Opens the evidence page. It comes from the map, which knows how many skills are proven. */
  evidenceAction?: ReactNode;
};

/** The teach-back for one skill. Switching skills starts this panel afresh. */
export function TeachBackPanel(props: TeachBackPanelProps) {
  return <Panel key={`${props.mapId}/${props.node.id}`} {...props} />;
}

function Panel({ mapId, node, state, onProven, nextStep, evidenceAction }: TeachBackPanelProps) {
  // This panel only mounts after a click in the browser, so sessionStorage is safe to read here.
  const [draft] = useState(() => loadDraft(mapId, node.id));
  const [text, setText] = useState(draft?.text ?? "");
  const [attempt, setAttempt] = useState<Attempt | null>(draft?.openAttempt ?? null);
  const [pending, setPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const integrity = useIntegrity(draft?.integrity);

  // Keep what the learner has so far, so clicking another skill or reloading loses nothing.
  useEffect(() => {
    if (state === "proven") return;
    saveDraft(mapId, node.id, {
      text,
      openAttempt: attempt?.status === "needs-followup" ? attempt : null,
      integrity: integrity.toSave(),
    });
  }, [mapId, node.id, state, text, attempt, integrity]);

  const resultHeading = useRef<HTMLHeadingElement>(null);
  const followUpForm = useRef<HTMLFormElement>(null);
  const shouldFocusResult = useRef(false);

  // Move focus to a result the learner just asked for, once it is on screen. A follow-up
  // question needs an answer right away, so it goes straight to the answer box.
  useEffect(() => {
    if (!shouldFocusResult.current) return;
    shouldFocusResult.current = false;
    if (attempt?.status === "needs-followup") {
      followUpForm.current?.scrollIntoView({ block: "start" });
      followUpForm.current?.querySelector("textarea")?.focus({ preventScroll: true });
    } else {
      resultHeading.current?.focus();
    }
  }, [attempt]);

  function showResult(next: Attempt) {
    shouldFocusResult.current = true;
    setAttempt(next);
    setAnnouncement(resultAnnouncement(next, node.title, node.checkpointCount));
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

  async function sendFollowUp(attemptId: string, answer: string) {
    setPending(true);
    setRequestError(null);
    setAnnouncement("Checking your answer.");

    const result = await submitFollowUp(attemptId, answer);

    setPending(false);
    if (result.ok) {
      finishFollowUp(result.attempt);
      return;
    }

    // 409 means this answer was already sent: the reply was lost, or another click sent it.
    // Ask the server what became of it. While it is still being checked, the form stays.
    const saved = result.status === 409 ? await fetchAttempt(attemptId) : null;
    if (saved?.ok && saved.attempt.status !== "needs-followup") finishFollowUp(saved.attempt);
    else setRequestError(result.message);
  }

  function finishFollowUp(finished: Attempt) {
    // This panel may have closed while grading ran, and only the draft outlives it.
    // Without this, coming back would show a question that can't be answered again.
    saveDraft(mapId, node.id, { text, openAttempt: null, integrity: integrity.toSave() });
    showResult(finished);
  }

  const liveRegion = (
    <div role="status" aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );

  // A proven skill with no result in memory: this panel was opened after the fact.
  if (state === "proven" && attempt?.status !== "proven") {
    return (
      <>
        {liveRegion}
        <ProvenSummary mapId={mapId} node={node} evidenceAction={evidenceAction} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {liveRegion}

      {attempt && (
        <AttemptResult
          attempt={attempt}
          skillTitle={node.title}
          checkpointTotal={node.checkpointCount}
          headingRef={resultHeading}
          nextStep={nextStep}
          evidenceAction={evidenceAction}
        >
          {attempt.status === "needs-followup" && attempt.followUp && (
            <FollowUpForm
              attemptId={attempt.id}
              question={attempt.followUp.question}
              pending={pending}
              requestError={requestError}
              onSubmit={(answer) => sendFollowUp(attempt.id, answer)}
              formRef={followUpForm}
            />
          )}
        </AttemptResult>
      )}

      {(!attempt || attempt.status === "not-yet") && (
        <ExplainForm
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
  const [loadCount, setLoadCount] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let current = true;
    fetchProvenAttempt(mapId, node.id).then((result) => {
      if (!current) return;
      if (result.ok) setAttempt(result.attempt);
      else setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [mapId, node.id, loadCount]);

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

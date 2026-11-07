"use client";

import { useEffect, useRef, useState } from "react";
import type { Attempt, NodeState, PublicSkillNode } from "@/shared/types";
import { ErrorNotice, Spinner } from "@/shared/ui";
import { fetchProvenAttempt, submitExplanation, submitFollowUp } from "./api";
import { AttemptResult } from "./AttemptResult";
import { ExplainForm } from "./ExplainForm";
import { FollowUpForm } from "./FollowUpForm";
import { resultAnnouncement, titleFromId } from "./format";
import { LockedNotice } from "./LockedNotice";
import { useIntegrity } from "./useIntegrity";

export type TeachBackPanelProps = {
  mapId: string;
  node: PublicSkillNode;
  state: NodeState;
  /** Called once, when this panel's learner proves the skill. */
  onProven: (nodeId: string) => void;
  /** Titles of the prerequisites still to prove. Without it, titles are made from the node's ids. */
  missingPrerequisites?: string[];
};

/** The teach-back for one skill. Switching skills starts this panel afresh. */
export function TeachBackPanel(props: TeachBackPanelProps) {
  return <Panel key={`${props.mapId}/${props.node.id}`} {...props} />;
}

function Panel({ mapId, node, state, onProven, missingPrerequisites }: TeachBackPanelProps) {
  const [text, setText] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [pending, setPending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const integrity = useIntegrity();

  const resultHeading = useRef<HTMLHeadingElement>(null);
  const shouldFocusResult = useRef(false);

  // Move focus to a result the learner just asked for, once it is on screen.
  useEffect(() => {
    if (!shouldFocusResult.current) return;
    shouldFocusResult.current = false;
    resultHeading.current?.focus();
  }, [attempt]);

  function showResult(next: Attempt) {
    shouldFocusResult.current = true;
    setAttempt(next);
    setAnnouncement(resultAnnouncement(next, node.title, node.checkpointCount));
    if (next.status === "proven") onProven(node.id);
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
    if (result.ok) showResult(result.attempt);
    else setRequestError(result.message);
  }

  async function sendFollowUp(attemptId: string, answer: string) {
    setPending(true);
    setRequestError(null);
    setAnnouncement("Checking your answer.");

    const result = await submitFollowUp(attemptId, answer);

    setPending(false);
    if (result.ok) showResult(result.attempt);
    else setRequestError(result.message);
  }

  const liveRegion = (
    <div role="status" aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );

  // A proven skill with no result in memory: this panel was opened after the fact.
  if (state === "proven" && !attempt) {
    return (
      <>
        {liveRegion}
        <ProvenSummary mapId={mapId} node={node} />
      </>
    );
  }

  if (state === "locked" && !attempt) {
    const missing = missingPrerequisites ?? node.prerequisites.map(titleFromId);
    return <LockedNotice skillTitle={node.title} prerequisites={missing} />;
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
        />
      )}

      {attempt?.status === "needs-followup" && attempt.followUp && (
        <FollowUpForm
          attemptId={attempt.id}
          question={attempt.followUp.question}
          pending={pending}
          requestError={requestError}
          onSubmit={(answer) => sendFollowUp(attempt.id, answer)}
        />
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
function ProvenSummary({ mapId, node }: { mapId: string; node: PublicSkillNode }) {
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

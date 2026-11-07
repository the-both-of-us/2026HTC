"use client";

import clsx from "clsx";
import { Check, Lock, Trophy, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { VoiceInterview, type InputMethod, type VoiceVerdict } from "@/features/voice/client";
import { Button, ErrorNotice } from "@/shared/ui";
import type { FinalView } from "../final";
import { fetchFinal, startFinal, submitFollowUp } from "./api";
import { FollowUpForm } from "./FollowUpForm";
import "./challenges.css";

type FinalInterviewProps = {
  mapId: string;
  provenCount: number;
  topicCount: number;
  voiceReady: boolean;
};

/**
 * The course boss. Locked until every topic is proven, then three questions that mix
 * topics, spoken or typed. Two passes earn the course badge.
 */
export function FinalInterview({ mapId, provenCount, topicCount, voiceReady }: FinalInterviewProps) {
  const allProven = topicCount > 0 && provenCount === topicCount;
  const [view, setView] = useState<FinalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [justPassed, setJustPassed] = useState(false);
  const [loadCount, setLoadCount] = useState(0);

  useEffect(() => {
    let current = true;
    fetchFinal(mapId).then((result) => {
      if (!current) return;
      if (result.ok) setView(result.data);
      else setError(result.message);
    });
    return () => {
      current = false;
    };
  }, [mapId, allProven, loadCount]);

  async function start() {
    setPending(true);
    setError(null);
    const result = await startFinal(mapId);
    setPending(false);
    if (result.ok) setView(result.data);
    else setError(result.message);
  }

  /** After each answer: load where it stands, and celebrate if that settled it as a pass. */
  async function refresh() {
    const result = await fetchFinal(mapId);
    if (!result.ok) return setLoadCount((count) => count + 1);
    if (result.data.state === "passed" && view?.state !== "passed") setJustPassed(true);
    setView(result.data);
  }

  async function answer(attemptId: string, text: string, inputMethod: InputMethod): Promise<VoiceVerdict> {
    setPending(true);
    setError(null);
    const result = await submitFollowUp(attemptId, text, { inputMethod });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      throw new Error("The answer was not sent.");
    }
    return { passed: result.attempt.followUp?.passed === true, feedback: result.attempt.followUp?.feedback ?? null };
  }

  if (!view) {
    return error ? <Strip><ErrorNotice message={error} onRetry={() => { setError(null); setLoadCount((count) => count + 1); }} /></Strip> : null;
  }

  if (view.state === "locked") {
    return (
      <Strip>
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Lock aria-hidden="true" size={15} className="shrink-0" />
          <span>
            <span className="font-medium text-ink">Final interview</span> unlocks when every topic is proven.{" "}
            <span className="tabular-nums">{topicCount - provenCount} to go.</span>
          </span>
        </p>
      </Strip>
    );
  }

  if (view.state === "passed") {
    return (
      <Strip tone="gold">
        <div className="relative flex items-center gap-3">
          <span className={clsx("relative flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-amber bg-amber/15 text-amber", justPassed && "badge-rise")}>
            <Trophy aria-hidden="true" size={22} />
            {justPassed && <Burst />}
          </span>
          <div role="status">
            <p className="font-semibold">{justPassed ? "Course badge earned!" : "Course badge"}</p>
            <p className="text-sm text-ink-soft">
              Passed the final interview, {view.result?.passedCount} of {view.questions.length}. It&apos;s on your evidence page.
            </p>
          </div>
        </div>
      </Strip>
    );
  }

  if (view.state === "ready" || view.state === "failed") {
    return (
      <Strip tone="gold">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Trophy aria-hidden="true" size={22} className="mt-0.5 shrink-0 text-amber" />
            <div>
              <p className="font-semibold">
                {view.state === "failed"
                  ? `Final interview: ${view.result?.passedCount} of ${view.questions.length}. Two passes win it.`
                  : "Boss level: the final interview is open."}
              </p>
              <p className="text-sm text-ink-soft">
                {view.state === "failed"
                  ? "Try a fresh set of questions. They mix different topics each time."
                  : "Three questions that mix your topics. Say or type each answer. Pass two for the course badge."}
              </p>
            </div>
          </div>
          <Button pending={pending} onClick={start} className="shrink-0">
            {view.state === "failed" ? "Try a fresh set" : "Start the final interview"}
          </Button>
        </div>
        {error && <p className="mt-2 text-sm font-semibold text-danger">{error}</p>}
      </Strip>
    );
  }

  // In progress: the first unanswered question, with the others as dots.
  const index = view.questions.findIndex((question) => question.passed === null);
  const current = view.questions[index];

  return (
    <Strip tone="gold">
      <div className="flex flex-col gap-4 lg:max-h-[55dvh] lg:overflow-y-auto">
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-semibold">
            Final interview, question {index + 1} of {view.questions.length}
          </p>
          <ol className="flex gap-1.5" aria-label="Your answers so far">
            {view.questions.map((question, number) => (
              <li
                key={question.attemptId}
                className={clsx(
                  "flex size-6 items-center justify-center rounded-full border text-xs",
                  question.passed === true && "border-proven bg-proven text-paper",
                  question.passed === false && "border-amber text-amber",
                  question.passed === null && "border-rule-strong text-ink-soft",
                )}
              >
                {question.passed === true ? <Check aria-label="Passed" size={13} /> : question.passed === false ? <X aria-label="Not passed" size={13} /> : number + 1}
              </li>
            ))}
          </ol>
        </div>
        {current && (
          <>
            <p className="text-sm text-ink-soft">Mixes {current.topics.join(" and ") || "your topics"}.</p>
            {voiceReady ? (
              <VoiceInterview
                key={current.attemptId}
                attemptId={current.attemptId}
                question={current.question}
                onAnswer={(text, inputMethod) => answer(current.attemptId, text, inputMethod)}
                onContinue={refresh}
                onTypeInstead={() => {}}
              />
            ) : (
              <FollowUpForm
                key={current.attemptId}
                attemptId={current.attemptId}
                question={current.question}
                pending={pending}
                requestError={error}
                onBegin={() => {}}
                onSubmit={async (text) => {
                  const verdict = await answer(current.attemptId, text, "typed").catch(() => null);
                  if (verdict) await refresh();
                }}
              />
            )}
          </>
        )}
      </div>
    </Strip>
  );
}

function Strip({ children, tone }: { children: ReactNode; tone?: "gold" }) {
  return (
    <section
      aria-label="Final interview"
      className={clsx(
        "border-b px-4 py-3 sm:px-6",
        tone === "gold" ? "border-amber/40 bg-amber/5" : "border-rule",
      )}
    >
      {children}
    </section>
  );
}

const BURST_COLOURS = ["var(--color-amber)", "var(--color-proven)", "var(--color-accent-bright)"];

/** Fourteen bits of colour that fly out from the badge, once. */
function Burst() {
  return (
    <span aria-hidden="true">
      {Array.from({ length: 14 }, (_, index) => {
        const angle = (index / 14) * Math.PI * 2;
        const distance = 46 + (index % 3) * 14;
        const style = {
          "--burst-x": `${Math.cos(angle) * distance}px`,
          "--burst-y": `${Math.sin(angle) * distance}px`,
          background: BURST_COLOURS[index % BURST_COLOURS.length],
          animationDelay: `${(index % 4) * 40}ms`,
        } as CSSProperties;
        return <span key={index} className="burst-bit" style={style} />;
      })}
    </span>
  );
}

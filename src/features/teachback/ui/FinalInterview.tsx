"use client";

import clsx from "clsx";
import { Check, Lock, Trophy, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Button, ErrorNotice } from "@/shared/ui";
import type { FinalView } from "../final";
import { fetchFinal, startFinal, submitFollowUp } from "./api";
import { FollowUpForm } from "./FollowUpForm";
import "./challenges.css";

type FinalInterviewProps = {
  mapId: string;
  provenCount: number;
  topicCount: number;
  /** Set for a degree unit's test instead of the course final. */
  unitId?: string;
  unitTitle?: string;
};

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The course boss. Locked until every topic is proven, then questions that mix topics, typed: three with two passes for the course badge, or as many as the server says (a degree
 * course's final, or a unit's test when `unitId` is given).
 */
export function FinalInterview({ mapId, provenCount, topicCount, unitId, unitTitle }: FinalInterviewProps) {
  const allProven = topicCount > 0 && provenCount === topicCount;
  const isUnit = unitId !== undefined;
  const name = isUnit ? "Unit test" : "Final interview";
  const [view, setView] = useState<FinalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [justPassed, setJustPassed] = useState(false);
  const [loadCount, setLoadCount] = useState(0);

  useEffect(() => {
    let current = true;
    fetchFinal(mapId, unitId).then((result) => {
      if (!current) return;
      if (result.ok) setView(result.data);
      else setError(result.message);
    });
    return () => {
      current = false;
    };
  }, [mapId, unitId, allProven, loadCount]);

  async function start() {
    setPending(true);
    setError(null);
    const result = await startFinal(mapId, unitId);
    setPending(false);
    if (result.ok) setView(result.data);
    else setError(result.message);
  }

  /** After each answer: load where it stands, and celebrate if that settled it as a pass. */
  async function refresh() {
    const result = await fetchFinal(mapId, unitId);
    if (!result.ok) return setLoadCount((count) => count + 1);
    if (result.data.state === "passed" && view?.state !== "passed") setJustPassed(true);
    setView(result.data);
  }

  /** Sends one typed answer. Returns false once the error is on screen. */
  async function answer(attemptId: string, text: string): Promise<boolean> {
    setPending(true);
    setError(null);
    const result = await submitFollowUp(attemptId, text);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    return true;
  }

  if (!view) {
    return error ? <Strip label={name}><ErrorNotice message={error} onRetry={() => { setError(null); setLoadCount((count) => count + 1); }} /></Strip> : null;
  }

  const questionCount = view.questionCount ?? 3;
  const passMark = view.passMark ?? 2;

  if (view.state === "locked") {
    return (
      <Strip label={name}>
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Lock aria-hidden="true" size={15} className="shrink-0" />
          {allProven && !isUnit ? (
            <span>
              <span className="font-medium text-ink">Final interview</span> unlocks once every unit test is passed.
            </span>
          ) : (
            <span>
              <span className="font-medium text-ink">{name}</span> unlocks when every topic{isUnit ? " in this unit" : ""} is proven.{" "}
              <span className="tabular-nums">{topicCount - provenCount} to go.</span>
            </span>
          )}
        </p>
      </Strip>
    );
  }

  if (view.state === "passed" && isUnit) {
    return (
      <Strip label={name}>
        <p role="status" className="flex items-center gap-2 text-sm text-ink-soft">
          <Check aria-hidden="true" size={15} className="shrink-0 text-proven" />
          <span>
            <span className="font-medium text-ink">Unit test passed{unitTitle ? `: ${unitTitle}` : ""}</span>, {view.result?.passedCount} of{" "}
            {view.questions.length}.
          </span>
        </p>
      </Strip>
    );
  }

  if (view.state === "passed") {
    return (
      <Strip tone="gold" label={name}>
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
    const reward = isUnit ? "to pass the unit" : "for the course badge";
    return (
      <Strip tone="gold" label={name}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Trophy aria-hidden="true" size={22} className="mt-0.5 shrink-0 text-amber" />
            <div>
              <p className="font-semibold">
                {view.state === "failed"
                  ? `${name}: ${view.result?.passedCount} of ${view.questions.length}. ${capitalized(numberWord(passMark))} passes win it.`
                  : isUnit
                    ? `The test for ${unitTitle ? `"${unitTitle}"` : "this unit"} is open.`
                    : "Boss level: the final interview is open."}
              </p>
              <p className="text-sm text-ink-soft">
                {view.state === "failed"
                  ? "Try a fresh set of questions. They mix different topics each time."
                  : `${capitalized(numberWord(questionCount))} questions that mix your topics. Type each answer. Pass ${numberWord(passMark)} ${reward}.`}
              </p>
            </div>
          </div>
          <Button pending={pending} onClick={start} className="shrink-0">
            {view.state === "failed" ? "Try a fresh set" : isUnit ? "Start the unit test" : "Start the final interview"}
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
    <Strip tone="gold" label={name}>
      <div className="flex flex-col gap-4 lg:max-h-[55dvh] lg:overflow-y-auto">
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-semibold">
            {name}, question {index + 1} of {view.questions.length}
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
            <FollowUpForm
              key={current.attemptId}
              attemptId={current.attemptId}
              question={current.question}
              pending={pending}
              requestError={error}
              onBegin={() => {}}
              onSubmit={async (text) => {
                if (await answer(current.attemptId, text)) await refresh();
              }}
            />
          </>
        )}
      </div>
    </Strip>
  );
}

function Strip({ children, tone, label }: { children: ReactNode; tone?: "gold"; label: string }) {
  return (
    <section
      aria-label={label}
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

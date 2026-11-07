"use client";

import { Lightbulb } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, ErrorNotice, Field, InlineText, Textarea } from "@/shared/ui";
import { postRelight } from "./api";

const SECONDS = 60;
const FADE_WORDS = ["", "is starting to fade", "is fading", "has nearly gone dark"];
const FADE_DAYS = ["", "3", "7", "14"];

type RelightCheckProps = { mapId: string; nodeId: string; title: string; dim: number; onRelit: (nodeId: string) => void };

type Step =
  | { kind: "idle" }
  | { kind: "asking"; question: string }
  | { kind: "missed"; question: string }
  | { kind: "relit"; feedback: string };

/**
 * A 60-second check that relights a fading topic. Fading is a nudge to remember, nothing more:
 * the topic stays proved on the evidence page either way.
 */
export function RelightCheck({ mapId, nodeId, title, dim, onRelit }: RelightCheckProps) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [answer, setAnswer] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(SECONDS);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asking = step.kind === "asking" || step.kind === "missed";
  useEffect(() => {
    if (!asking) return;
    const timer = setInterval(() => setSecondsLeft((left) => Math.max(0, left - 1)), 1000);
    return () => clearInterval(timer);
  }, [asking]);

  async function begin() {
    setPending(true);
    setError(null);
    const reply = await postRelight(mapId, nodeId);
    setPending(false);
    if (!reply.ok) return setError(reply.message);
    setAnswer("");
    setSecondsLeft(SECONDS);
    setStep({ kind: "asking", question: reply.question ?? "" });
  }

  async function send(question: string) {
    setPending(true);
    setError(null);
    const reply = await postRelight(mapId, nodeId, answer);
    setPending(false);
    if (!reply.ok) return setError(reply.message);
    if (reply.passed) {
      setStep({ kind: "relit", feedback: reply.feedback ?? "" });
      onRelit(nodeId);
    } else {
      setStep({ kind: "missed", question });
    }
  }

  // A lit topic has nothing to relight. This shows when the panel reopens after a relight.
  if (dim === 0 && step.kind === "idle") return null;

  return (
    <section aria-labelledby="relight-title" className="flex flex-col gap-3 rounded-sheet border border-amber/50 bg-amber/5 p-4">
      <h3 id="relight-title" className="flex items-center gap-2 font-medium">
        <Lightbulb aria-hidden="true" size={17} className="text-amber" />
        {step.kind === "relit" ? `${title} is lit again` : `${title} ${FADE_WORDS[dim] ?? "is fading"}`}
      </h3>

      {step.kind === "idle" && (
        <>
          <p className="text-ink-soft">
            You proved it {FADE_DAYS[dim] ?? "a few"}+ days ago. Remembering it now is what makes it stick.
            One question, about a minute. It stays proved on your evidence page either way.
          </p>
          <Button onClick={begin} pending={pending} className="self-start">
            Relight it
          </Button>
        </>
      )}

      {asking && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send(step.question);
          }}
        >
          <p className="font-medium">
            <InlineText text={step.question} />
          </p>
          <Field
            id="relight-answer"
            label="Your answer"
            hint={secondsLeft > 0 ? `${secondsLeft} seconds left` : "Time's up. Send what you have, there's no penalty."}
          >
            {(control) => (
              <Textarea {...control} rows={3} value={answer} onChange={(event) => setAnswer(event.target.value)} />
            )}
          </Field>
          {step.kind === "missed" && (
            <p role="status" className="text-ink-soft">
              Not quite yet. Have another go: think of an example you used before.
            </p>
          )}
          <Button type="submit" pending={pending} disabled={answer.trim() === ""} className="self-start">
            Check my answer
          </Button>
        </form>
      )}

      {step.kind === "relit" && (
        <p role="status">
          {step.feedback} It will stay bright for a few more days.
        </p>
      )}

      {error && <ErrorNotice message={error} onRetry={() => (asking ? send(step.question) : begin())} />}
    </section>
  );
}

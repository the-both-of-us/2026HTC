"use client";

/**
 * Review only: shows each state of the interview, driven by pretend audio, or with
 * ?real=1 runs the real adapters against the real routes. Removed before the final merge.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createMockAdapters, speechLikeMeter } from "../adapters/mock";
import { INITIAL_VOICE_STATE, type FallbackReason, type VoicePhase, type VoiceState, type VoiceVerdict } from "../machine";
import { applyTurn, EMPTY_TRANSCRIPT, settle, type Transcript } from "../transcript";
import { VoiceInterview } from "./VoiceInterview";

const QUESTION = "You said the insulation sets the limit. What actually happens to it when the transformer runs hot for hours?";
const ANSWER =
  "The heat breaks down the paper insulation over time. Each extra few degrees makes it age faster, so eventually it can't hold back the voltage and the winding fails.";

function transcriptOf(interimWords = 0): Transcript {
  const sentences = ANSWER.split(/(?<=\.)\s+/);
  let transcript = applyTurn(EMPTY_TRANSCRIPT, { event: "EndOfTurn", turnIndex: 0, transcript: sentences[0], sequenceId: 1 });
  if (interimWords) {
    const partial = sentences[1].split(" ").slice(0, interimWords).join(" ");
    transcript = applyTurn(transcript, { event: "Update", turnIndex: 1, transcript: partial, sequenceId: 2 });
  } else {
    transcript = applyTurn(transcript, { event: "EndOfTurn", turnIndex: 1, transcript: sentences[1], sequenceId: 2 });
  }
  return transcript;
}

const PASSED: VoiceVerdict = {
  passed: true,
  feedback: "That's it: heat speeds up the aging of the paper insulation, and that aging is what ends a transformer's life.",
};
const NOT_YET: VoiceVerdict = {
  passed: false,
  feedback: "You named the heat, but not what it does to the insulation over time. Look at how aging relates to temperature, then try again.",
};

type Pin = { label: string; state: Partial<VoiceState> & { phase: VoicePhase }; transcript?: Transcript; frozen?: number };

const fallback = (reason: FallbackReason, transcript?: Transcript): Pin => ({
  label: `type-instead (${reason})`,
  state: { phase: "type-instead", reason },
  transcript,
});

const PINS: Record<string, Pin> = {
  ready: { label: "ready", state: { phase: "ready" } },
  thinking: { label: "thinking", state: { phase: "thinking" } },
  speaking: { label: "speaking", state: { phase: "speaking" }, frozen: 0.55 },
  "your-turn": { label: "your-turn", state: { phase: "your-turn" } },
  "nothing-heard": { label: "nothing heard", state: { phase: "your-turn", notice: "nothing-heard" } },
  listening: { label: "listening", state: { phase: "listening" }, transcript: transcriptOf(9) },
  "listening-empty": { label: "listening (no words yet)", state: { phase: "listening" } },
  heard: { label: "heard", state: { phase: "heard" }, transcript: settle(transcriptOf()) },
  checking: { label: "checking", state: { phase: "checking" }, transcript: settle(transcriptOf()) },
  "verdict-pass": { label: "verdict: proven", state: { phase: "verdict", verdict: PASSED }, transcript: settle(transcriptOf()) },
  "verdict-fail": { label: "verdict: not yet", state: { phase: "verdict", verdict: NOT_YET }, transcript: settle(transcriptOf()) },
  "type-chosen": fallback("chosen"),
  "type-denied": fallback("mic-denied"),
  "type-socket": fallback("socket", settle(transcriptOf(9))),
};

const noSubscribe = () => () => {};

function useQuery(): URLSearchParams | null {
  const search = useSyncExternalStore(
    noSubscribe,
    () => window.location.search,
    () => null,
  );
  return useMemo(() => (search === null ? null : new URLSearchParams(search)), [search]);
}

export function VoicePreview() {
  const query = useQuery();
  if (!query) return null;
  if (query.has("real")) return <RealPreview />;
  return <MockPreview pinName={query.get("state")} bare={query.has("bare")} />;
}

function MockPreview({ pinName, bare }: { pinName: string | null; bare: boolean }) {
  const pin = pinName ? PINS[pinName] : undefined;
  const [adapters] = useState(() => createMockAdapters({ question: QUESTION, answer: ANSWER, frozenFraction: pin?.frozen }));
  return (
    <div className="flex flex-col gap-6">
      <VoiceInterview
        attemptId={pinName ?? "walkthrough"}
        question={QUESTION}
        adapters={adapters}
        initial={
          pin
            ? {
                state: { ...INITIAL_VOICE_STATE, ...pin.state },
                transcript: pin.transcript,
                meter: pin.state.phase === "speaking" || pin.state.phase === "listening" ? speechLikeMeter() : undefined,
              }
            : undefined
        }
        onAnswer={async () => {
          await new Promise((resolve) => setTimeout(resolve, 1400));
          return PASSED;
        }}
        onTypeInstead={() => {}}
      />
      {!bare && (
        <nav aria-label="Preview states" className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-soft">
          <a className="underline" href="/voice-preview">
            Walk through it
          </a>
          {Object.entries(PINS).map(([name, value]) => (
            <a key={name} className="underline" href={`/voice-preview?state=${name}`}>
              {value.label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

/** The real thing: real routes, real mic. It uses whichever providers the server has keys for. */
function RealPreview() {
  const [attempt, setAttempt] = useState<{ id: string; question: string } | null>(null);
  const [typed, setTyped] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/voice/preview-attempt", { method: "POST", body: "{}" })
      .then((response) => response.json())
      .then(setAttempt);
  }, []);

  if (!attempt) return null;
  return (
    <div className="flex flex-col gap-4">
      <VoiceInterview
        attemptId={attempt.id}
        question={attempt.question}
        onAnswer={async (text, inputMethod) => {
          const response = await fetch("/api/voice/preview-attempt", {
            method: "POST",
            body: JSON.stringify({ attemptId: attempt.id, answer: text, inputMethod }),
          });
          if (!response.ok) throw new Error("not sent");
          return (await response.json()) as VoiceVerdict;
        }}
        onTypeInstead={setTyped}
      />
      {typed !== null && <p className="text-sm text-ink-soft">onTypeInstead was called with: “{typed}”</p>}
    </div>
  );
}

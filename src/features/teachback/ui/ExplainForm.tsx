import { Mic, MicOff } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { MicLevel, useDictation, type FallbackReason } from "@/features/voice/client";
import { Button, ErrorNotice, Field, Textarea } from "@/shared/ui";
import { MAX_KID_GRADE, readingGrade } from "../formats";
import { countWords } from "../learnerText";
import { MIN_WORDS, wordCountMessage } from "./format";
import { PendingNote } from "./PendingNote";
import type { Integrity } from "./useIntegrity";
import "./challenges.css";
import { useYoungLearner } from "./YoungLearner";
import { useSpeech, useSpeechSupported } from "./useSpeech";

type ExplainFormProps = {
  mapId: string;
  /** Used to make the input's id unique on the page. */
  nodeId: string;
  skillTitle: string;
  checkpointCount: number;
  text: string;
  /** Takes a function so that spoken phrases always add to the latest text. */
  onTextChange: (update: (current: string) => string) => void;
  integrity: Integrity;
  /** True after a not-yet result: the same text comes back for editing. */
  revising: boolean;
  pending: boolean;
  requestError: string | null;
  onSubmit: () => void;
  /** The server checked its voice key works, so dictation goes through Deepgram. */
  voiceReady: boolean;
  /** "kid" adds a live reading-level check, "timed" a 30-second clock. */
  format?: "explain" | "kid" | "timed";
};

/** How long "Say it in 30 seconds" gives. */
const CLOCK_SECONDS = 30;

/** What to say when dictation stops by itself. What it heard is already in the box. */
const DICTATION_STOPPED: Partial<Record<FallbackReason, string>> = {
  "mic-denied": "Microphone access is off, so dictation can't start. You can allow it in your browser's site settings, or type.",
  "mic-missing": "No microphone was found, so dictation can't start. You can type instead.",
  unsupported: "This browser can't record for dictation. You can type instead.",
  token: "Dictation isn't available right now. You can type instead.",
  socket: "The connection to dictation dropped. What it heard is in the box, so you can dictate again or type.",
  "no-transcript": "Dictation stopped picking up your words. What it heard is in the box, so you can dictate again or type.",
};
const DICTATION_FAILED = "Dictation stopped working. You can try again, or type instead.";

export function ExplainForm({
  mapId,
  nodeId,
  skillTitle,
  checkpointCount,
  text,
  onTextChange,
  integrity,
  revising,
  pending,
  requestError,
  onSubmit,
  voiceReady,
  format = "explain",
}: ExplainFormProps) {
  const young = useYoungLearner();
  const [tooShort, setTooShort] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const dictationStartedAt = useRef(0);

  function addSpoken(words: string) {
    setTooShort(false);
    onTextChange((current) => (current.trim() ? `${current.trimEnd()} ${words}` : words));
  }

  // Deepgram, when the server has a working key. Nothing happens until start().
  const dictation = useDictation({
    mapId,
    nodeId,
    onText: (words) => {
      addSpoken(words);
      integrity.recordSpeaking(Date.now() - dictationStartedAt.current);
    },
    onFallback: (reason, partialText) => {
      if (partialText) {
        addSpoken(partialText);
        integrity.recordSpeaking(Date.now() - dictationStartedAt.current);
      }
      setDictationError(DICTATION_STOPPED[reason] ?? DICTATION_FAILED);
    },
  });

  // Otherwise the browser's own speech recognition, where it has one.
  const browserSpeechSupported = useSpeechSupported();
  const speech = useSpeech({ onPhrase: addSpoken, onStopped: integrity.recordSpeaking });

  const canDictate = voiceReady || browserSpeechSupported;
  const listening = voiceReady ? dictation.status !== "idle" : speech.listening;
  const finishing = voiceReady && dictation.status === "finishing";
  const heard = voiceReady
    ? [dictation.finalText, dictation.interimText].filter(Boolean).join(" ")
    : speech.interim;
  const error = voiceReady ? dictationError : speech.error;

  // "Say it in 30 seconds": the clock starts on the first word, typed or spoken, and the
  // box locks when it runs out. Start over clears it for another go.
  const timed = format === "timed";
  const [clock, setClock] = useState<{ endsAt: number; left: number; stoppedAt?: number } | null>(null);
  const clockRunning = clock !== null && clock.stoppedAt === undefined;
  const timeUp = clock?.stoppedAt !== undefined;

  // A not-yet result keeps the text "for editing", so unlock it: the next edit starts a fresh clock.
  // Without this the box stayed locked, and "Check again" could only resend the text that just failed.
  const [wasPending, setWasPending] = useState(pending);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (!pending && timed && revising) setClock(null);
  }

  const endsAt = clockRunning ? clock.endsAt : null;
  const stopDictatingRef = useRef(stopDictating);
  useEffect(() => {
    stopDictatingRef.current = stopDictating;
  });
  useEffect(() => {
    if (endsAt === null) return;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      if (left > 0) return setClock((current) => current && { ...current, left });
      stopDictatingRef.current();
      setClock((current) => current && { ...current, left: 0, stoppedAt: 0 });
    }, 250);
    return () => clearInterval(timer);
  }, [endsAt]);

  function startClock() {
    if (timed && clock === null) setClock({ endsAt: Date.now() + CLOCK_SECONDS * 1000, left: CLOCK_SECONDS });
  }

  function stopClock() {
    if (listening) stopDictating();
    setClock((current) => current && { ...current, stoppedAt: current.left });
  }

  function startOver() {
    if (listening) stopDictating();
    integrity.reset();
    onTextChange(() => "");
    setClock(null);
  }

  function startDictating() {
    startClock();
    setDictationError(null);
    dictationStartedAt.current = Date.now();
    if (voiceReady) dictation.start();
    else speech.start();
  }

  function stopDictating() {
    if (voiceReady) void dictation.stop();
    else speech.stop();
  }

  const words = countWords(text);
  const inputId = `explain-${nodeId}`;
  const countId = `${inputId}-count`;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (words < MIN_WORDS) {
      setTooShort(true);
      return;
    }
    if (listening) return;
    if (clockRunning) stopClock();
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <h3 className="text-lg font-medium">
        {revising && !timed ? "Revise your explanation" : young && format === "kid" ? `Explain ${skillTitle} to a friend.` : HEADINGS[format](skillTitle)}
      </h3>
      {format === "kid" && (
        <p className="-mt-2 text-sm text-ink-soft">
          Short sentences, everyday words. Code checks the reading level: grade {MAX_KID_GRADE} or lower passes.
        </p>
      )}
      {timed && (
        <Clock seconds={clock?.left ?? CLOCK_SECONDS} running={clockRunning} spare={timeUp ? (clock?.stoppedAt ?? 0) : null} />
      )}

      <Field
        id={inputId}
        label="Your explanation"
        hint={
          canDictate
            ? "Type it, or dictate and fix any words it mishears. Your evidence page shows the word count, active time, any pasting, and whether it was spoken. Dictation you then edit counts as typed."
            : "Your evidence page will show how you wrote this: word count, active typing time, any pasting, and typed or voice."
        }
        error={tooShort ? `Write at least ${MIN_WORDS} words, so there is enough to check.` : null}
      >
        {(control) => (
          <Textarea
            {...control}
            aria-describedby={[control["aria-describedby"], countId].filter(Boolean).join(" ")}
            rows={5}
            value={text}
            readOnly={pending || timeUp}
            onPaste={integrity.recordPaste}
            onDrop={integrity.recordPaste}
            onChange={(event) => {
              const next = event.target.value;
              if (next.trim() === "") integrity.reset();
              else integrity.recordTyping();
              startClock();
              setTooShort(false);
              onTextChange(() => next);
            }}
          />
        )}
      </Field>

      <p id={countId} className="text-sm text-ink-soft tabular-nums">
        {wordCountMessage(words)}
      </p>
      {format === "kid" && words > 0 && <ReadingLevel grade={readingGrade(text)} young={young} />}

      {listening && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-control border border-accent/50 bg-available-surface px-3.5 py-3"
        >
          {voiceReady ? (
            <MicLevel getMeter={dictation.getMeter} />
          ) : (
            <Mic aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-accent-bright" />
          )}
          <p className="min-w-0 text-sm">
            <span className="font-semibold text-accent-bright">{finishing ? "Finishing up." : "Listening."}</span>{" "}
            <span className={heard ? "text-ink" : "text-ink-soft"}>
              {heard || "Talk as you would to a coworker. Your words join the box when you stop."}
            </span>
          </p>
        </div>
      )}
      {error && !listening && <p className="text-sm font-semibold text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        {/* Off while dictating, so the last words can't arrive after the text was sent. */}
        <Button type="submit" pending={pending} disabled={listening}>
          {pending ? "Checking" : revising ? "Check again" : "Check my explanation"}
        </Button>
        {timed && clockRunning && (
          <Button variant="subtle" onClick={stopClock}>
            Stop the clock
          </Button>
        )}
        {timed && timeUp && !pending && (
          <Button variant="subtle" onClick={startOver}>
            Start over
          </Button>
        )}
        {canDictate && !timeUp && (
          <Button
            variant="subtle"
            aria-pressed={listening}
            disabled={pending || finishing}
            onClick={listening ? stopDictating : startDictating}
          >
            {listening ? <MicOff aria-hidden="true" size={17} /> : <Mic aria-hidden="true" size={17} />}
            {listening ? "Stop dictating" : "Dictate"}
          </Button>
        )}
      </div>

      {pending && (
        <PendingNote message={`Checking what you wrote against ${checkpointCount} checkpoints.`} />
      )}
      {requestError && !pending && <ErrorNotice message={requestError} onRetry={onSubmit} />}
    </form>
  );
}

const HEADINGS = {
  explain: (title: string) => `Explain ${title} as if to a curious friend.`,
  kid: (title: string) => `Explain ${title} to a 10-year-old.`,
  timed: (title: string) => `Say ${title} in 30 seconds. Go!`,
};

/** The live reading level for "Explain it to a 10-year-old". The server measures it again. */
function ReadingLevel({ grade, young }: { grade: number; young: boolean }) {
  const ok = grade <= MAX_KID_GRADE;
  return (
    <p className={`text-sm font-medium tabular-nums ${ok ? "text-proven" : "text-amber"}`}>
      Reading level: grade {Math.round(grade)}. {ok ? (young ? "A friend could follow this." : "A 10-year-old could follow this.") : "Try shorter sentences and smaller words."}
    </p>
  );
}

/** The 30-second clock. spare is set once it stopped: the seconds that were left. */
function Clock({ seconds, running, spare }: { seconds: number; running: boolean; spare: number | null }) {
  return (
    <div className="flex items-center gap-3" role="timer" aria-live="off">
      <span
        className={`inline-flex min-w-20 justify-center rounded-control border px-3 py-1.5 text-2xl font-semibold tabular-nums ${
          running && seconds <= 10 ? "clock-urgent border-amber text-amber" : "border-accent/50 text-accent-bright"
        }`}
      >
        0:{String(seconds).padStart(2, "0")}
      </span>
      <span className="text-sm text-ink-soft">
        {spare === null
          ? running
            ? "Keep going."
            : "Starts on your first word. Talk, or type if you can't."
          : spare > 0
            ? `Done with ${spare} ${spare === 1 ? "second" : "seconds"} to spare.`
            : "Time! Check it, or start over."}
      </span>
    </div>
  );
}

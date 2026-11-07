import { Mic, MicOff } from "lucide-react";
import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { MicLevel, useDictation, type FallbackReason } from "@/features/voice/client";
import { Button, ErrorNotice, Field, Textarea } from "@/shared/ui";
import { countWords } from "../learnerText";
import { MIN_WORDS, wordCountMessage } from "./format";
import { PendingNote } from "./PendingNote";
import type { Integrity } from "./useIntegrity";
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
};

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
}: ExplainFormProps) {
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

  function startDictating() {
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
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <h3 className="text-lg font-medium">
        {revising ? "Revise your explanation" : `Explain ${skillTitle} as if to a new coworker.`}
      </h3>

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
            readOnly={pending}
            onPaste={integrity.recordPaste}
            onDrop={integrity.recordPaste}
            onChange={(event) => {
              const next = event.target.value;
              if (next.trim() === "") integrity.reset();
              else integrity.recordTyping();
              setTooShort(false);
              onTextChange(() => next);
            }}
          />
        )}
      </Field>

      <p id={countId} className="text-sm text-ink-soft tabular-nums">
        {wordCountMessage(words)}
      </p>

      {listening && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-control border border-accent/50 bg-available-surface px-3.5 py-3 shadow-glow"
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
        {canDictate && (
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

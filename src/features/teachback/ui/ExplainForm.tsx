import type { FormEvent } from "react";
import { useState } from "react";
import { Button, ErrorNotice, Field, Textarea } from "@/shared/ui";
import { countWords } from "../learnerText";
import { MIN_WORDS, wordCountMessage } from "./format";
import { PendingNote } from "./PendingNote";
import type { Integrity } from "./useIntegrity";
import { useSpeech, useSpeechSupported } from "./useSpeech";

type ExplainFormProps = {
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
};

export function ExplainForm({
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
}: ExplainFormProps) {
  const [tooShort, setTooShort] = useState(false);
  const speechSupported = useSpeechSupported();
  const speech = useSpeech({
    onPhrase: (phrase) => {
      setTooShort(false);
      onTextChange((current) => (current.trim() ? `${current.trimEnd()} ${phrase}` : phrase));
    },
    onStopped: integrity.recordSpeaking,
  });

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
    if (speech.listening) speech.stop();
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <h3 className="text-xl font-semibold">
        {revising ? "Revise your explanation" : `Explain ${skillTitle} as if to a new coworker.`}
      </h3>

      <Field
        id={inputId}
        label="Your explanation"
        hint="Your evidence page will show how you wrote this: word count, active typing time, any pasting, and typed or voice."
        error={tooShort ? `Write at least ${MIN_WORDS} words, so there is enough to check.` : null}
      >
        {(control) => (
          <Textarea
            {...control}
            aria-describedby={[control["aria-describedby"], countId].filter(Boolean).join(" ")}
            ruled
            rows={7}
            value={text}
            readOnly={pending}
            onPaste={integrity.recordPaste}
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

      {speech.interim && (
        <p className="text-sm text-ink-soft italic">Hearing: {speech.interim}</p>
      )}
      {speech.error && <p className="text-sm font-semibold text-danger">{speech.error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" pending={pending}>
          {pending ? "Checking" : revising ? "Check again" : "Check my explanation"}
        </Button>
        {speechSupported && (
          <Button
            variant="subtle"
            aria-pressed={speech.listening}
            disabled={pending}
            onClick={speech.listening ? speech.stop : speech.start}
          >
            {speech.listening ? "Stop listening" : "Speak instead"}
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

import type { FormEvent } from "react";
import { useState } from "react";
import { Button, ErrorNotice, Field, InlineText, Textarea } from "@/shared/ui";
import { PendingNote } from "./PendingNote";

type FollowUpFormProps = {
  attemptId: string;
  question: string;
  pending: boolean;
  requestError: string | null;
  onSubmit: (answer: string) => void;
  /** Called when the learner types, so the panel can note when they began. Only the first call counts. */
  onBegin: () => void;
};

/** The one live question about the learner's own words. Passing it is required. */
export function FollowUpForm({
  attemptId,
  question,
  pending,
  requestError,
  onSubmit,
  onBegin,
}: FollowUpFormProps) {
  const [answer, setAnswer] = useState("");
  const [empty, setEmpty] = useState(false);
  const inputId = `followup-${attemptId}`;
  const questionId = `${inputId}-question`;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!answer.trim()) {
      setEmpty(true);
      return;
    }
    onSubmit(answer.trim());
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-4 rounded-sheet border border-accent bg-available-surface p-4"
    >
      <h3 id={questionId} className="text-lg leading-snug font-medium">
        <InlineText text={question} />
      </h3>

      <Field
        id={inputId}
        label="Your answer"
        hint="Answer in your own words. A sentence or two is enough."
        error={empty ? "Write your answer first." : null}
      >
        {(control) => (
          <Textarea
            {...control}
            aria-describedby={[questionId, control["aria-describedby"]].filter(Boolean).join(" ")}
            rows={4}
            value={answer}
            readOnly={pending}
            onChange={(event) => {
              setEmpty(false);
              onBegin();
              setAnswer(event.target.value);
            }}
          />
        )}
      </Field>

      <div>
        <Button type="submit" pending={pending}>
          {pending ? "Checking" : "Send my answer"}
        </Button>
      </div>

      {pending && <PendingNote message="Checking your answer against what you wrote." />}
      {requestError && !pending && (
        <ErrorNotice message={requestError} onRetry={() => onSubmit(answer.trim())} />
      )}
    </form>
  );
}

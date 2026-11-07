import type { FormEvent, Ref } from "react";
import { useState } from "react";
import { Button, ErrorNotice, Field, Textarea } from "@/shared/ui";
import { PendingNote } from "./PendingNote";

type FollowUpFormProps = {
  attemptId: string;
  question: string;
  pending: boolean;
  requestError: string | null;
  onSubmit: (answer: string) => void;
  /** Lets the panel bring this form into view when the question arrives. */
  formRef: Ref<HTMLFormElement>;
};

/** The one live question about the learner's own words. Passing it is required. */
export function FollowUpForm({
  attemptId,
  question,
  pending,
  requestError,
  onSubmit,
  formRef,
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
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="flex scroll-mt-4 flex-col gap-4 rounded-sheet border border-accent bg-available-surface p-4 shadow-glow"
    >
      <h3 id={questionId} className="text-lg leading-snug font-medium">
        {question}
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

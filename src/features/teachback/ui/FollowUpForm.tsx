import type { FormEvent } from "react";
import { useState } from "react";
import { Button, ErrorNotice, Field, Textarea } from "@/shared/ui";
import { PendingNote } from "./PendingNote";

type FollowUpFormProps = {
  attemptId: string;
  question: string;
  pending: boolean;
  requestError: string | null;
  onSubmit: (answer: string) => void;
};

/** The one live question about the learner's own words. Passing it is required. */
export function FollowUpForm({
  attemptId,
  question,
  pending,
  requestError,
  onSubmit,
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
      className="flex flex-col gap-4 rounded-sheet border-[3px] border-available bg-sheet p-4"
    >
      <h3 id={questionId} className="text-xl font-semibold">
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
            ruled
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

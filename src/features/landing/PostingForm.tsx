"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { Badge, Button, ErrorNotice, Field, Textarea } from "@/shared/ui";

/** Anything shorter than this cannot be a whole job posting. */
const MIN_POSTING_LENGTH = 80;
/** After this long, the status message says it is taking a while. */
const SLOW_AFTER_SECONDS = 45;

const COULD_NOT_BUILD =
  "The map could not be built this time. Your posting is still here, so you can try again.";
const COULD_NOT_CONNECT =
  "OryxLearn could not be reached. Check your connection, then try again. Your posting is still here.";

export function PostingForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Count seconds for as long as the map is being built.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  const loadedSample = SAMPLE_POSTINGS.find((sample) => sample.text === text);

  async function buildMap() {
    const posting = text.trim();
    if (!posting) {
      setFieldError("Paste a job posting first, or choose a sample below.");
      return;
    }
    if (posting.length < MIN_POSTING_LENGTH) {
      setFieldError(
        "That is too short to be a full posting. Paste all of it, including the requirements.",
      );
      return;
    }

    setFieldError(null);
    setRequestError(null);
    setSeconds(0);
    setPending(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const response = await fetch("/api/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: posting }),
        signal: abort.signal,
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || typeof body?.id !== "string") {
        // The API writes its `error` field as a sentence meant for people.
        setRequestError(typeof body?.error === "string" ? body.error : COULD_NOT_BUILD);
        setPending(false);
        return;
      }

      // Stay in the loading state until the map page replaces this one.
      router.push(`/map/${body.id}`);
    } catch {
      if (!abort.signal.aborted) setRequestError(COULD_NOT_CONNECT);
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!pending) buildMap();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Field
        id="posting"
        label="Job posting"
        hint="Paste the whole posting, including the requirements."
        error={fieldError}
      >
        {(control) => (
          <Textarea
            {...control}
            ruled
            rows={8}
            value={text}
            readOnly={pending}
            onChange={(event) => {
              setText(event.target.value);
              setFieldError(null);
            }}
          />
        )}
      </Field>

      {loadedSample && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          <Badge tone="sample">Sample text</Badge>
          Written for this demo. It is not a real listing.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button type="submit" size="lg" pending={pending}>
          {pending ? "Building your map" : "Map this posting"}
        </Button>
        {pending ? (
          <Button
            variant="quiet"
            onClick={() => abortRef.current?.abort()}
          >
            Cancel
          </Button>
        ) : (
          <p className="text-sm text-ink-soft">No account needed.</p>
        )}
      </div>

      {pending && <BuildStatus seconds={seconds} />}

      {requestError && (
        <ErrorNotice message={requestError} onRetry={buildMap} />
      )}

      {!pending && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-sm text-ink-soft">
            No posting handy? Try a sample, written for this demo.
          </p>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_POSTINGS.map((sample) => (
              <Button
                key={sample.id}
                variant="subtle"
                size="sm"
                aria-pressed={loadedSample?.id === sample.id}
                className="text-left"
                onClick={() => {
                  setText(sample.text);
                  setFieldError(null);
                  setRequestError(null);
                }}
              >
                {sample.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}

/**
 * Says what is really happening. The request gives no progress updates, so this
 * shows elapsed time rather than a made-up percentage or fake steps.
 */
function BuildStatus({ seconds }: { seconds: number }) {
  const isSlow = seconds >= SLOW_AFTER_SECONDS;

  return (
    <div className="rounded-control border border-control-edge bg-sheet p-4">
      {/* Only this sentence is announced; it changes once at most. */}
      <p role="status" className="font-semibold">
        {isSlow
          ? "Still working. Long postings take longer. You can keep waiting or cancel."
          : "Reading the posting, then working out each skill and what it depends on."}
      </p>
      <p className="text-sm text-ink-soft tabular-nums" aria-hidden="true">
        {seconds} {seconds === 1 ? "second" : "seconds"} so far. This can take a
        minute or so.
      </p>
    </div>
  );
}

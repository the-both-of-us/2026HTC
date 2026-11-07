"use client";

import clsx from "clsx";
import { Briefcase, ChevronRight, Gauge, Server, Sparkles, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { Badge, Button, ErrorNotice, Field, Spinner, Textarea } from "@/shared/ui";
import { SampleFromLink } from "./SampleFromLink";

/** Anything shorter than this cannot be a whole job posting. */
const MIN_POSTING_LENGTH = 80;
/** After this long, the status message says it is taking a while. Normal is about 5 seconds. */
const SLOW_AFTER_SECONDS = 20;

const COULD_NOT_BUILD =
  "The map could not be built this time. Your posting is still here, so you can try again.";
const COULD_NOT_CONNECT =
  "OryxLearn could not be reached. Check your connection, then try again. Your posting is still here.";

/** A look for each sample card, by sample id. Anything else gets the first look below. */
const SAMPLE_LOOKS: Record<string, { icon: typeof Zap; edge: string; tile: string }> = {
  "data-analyst-grid": {
    icon: Zap,
    edge: "border-l-accent hover:border-accent",
    tile: "border-accent/45 bg-accent/10 text-accent-bright",
  },
  "instrumentation-renewables": {
    icon: Gauge,
    edge: "border-l-amber hover:border-amber",
    tile: "border-amber/45 bg-amber/10 text-amber",
  },
  "junior-backend": {
    icon: Server,
    edge: "border-l-violet hover:border-violet",
    tile: "border-violet/45 bg-violet/10 text-violet",
  },
};
const DEFAULT_LOOK = { ...SAMPLE_LOOKS["data-analyst-grid"], icon: Briefcase };

/** The hero's form and the sample cards under it. `children` is the hero's heading. */
export function PostingForm({ children }: { children: ReactNode }) {
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

  // Next.js keeps this page alive but hidden after navigating to the map. Clear the
  // loading state as it hides, or coming back would show a map still being built.
  useLayoutEffect(() => () => setPending(false), []);

  const loadedSample = SAMPLE_POSTINGS.find((sample) => sample.text === text);

  async function buildMap(from: string) {
    const posting = from.trim();
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
    if (!pending) buildMap(text);
  }

  function buildSample(sampleText: string) {
    setText(sampleText);
    buildMap(sampleText);
  }

  return (
    <div className="flex flex-col gap-9">
      <Suspense fallback={null}>
        <SampleFromLink onSample={setText} />
      </Suspense>
      <form
        onSubmit={handleSubmit}
        noValidate
        className="relative flex flex-col gap-5 overflow-hidden rounded-[1.25rem] border border-rule-strong bg-sheet/90 p-5 shadow-panel sm:p-7"
      >
        {/* A soft pool of light in the corner of the card. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-32 left-1/3 size-96 rounded-full bg-accent/10 blur-3xl"
        />
        <div className="relative flex flex-col gap-3">{children}</div>

        <Field
          id="posting"
          label="Job posting"
          hint="Paste the whole posting, including the requirements."
          error={fieldError}
          className="relative"
        >
          {(control) => (
            <Textarea
              {...control}
              rows={4}
              className="sm:min-h-52"
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
          <p className="relative flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <Badge tone="sample">Sample text</Badge>
            Written for this demo. It is not a real listing.
          </p>
        )}

        <div className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          {pending ? (
            <Button variant="quiet" onClick={() => abortRef.current?.abort()}>
              Cancel
            </Button>
          ) : (
            <p className="text-sm text-ink-soft">No account needed.</p>
          )}
          <Button type="submit" size="lg" pending={pending} className="grow sm:grow-0">
            {!pending && <Sparkles aria-hidden="true" size={18} />}
            {pending ? "Building your map" : "Map this posting"}
          </Button>
        </div>

        {pending && <BuildStatus seconds={seconds} />}

        {requestError && <ErrorNotice message={requestError} onRetry={() => buildMap(text)} />}
      </form>

      {!pending && (
        <section aria-labelledby="samples-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="samples-heading" className="text-xl font-medium">
              Starter postings
            </h2>
            <p className="text-sm text-ink-soft">Samples written for this demo, not real listings.</p>
          </div>
          <ul className="grid gap-3 md:grid-cols-3">
            {SAMPLE_POSTINGS.map((sample) => {
              const look = SAMPLE_LOOKS[sample.id] ?? DEFAULT_LOOK;
              const Icon = look.icon;
              return (
                <li key={sample.id} className="flex">
                  <button
                    type="button"
                    onClick={() => buildSample(sample.text)}
                    className={clsx(
                      "flex w-full cursor-pointer flex-col gap-3 rounded-sheet border border-l-[3px] border-rule-strong bg-sheet/90 p-4 text-left transition-control hover:-translate-y-0.5 hover:bg-raised",
                      look.edge,
                    )}
                  >
                    <span className="flex items-start gap-3">
                      <span
                        className={clsx(
                          "flex size-10 shrink-0 items-center justify-center rounded-control border",
                          look.tile,
                        )}
                      >
                        <Icon aria-hidden="true" size={19} />
                      </span>
                      <span className="min-w-0">
                        <span className="block leading-snug font-medium">{sample.label}</span>
                        <span className="mt-0.5 line-clamp-2 block text-sm text-ink-soft">
                          {locationLine(sample.text)}
                        </span>
                      </span>
                    </span>
                    <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-accent-bright">
                      Map this sample
                      <ChevronRight aria-hidden="true" size={16} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** A sample's second line says where the job is, which makes a good one-line summary. */
function locationLine(text: string): string {
  return text.split("\n")[1] ?? "";
}

/**
 * Says what is really happening. The request gives no progress updates, so this
 * shows elapsed time rather than a made-up percentage or fake steps.
 */
function BuildStatus({ seconds }: { seconds: number }) {
  const isSlow = seconds >= SLOW_AFTER_SECONDS;

  return (
    <div className="relative flex items-start gap-3 rounded-control border border-accent/40 bg-accent/8 p-4">
      <Spinner size={20} className="mt-0.5 shrink-0 text-accent-bright" />
      <div>
        {/* Only this sentence is announced; it changes once at most. */}
        <p role="status" className="font-medium">
          {isSlow
            ? "Still working. Long postings take longer. You can keep waiting or cancel."
            : "Reading the posting, then working out each skill and what it depends on."}
        </p>
        <p className="text-sm text-ink-soft tabular-nums" aria-hidden="true">
          {seconds} {seconds === 1 ? "second" : "seconds"} so far. This usually takes a few seconds.
        </p>
      </div>
    </div>
  );
}

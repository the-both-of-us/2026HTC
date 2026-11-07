"use client";

import clsx from "clsx";
import { Briefcase, ChevronRight, FileText, Gauge, Lightbulb, Server, Sparkles, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { Badge, Button, ErrorNotice, Field, Spinner, Textarea, TextInput } from "@/shared/ui";
import { SampleFromLink } from "./SampleFromLink";

/** Anything shorter than this cannot be a whole job posting. */
const MIN_POSTING_LENGTH = 80;
/** The server's limits, checked here first so a person isn't kept waiting for a no. */
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const MAX_TOPIC_LENGTH = 120;
/** After this long, the status message says it is taking a while. Normal is about 5 seconds. */
const SLOW_AFTER_SECONDS = 20;

/** The three things a map can be built from. */
const MODES = [
  { id: "posting", label: "Job posting", icon: Briefcase, noun: "posting" },
  { id: "pdf", label: "PDF", icon: FileText, noun: "PDF" },
  { id: "topic", label: "Topic", icon: Lightbulb, noun: "topic" },
] as const;
type Mode = (typeof MODES)[number]["id"];
const nounOf = (mode: Mode) => MODES.find((item) => item.id === mode)?.noun ?? "posting";

const couldNotBuild = (mode: Mode) =>
  `The map could not be built this time. Your ${nounOf(mode)} is still here, so you can try again.`;
const couldNotConnect = (mode: Mode) =>
  `OryxLearn could not be reached. Check your connection, then try again. Your ${nounOf(mode)} is still here.`;

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
  const [mode, setMode] = useState<Mode>("posting");
  const [text, setText] = useState("");
  const [topic, setTopic] = useState("");
  const [file, setFile] = useState<File | null>(null);
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

  const loadedSample = mode === "posting" && SAMPLE_POSTINGS.find((sample) => sample.text === text);

  // A sample link always means a posting, whichever mode was open.
  const loadSample = useCallback((sampleText: string) => {
    setMode("posting");
    setText(sampleText);
  }, []);

  function switchMode(next: Mode) {
    setMode(next);
    setFieldError(null);
    setRequestError(null);
  }

  /** Checks the input for this mode. Returns the request to send, or null after showing why not. */
  function prepareRequest(buildMode: Mode, postingText: string): { url: string; init: RequestInit } | null {
    if (buildMode === "pdf") {
      if (!file) {
        setFieldError("Choose a PDF first.");
        return null;
      }
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setFieldError("That file is not a PDF. Choose a file that ends in .pdf.");
        return null;
      }
      if (file.size > MAX_PDF_BYTES) {
        setFieldError("That PDF is over 4 MB. Upload a smaller one, such as a single chapter.");
        return null;
      }
      const form = new FormData();
      form.append("file", file);
      return { url: "/api/maps/pdf", init: { method: "POST", body: form } };
    }

    const value = buildMode === "topic" ? topic.trim() : postingText.trim();
    if (buildMode === "topic" && value.length < 2) {
      setFieldError('Name a topic first, such as "SQL window functions".');
      return null;
    }
    if (buildMode === "posting" && !value) {
      setFieldError("Paste a job posting first, or choose a sample below.");
      return null;
    }
    if (buildMode === "posting" && value.length < MIN_POSTING_LENGTH) {
      setFieldError("That is too short to be a full posting. Paste all of it, including the requirements.");
      return null;
    }
    const body = buildMode === "topic" ? { text: value, kind: "topic" } : { text: value };
    return {
      url: "/api/maps",
      init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    };
  }

  async function buildMap(buildMode: Mode, postingText: string) {
    const request = prepareRequest(buildMode, postingText);
    if (!request) return;

    setFieldError(null);
    setRequestError(null);
    setSeconds(0);
    setPending(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const response = await fetch(request.url, { ...request.init, signal: abort.signal });
      const body = await response.json().catch(() => null);

      if (!response.ok || typeof body?.id !== "string") {
        // The API writes its `error` field as a sentence meant for people.
        setRequestError(typeof body?.error === "string" ? body.error : couldNotBuild(buildMode));
        setPending(false);
        return;
      }

      // Stay in the loading state until the map page replaces this one.
      router.push(`/map/${body.id}`);
    } catch {
      if (!abort.signal.aborted) setRequestError(couldNotConnect(buildMode));
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!pending) buildMap(mode, text);
  }

  function buildSample(sampleText: string) {
    loadSample(sampleText);
    buildMap("posting", sampleText);
  }

  return (
    <div className="flex flex-col gap-9">
      <Suspense fallback={null}>
        <SampleFromLink onSample={loadSample} />
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

        <div role="group" aria-label="What to build the map from" className="relative flex flex-wrap gap-2">
          {MODES.map((item) => {
            const Icon = item.icon;
            const active = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                disabled={pending}
                onClick={() => switchMode(item.id)}
                className={clsx(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-control disabled:cursor-default",
                  active
                    ? "border-accent/60 bg-accent/12 text-accent-bright"
                    : "border-rule-strong text-ink-soft hover:border-ink-soft hover:text-ink",
                )}
              >
                <Icon aria-hidden="true" size={15} />
                {item.label}
              </button>
            );
          })}
        </div>

        {mode === "posting" && (
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
        )}

        {mode === "pdf" && (
          <Field
            id="pdf"
            label="PDF"
            hint="Course notes, a syllabus or a job description, with text you can select. Up to 4 MB and 30 pages. Each skill quotes the page it came from."
            error={fieldError}
            className="relative"
          >
            {(control) => (
              <input
                {...control}
                type="file"
                accept="application/pdf,.pdf"
                disabled={pending}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setFieldError(null);
                }}
                className="block w-full cursor-pointer rounded-control border border-dashed border-control-edge bg-paper/70 px-4 py-6 text-base text-ink-soft transition-control hover:border-ink-soft focus-visible:border-accent-bright aria-invalid:border-danger file:mr-4 file:cursor-pointer file:rounded-control file:border-0 file:bg-accent/15 file:px-4 file:py-2 file:font-medium file:text-accent-bright sm:py-12"
              />
            )}
          </Field>
        )}

        {mode === "topic" && (
          <Field
            id="topic"
            label="Topic"
            hint="A skill or subject in a few words. With no source to quote, the AI builds the map from what it knows, so its skills have no citations."
            error={fieldError}
            className="relative"
          >
            {(control) => (
              <TextInput
                {...control}
                value={topic}
                maxLength={MAX_TOPIC_LENGTH}
                placeholder="For example: SQL window functions"
                readOnly={pending}
                onChange={(event) => {
                  setTopic(event.target.value);
                  setFieldError(null);
                }}
              />
            )}
          </Field>
        )}

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
            {pending ? "Building your map" : `Map this ${nounOf(mode)}`}
          </Button>
        </div>

        {pending && <BuildStatus seconds={seconds} mode={mode} />}

        {requestError && <ErrorNotice message={requestError} onRetry={() => buildMap(mode, text)} />}
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
const WORKING_ON: Record<Mode, string> = {
  posting: "Reading the posting, then working out each skill and what it depends on.",
  pdf: "Reading each page of the PDF, then working out each skill and the page it came from.",
  topic: "Working out the skills in this topic and what each one depends on.",
};

function BuildStatus({ seconds, mode }: { seconds: number; mode: Mode }) {
  const isSlow = seconds >= SLOW_AFTER_SECONDS;

  return (
    <div className="relative flex items-start gap-3 rounded-control border border-accent/40 bg-accent/8 p-4">
      <Spinner size={20} className="mt-0.5 shrink-0 text-accent-bright" />
      <div>
        {/* Only this sentence is announced; it changes once at most. */}
        <p role="status" className="font-medium">
          {isSlow
            ? `Still working.${mode === "topic" ? "" : ` A long ${nounOf(mode)} takes longer.`} You can keep waiting or cancel.`
            : WORKING_ON[mode]}
        </p>
        <p className="text-sm text-ink-soft tabular-nums" aria-hidden="true">
          {seconds} {seconds === 1 ? "second" : "seconds"} so far. This usually takes a few seconds.
        </p>
      </div>
    </div>
  );
}

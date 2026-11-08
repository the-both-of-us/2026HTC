"use client";

import { useRouter } from "next/navigation";
import { Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { Badge, Button, ErrorNotice, Seal, SealBlank, sha256Hex, Spinner, tabId, Tabs } from "@/shared/ui";
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
  { id: "topic", label: "Name a topic", noun: "topic" },
  { id: "posting", label: "Paste a posting", noun: "posting" },
  { id: "pdf", label: "Upload a PDF", noun: "PDF" },
] as const;
type Mode = (typeof MODES)[number]["id"];
const nounOf = (mode: Mode) => MODES.find((item) => item.id === mode)?.noun ?? "posting";

/**
 * How big to make it. A broad goal, such as a whole job or "web development", becomes a
 * program of courses. "Decide for me" asks the AI, using the rubric in the programs feature.
 */
const SHAPES = [
  { id: "auto", label: "Decide for me" },
  { id: "program", label: "Full program" },
  { id: "course", label: "One course" },
] as const;
type Shape = (typeof SHAPES)[number]["id"];

const couldNotBuild = (mode: Mode) =>
  `The map could not be built this time. Your ${nounOf(mode)} is still here, so you can try again.`;
const couldNotConnect = (mode: Mode) =>
  `OryxLearn could not be reached. Check your connection, then try again. Your ${nounOf(mode)} is still here.`;

/**
 * The front page, after Seal: the headline and the input on the left, a large guilloche seal on
 * the right that redraws as you type (its centre is `figures`), and an ink band of sample postings.
 * On phones: the input, then the samples, then the seal. `children` is the headline copy.
 */
export function PostingForm({ children, figures }: { children: ReactNode; figures?: ReactNode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("topic");
  const [shape, setShape] = useState<Shape>("auto");
  const [text, setText] = useState("");
  const [topic, setTopic] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const topicInput = useRef<HTMLInputElement>(null);

  // "Go deeper" from the feed links here with ?topic=<subtopic>: fill it in once and focus it.
  useEffect(() => {
    const prefill = new URLSearchParams(window.location.search).get("topic")?.trim().slice(0, MAX_TOPIC_LENGTH);
    if (!prefill) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode("topic");
    setTopic(prefill);
    requestAnimationFrame(() => topicInput.current?.focus());
  }, []);

  // The seal is drawn from what you have typed, so every posting gets its own. Deferred, so
  // typing stays quick while the big seal redraws.
  const seed = useDeferredValue("oryxlearn" + (mode === "posting" ? text : mode === "topic" ? topic : (file?.name ?? "")));

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
    const body = buildMode === "topic" ? { text: value, kind: "topic", shape } : { text: value, shape };
    return {
      // One course goes straight to the map builder. Anything else may become a program.
      url: shape === "course" ? "/api/maps" : "/api/programs",
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

      // A program answers with programId, a single map with id (or mapId from the programs route).
      const mapId = body?.id ?? body?.mapId;
      if (!response.ok || (typeof mapId !== "string" && typeof body?.programId !== "string")) {
        // The API writes its `error` field as a sentence meant for people.
        setRequestError(typeof body?.error === "string" ? body.error : couldNotBuild(buildMode));
        setPending(false);
        return;
      }

      // Stay in the loading state until the map page replaces this one.
      router.push(typeof body.programId === "string" ? `/program/${body.programId}` : `/map/${mapId}`);
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

  const errorId = fieldError ? "build-error" : undefined;
  const panelId = "build-input";

  return (
    <div className="relative flex flex-col">
      <Suspense fallback={null}>
        <SampleFromLink onSample={loadSample} />
      </Suspense>

      <section className="relative z-10 px-4 pt-4 pb-6 sm:px-7 lg:flex lg:min-h-[max(37.5rem,calc(100dvh-11.875rem))] lg:w-[min(40.625rem,50%)] lg:flex-col lg:justify-center lg:pt-6 lg:pb-10">
        <div className="flex flex-col gap-3.5">{children}</div>

        <form onSubmit={handleSubmit} noValidate className="mt-5">
          <Tabs
            label="What to build a map from"
            items={MODES}
            value={mode}
            onChange={switchMode}
            idPrefix="build"
            panelId={panelId}
            disabled={pending}
          />
          <div
            id={panelId}
            role="tabpanel"
            aria-labelledby={tabId("build", mode)}
            className="border-[1.5px] border-ink bg-sheet"
          >
            {mode === "posting" && (
              <>
                <label htmlFor="posting" className="sr-only">
                  Job posting
                </label>
                <textarea
                  id="posting"
                  value={text}
                  readOnly={pending}
                  aria-describedby={errorId}
                  aria-invalid={fieldError ? true : undefined}
                  placeholder="Paste the whole posting, including the requirements."
                  onChange={(event) => {
                    setText(event.target.value);
                    setFieldError(null);
                  }}
                  className="block h-28 w-full resize-none bg-transparent px-4 py-3.5 leading-[1.45] focus-visible:-outline-offset-3"
                />
              </>
            )}

            {mode === "pdf" && (
              <label className="flex h-28 cursor-pointer items-center gap-4 px-4 has-[:focus-visible]:outline-3 has-[:focus-visible]:-outline-offset-3 has-[:focus-visible]:outline-ink [&:hover_b]:underline">
                <span className="relative size-17 shrink-0">
                  <SealBlank />
                </span>
                <span>
                  <b className="font-semibold">{file ? file.name : "Choose a PDF"}</b>
                  <br />
                  <span className="text-[0.9375rem] text-ink-soft">
                    {file
                      ? "Ready to map."
                      : "Course notes, a syllabus or a job description, up to 4 MB and 30 pages. Each skill quotes its page."}
                  </span>
                </span>
                <input
                  id="pdf"
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={pending}
                  aria-describedby={errorId}
                  aria-invalid={fieldError ? true : undefined}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    setFieldError(null);
                  }}
                  className="sr-only"
                />
              </label>
            )}

            {mode === "topic" && (
              <>
                <label htmlFor="topic" className="sr-only">
                  Topic
                </label>
                <input
                  ref={topicInput}
                  id="topic"
                  type="text"
                  value={topic}
                  maxLength={MAX_TOPIC_LENGTH}
                  readOnly={pending}
                  aria-describedby={["topic-hint", errorId].filter(Boolean).join(" ")}
                  aria-invalid={fieldError ? true : undefined}
                  placeholder="For example, SQL window functions"
                  onChange={(event) => {
                    setTopic(event.target.value);
                    setFieldError(null);
                  }}
                  className="block h-28 w-full bg-transparent px-4 text-[1.375rem] font-medium font-stretch-[110%] focus-visible:-outline-offset-3"
                />
              </>
            )}
          </div>

          {fieldError && (
            <p id="build-error" className="mt-2 text-[0.9375rem] font-semibold text-danger">
              {fieldError}
            </p>
          )}
          {mode === "topic" && (
            <p id="topic-hint" className="mt-2 text-sm text-ink-soft">
              With no source to quote, the AI builds the map from what it knows, so its skills have no citations. Name a grade or
              age, such as &ldquo;grade 1 math&rdquo;, and it is pitched at that level.
            </p>
          )}
          {mode !== "pdf" && (
            <div role="group" aria-label="How big to make it" className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-sm text-ink-soft">Size:</span>
              {SHAPES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={shape === item.id}
                  disabled={pending}
                  onClick={() => setShape(item.id)}
                  className={
                    "min-h-9 cursor-pointer px-2.5 text-sm font-semibold transition-control disabled:cursor-default " +
                    (shape === item.id
                      ? "bg-ink text-on-ink"
                      : "text-ink-soft shadow-[inset_0_0_0_1.5px_var(--color-rule-strong)] hover:text-ink hover:shadow-[inset_0_0_0_1.5px_var(--color-ink)]")
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          {loadedSample && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              <Badge tone="sample">Sample text</Badge>
              Written for this demo. It is not a real listing.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
            <Button type="submit" pending={pending} className="max-lg:w-full">
              {pending ? "Building your map" : `Map this ${nounOf(mode)}`}
            </Button>
            {pending ? (
              <Button variant="quiet" onClick={() => abortRef.current?.abort()}>
                Cancel
              </Button>
            ) : (
              <p className="text-sm text-ink-soft">No account needed.</p>
            )}
          </div>

          {pending && <BuildStatus seconds={seconds} mode={mode} planning={mode !== "pdf" && shape !== "course"} />}
          {requestError && <ErrorNotice className="mt-4" message={requestError} onRetry={() => buildMap(mode, text)} />}
        </form>
      </section>

      {/* The seal sits beside the copy on large screens and after the samples on phones. */}
      <section
        aria-label="Alberta unemployment, live from Statistics Canada"
        className="order-last overflow-hidden pt-2 pb-5 lg:pointer-events-none lg:absolute lg:inset-x-0 lg:top-0 lg:order-none lg:h-[max(37.5rem,calc(100dvh-11.875rem))] lg:p-0"
      >
        <div className="relative left-1/2 aspect-square w-[min(135vw,40rem)] -translate-x-1/2 lg:absolute lg:top-1/2 lg:left-[52%] lg:w-[min(48.75rem,118vh)] lg:translate-x-0 lg:-translate-y-1/2">
          <Seal fingerprint={sha256Hex(seed)} state="ink" detail="hero" center={38} />
          {figures && <div className="absolute inset-0 flex items-center justify-center">{figures}</div>}
        </div>
      </section>

      <section aria-labelledby="samples-heading" className="on-ink bg-ink px-4 pt-5.5 pb-6.5 text-on-ink sm:px-7 lg:min-h-[11.875rem] lg:pt-6 lg:pb-5.5">
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <h2 id="samples-heading" className="text-[1.1875rem] font-semibold">
            Or start from a sample posting
          </h2>
          <p className="text-[0.90625rem] text-on-ink-soft">Written for this demo, not real listings.</p>
        </div>
        <ul className="mt-3 grid gap-1 md:grid-cols-3 md:gap-x-7.5">
          {SAMPLE_POSTINGS.map((sample) => (
            <li key={sample.id} className="flex">
              <button
                type="button"
                disabled={pending}
                onClick={() => buildSample(sample.text)}
                className="group flex w-full cursor-pointer items-center gap-4 py-2 pr-2 text-left disabled:cursor-default disabled:opacity-70"
              >
                <span className="size-21 shrink-0 motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-(--ease-out) motion-safe:group-hover:rotate-[14deg]">
                  <Seal fingerprint={sha256Hex(sample.id)} state="on-ink" detail="mid" center={30} />
                </span>
                <span className="min-w-0">
                  <span className="block text-lg leading-tight font-semibold tracking-[-0.005em] font-stretch-[108%] decoration-[1.5px] underline-offset-4 group-hover:underline">
                    {sample.label}
                  </span>
                  <span className="mt-0.5 block text-[0.90625rem] leading-snug text-on-ink-soft">{locationLine(sample.text)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
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

function BuildStatus({ seconds, mode, planning }: { seconds: number; mode: Mode; planning: boolean }) {
  const isSlow = seconds >= SLOW_AFTER_SECONDS;

  return (
    <div className="mt-4 flex items-start gap-3 border-[1.5px] border-ink bg-sheet p-4">
      <Spinner size={20} className="mt-0.5 shrink-0 text-ink" />
      <div>
        {/* Only this sentence is announced; it changes once at most. */}
        <p role="status" className="font-medium">
          {isSlow
            ? `Still working.${mode === "topic" ? "" : ` A long ${nounOf(mode)} takes longer.`} You can keep waiting or cancel.`
            : planning
              ? "Working out whether this needs a full program of courses, then laying it out."
              : WORKING_ON[mode]}
        </p>
        <p className="text-sm text-ink-soft tabular-nums" aria-hidden="true">
          {seconds} {seconds === 1 ? "second" : "seconds"} so far. This usually takes a few seconds.
        </p>
      </div>
    </div>
  );
}

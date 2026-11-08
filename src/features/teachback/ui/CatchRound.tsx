import clsx from "clsx";
import { Check, CircleCheck, CircleDashed, Mic, MicOff, ScanSearch, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import type { Attempt } from "@/shared/types";
import { Button, ErrorNotice, Spinner, Textarea } from "@/shared/ui";
import { countWords } from "../learnerText";
import { fetchCatchRound, submitExplanation, type CatchViewData } from "./api";
import { PendingNote } from "./PendingNote";
import type { Integrity } from "./useIntegrity";
import { useSpeech, useSpeechSupported } from "./useSpeech";
import "./challenges.css";

/** Same as the server's MIN_CORRECTION_WORDS. */
const MIN_CORRECTION_WORDS = 3;

type CatchRoundProps = {
  mapId: string;
  nodeId: string;
  integrity: Integrity;
  onResult: (attempt: Attempt) => void;
  /** The round was already played, or can't load: explain it instead. */
  onExplainInstead: () => void;
};

/**
 * "Catch the mistake": the AI's confident explanation, with one or two planted mistakes.
 * Tap a sentence you think is wrong and say what's true. Which ones are wrong stays on the
 * server until you submit.
 */
export function CatchRound({ mapId, nodeId, integrity, onResult, onExplainInstead }: CatchRoundProps) {
  const [round, setRound] = useState<CatchViewData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadCount, setLoadCount] = useState(0);
  // Sentence number -> the learner's correction.
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    let current = true;
    fetchCatchRound(mapId, nodeId).then((result) => {
      if (!current) return;
      if (result.ok) {
        setRound(result.data);
        startedAt.current = Date.now();
      } else setLoadError(result.message);
    });
    return () => {
      current = false;
    };
  }, [mapId, nodeId, loadCount]);

  const speechSupported = useSpeechSupported();
  const speech = useSpeech({
    onPhrase: (phrase) => {
      if (open === null) return;
      setPicks((all) => ({ ...all, [open]: `${(all[open] ?? "").trimEnd()} ${phrase}`.trim() }));
    },
    onStopped: integrity.recordSpeaking,
  });

  if (loadError) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorNotice
          message={loadError}
          onRetry={() => {
            setLoadError(null);
            setLoadCount((count) => count + 1);
          }}
        />
        <Button variant="subtle" onClick={onExplainInstead}>
          Explain it in my own words instead
        </Button>
      </div>
    );
  }

  if (!round) {
    return (
      <p role="status" className="flex items-center gap-2.5 text-ink-soft">
        <Spinner size={18} className="shrink-0" />
        The AI is writing its explanation. Mistakes included.
      </p>
    );
  }

  if (round.revealed) {
    return (
      <div className="flex flex-col gap-3">
        <p>You&apos;ve seen where this round&apos;s mistakes were, so now explain it in your own words.</p>
        <Button onClick={onExplainInstead}>Explain it</Button>
      </div>
    );
  }

  const tapped = Object.keys(picks).map(Number).sort((a, b) => a - b);

  function toggle(sentence: number) {
    if (pending) return;
    if (speech.listening) speech.stop();
    if (open === sentence) {
      setOpen(null);
      return;
    }
    if (picks[sentence] === undefined) setPicks((all) => ({ ...all, [sentence]: "" }));
    setOpen(sentence);
  }

  function unmark(sentence: number) {
    setPicks((all) => Object.fromEntries(Object.entries(all).filter(([key]) => Number(key) !== sentence)));
    setOpen(null);
  }

  async function submit() {
    const short = tapped.find((sentence) => countWords(picks[sentence]) < MIN_CORRECTION_WORDS);
    if (tapped.length === 0) return setError("Tap the sentence you think is wrong, then say what's true.");
    if (short !== undefined) {
      setOpen(short);
      return setError(`Say what's true for sentence ${short} in at least ${MIN_CORRECTION_WORDS} words.`);
    }
    if (speech.listening) speech.stop();
    setPending(true);
    setError(null);
    const list = tapped.map((sentence) => ({ sentence, correction: picks[sentence].trim() }));
    const transcript = list.map((pick) => pick.correction).join(" ");
    const result = await submitExplanation({
      mapId,
      nodeId,
      explanation: "",
      integrity: { ...integrity.signalsFor(transcript), activeMs: Date.now() - startedAt.current },
      format: "catch",
      picks: list,
    });
    setPending(false);
    if (result.ok) onResult(result.attempt);
    else setError(result.message);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-soft">
        The AI hid{" "}
        <span className="font-semibold text-ink">
          {round.mistakeCount === 1 ? "one mistake" : `${round.mistakeCount} mistakes`}
        </span>{" "}
        in here. Tap each wrong sentence and say what&apos;s true. Tapping a correct one costs points.
      </p>

      <ol className="flex flex-col gap-2">
        {round.sentences.map((sentence, index) => {
          const number = index + 1;
          const marked = picks[number] !== undefined;
          return (
            <li key={number} className="flex flex-col gap-2">
              <button
                type="button"
                aria-pressed={marked}
                onClick={() => toggle(number)}
                className={clsx(
                  "flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-control border px-3.5 py-2.5 text-left transition-control",
                  marked
                    ? "border-amber bg-amber/10"
                    : "border-rule-strong bg-raised/50 hover:border-control-edge hover:bg-raised",
                )}
              >
                <span className="mt-0.5 w-5 shrink-0 text-sm text-ink-soft tabular-nums">{number}</span>
                <span className={clsx("min-w-0 flex-1", marked && "line-through decoration-amber/70")}>{sentence}</span>
                {marked && <ScanSearch aria-hidden="true" size={17} className="mt-0.5 shrink-0 text-amber" />}
              </button>

              {open === number && (
                <div className="ml-8 flex flex-col gap-2">
                  <label htmlFor={`fix-${nodeId}-${number}`} className="text-sm font-medium">
                    What&apos;s true instead?
                  </label>
                  <Textarea
                    id={`fix-${nodeId}-${number}`}
                    rows={2}
                    autoFocus
                    value={picks[number] ?? ""}
                    readOnly={pending}
                    onPaste={integrity.recordPaste}
                    onChange={(event) => {
                      integrity.recordTyping();
                      setError(null);
                      setPicks((all) => ({ ...all, [number]: event.target.value }));
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    {speechSupported && (
                      <Button variant="subtle" aria-pressed={speech.listening} onClick={speech.listening ? speech.stop : speech.start}>
                        {speech.listening ? <MicOff aria-hidden="true" size={16} /> : <Mic aria-hidden="true" size={16} />}
                        {speech.listening ? "Stop" : "Say it"}
                      </Button>
                    )}
                    <Button variant="subtle" onClick={() => unmark(number)}>
                      This one is fine
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <Button pending={pending} onClick={submit}>
          {pending ? "Checking" : tapped.length === 0 ? "Lock in my answer" : `Lock in ${tapped.length} ${tapped.length === 1 ? "catch" : "catches"}`}
        </Button>
        <p className="text-sm text-ink-soft">One go per round. Then you see where the mistakes were.</p>
      </div>
      {pending && <PendingNote message="Code checks your taps, then the AI checks your corrections." />}
      {error && !pending && <p className="text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}

/**
 * The reveal: every sentence, with where the mistakes really were. Caught ones go green,
 * missed ones amber with what was wrong, and a correct sentence that was tapped says so.
 */
export function CatchReveal({ attempt }: { attempt: Attempt }) {
  const record = attempt.catch;
  if (!record) return null;
  const planted = new Map(record.planted.map((item) => [item.sentence, item.why]));
  const picks = new Map(record.picks.map((pick) => [pick.sentence, pick]));
  const caught = record.picks.filter((pick) => pick.fixed).length;
  const falseAlarms = record.picks.filter((pick) => !planted.has(pick.sentence)).length;
  const cleanSweep = caught === record.planted.length && falseAlarms === 0;
  const seconds = Math.round(attempt.integrity.activeMs / 1000);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-lg font-medium">
          Caught {caught} of {record.planted.length}
          {falseAlarms > 0 && `, ${falseAlarms} false ${falseAlarms === 1 ? "alarm" : "alarms"}`}
        </p>
        {cleanSweep && (
          <span className="catch-stamp inline-flex items-center gap-1 rounded-control border border-proven bg-proven/15 px-2.5 py-1 text-sm font-semibold text-proven">
            <Sparkles aria-hidden="true" size={14} />
            Clean sweep{seconds > 0 && seconds < 600 ? ` in ${seconds}s` : ""}
          </span>
        )}
      </div>
      <ol className="flex flex-col gap-2">
        {record.sentences.map((sentence, index) => {
          const number = index + 1;
          const why = planted.get(number);
          const pick = picks.get(number);
          const tone = why ? (pick?.fixed ? "caught" : "missed") : pick ? "false" : "fine";
          return (
            <li
              key={number}
              style={{ animationDelay: `${index * 90}ms` }}
              className={clsx(
                "reveal-row flex flex-col gap-1 rounded-control border px-3.5 py-2.5",
                tone === "caught" && "border-proven bg-proven-surface",
                tone === "missed" && "border-amber bg-amber/10",
                tone === "false" && "border-danger/60 bg-danger/10",
                tone === "fine" && "border-rule bg-raised/30 text-ink-soft",
              )}
            >
              <p className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0" aria-hidden="true">
                  {tone === "caught" ? <Check size={17} className="text-proven" /> : tone === "fine" ? <span className="inline-block w-[17px]" /> : <X size={17} className={tone === "false" ? "text-danger" : "text-amber"} />}
                </span>
                <span className="min-w-0">
                  <span className="sr-only">{REVEAL_LABEL[tone]}: </span>
                  {sentence}
                </span>
              </p>
              {why && (
                <p className="ml-7 text-sm">
                  <span className="font-semibold">{pick?.fixed ? "You caught it." : pick ? "Right sentence, but the fix missed." : "Missed."}</span> {why}
                </p>
              )}
              {pick && <p className="ml-7 text-sm text-ink-soft">You said: “{pick.correction}”</p>}
              {tone === "false" && <p className="ml-7 text-sm">This one was right all along.</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The verdict of a catch round, then the reveal. A pass proves the topic: there is no follow-up. */
export function CatchResult({
  attempt,
  headingRef,
  nextStep,
  evidenceAction,
  onExplainInstead,
}: {
  attempt: Attempt;
  headingRef: Ref<HTMLHeadingElement>;
  nextStep?: ReactNode;
  evidenceAction?: ReactNode;
  onExplainInstead?: () => void;
}) {
  const proven = attempt.status === "proven";
  return (
    <div className="flex flex-col gap-5">
      <div
        className={clsx(
          "flex items-start gap-3.5 rounded-sheet border p-4",
          proven ? "border-proven/60 bg-proven-surface" : "border-dashed border-amber/60 bg-amber/5",
        )}
      >
        {proven ? (
          <CircleCheck aria-hidden="true" size={26} className="animate-tick mt-0.5 shrink-0 rounded-full text-proven" />
        ) : (
          <CircleDashed aria-hidden="true" size={26} className="mt-0.5 shrink-0 text-amber" />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <h3 ref={headingRef} tabIndex={-1} className="text-xl font-medium outline-none">
            {proven ? "Proven. You out-thought the AI." : "Not yet. The AI got one past you."}
          </h3>
          <p className="text-ink-soft">
            Score {attempt.grade.score} of 100.{" "}
            {proven ? "Anything that needed this topic is now open." : "Here's where the mistakes were. Now explain it in your own words."}
          </p>
        </div>
      </div>
      {nextStep}
      {evidenceAction}
      {!proven && onExplainInstead && (
        <Button onClick={onExplainInstead} className="self-start">
          Explain it in my own words
        </Button>
      )}
      <CatchReveal attempt={attempt} />
    </div>
  );
}

const REVEAL_LABEL = { caught: "Caught", missed: "Planted mistake", false: "Correct sentence you marked", fine: "Correct" };

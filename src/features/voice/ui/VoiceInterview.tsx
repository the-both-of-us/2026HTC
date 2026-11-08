"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Button, Field, StateMark, Textarea } from "@/shared/ui";
import type { AudioMeter, VoiceAdapters } from "../adapters/types";
import type { FallbackReason, VoiceNotice, VoicePhase, VoiceState, VoiceVerdict } from "../machine";
import { COUNTDOWN_MS, type InputMethod } from "../session";
import type { Transcript } from "../transcript";
import { Orb, type OrbMood } from "./Orb";
import { SpokenQuestion } from "./SpokenQuestion";
import { useVoiceInterview } from "./useVoiceInterview";

type AnswerHandler<Result> = (text: string, inputMethod: InputMethod) => Promise<Result> | Result;

export type VoiceInterviewProps = {
  attemptId: string;
  question: string;
  /** The course's final interview: the question mixes topics, so it isn't "about what you just explained". It also sits in a shorter box. */
  final?: boolean;
  /** Called whenever the interview moves to typing, with whatever has been heard. */
  onTypeInstead: (partialText: string) => void;
  /** Called once, when the learner starts answering: the microphone opens, or they type a first letter. */
  onBegin?: () => void;
  /** For the preview only. */
  adapters?: VoiceAdapters;
  /** For the preview only. */
  initial?: { state?: VoiceState; transcript?: Transcript; meter?: AudioMeter };
} & (
  | {
      /**
       * The learner sent an answer. Return { passed, feedback } to show the result here.
       * Throw if sending failed, and they can try again.
       */
      onAnswer: AnswerHandler<VoiceVerdict | void>;
      /** The way out of the verdict. Required, so that screen always has a next step. */
      onContinue: () => void;
    }
  | {
      /** The learner sent an answer, and the parent takes over from here. Throw if sending failed. */
      onAnswer: AnswerHandler<void>;
      onContinue?: undefined;
    }
);

/** One spoken follow-up question and its answer. A new attempt starts afresh. */
export function VoiceInterview(props: VoiceInterviewProps) {
  return <Interview key={props.attemptId} {...props} />;
}

const STATUS: Record<VoicePhase, string> = {
  ready: "Your follow-up question",
  thinking: "One moment",
  speaking: "Asking",
  "your-turn": "Your turn",
  listening: "Listening",
  heard: "Here's what I heard",
  checking: "Checking",
  verdict: "",
  "type-instead": "Type your answer",
};

const FALLBACK_SENTENCE: Record<FallbackReason, string> = {
  chosen: "",
  "mic-denied": "Microphone access is off, so voice can't hear you. You can allow it in your browser's site settings, or type here.",
  "mic-missing": "No microphone was found, so type your answer here.",
  unsupported: "This browser can't record for voice answers, so type your answer here.",
  token: "Voice answers aren't available right now, so type your answer here.",
  socket: "The connection to voice dropped. Your words are still here, so finish by typing.",
  "no-transcript": "Voice stopped picking up your words. What it heard is still here, so finish by typing.",
  tts: "The spoken question isn't available right now. Read it above and type your answer here.",
};

const NOTICE_SENTENCE: Record<VoiceNotice, string> = {
  "nothing-heard": "That didn't pick up any words. Check your microphone and try again, or type instead.",
  "send-failed": "We couldn't confirm your answer was received. It's still here, so you can send it again.",
  "no-spoken-question": "The spoken question isn't available right now, so read it above. I'm listening.",
};

function moodOf(state: VoiceState): OrbMood {
  switch (state.phase) {
    case "thinking":
    case "checking":
      return "thinking";
    case "speaking":
      return "voice";
    case "listening":
      return "mic";
    case "heard":
      return state.holding ? "mic" : "rest";
    case "verdict":
      return state.verdict?.passed ? "proven" : "not-yet";
    default:
      return "rest";
  }
}

function announcementFor(state: VoiceState, heardText: string): string {
  switch (state.phase) {
    case "speaking":
      return "Asking the question aloud. The microphone opens when it ends.";
    case "your-turn":
      return state.notice ? NOTICE_SENTENCE[state.notice] : "Your turn. Press Space or the Start talking button.";
    case "listening":
      return state.closing ? "Finishing up." : "Listening. Just stop talking when you're done, or press Space.";
    case "heard":
      if (state.notice) return NOTICE_SENTENCE[state.notice];
      return state.countdown
        ? `Here's what I heard: ${heardText}. It sends in 3 seconds. Press any key to stop it.`
        : `Here's what I heard: ${heardText}. Send it, edit it, or record again.`;
    case "checking":
      return "Checking your answer.";
    case "verdict":
      return state.verdict?.passed
        ? `Proven. ${state.verdict.feedback ?? ""}`
        : `Not yet. ${state.verdict?.feedback ?? ""}`;
    case "type-instead":
      return state.reason && state.reason !== "chosen" ? FALLBACK_SENTENCE[state.reason] : "Type your answer.";
    default:
      return "";
  }
}

function Interview({ attemptId, question, final = false, onAnswer, onTypeInstead, onBegin, onContinue, adapters, initial }: VoiceInterviewProps) {
  const { session, snapshot } = useVoiceInterview({ attemptId, onAnswer, onTypeInstead, adapters, initial });
  const { state, finalText, interimText, text, micLive, countdownEndsAt } = snapshot;
  const { phase, closing, holding, countdown, editing, reason, notice, verdict } = state;
  const baseId = useId();
  const questionId = `${baseId}-question`;
  const controlsRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const previousPhase = useRef(phase);

  const isAnswering = phase === "ready" || phase === "thinking" || phase === "speaking" || phase === "your-turn" || phase === "listening";
  const autoSending = phase === "heard" && (countdown || holding);

  // Space is the main action anywhere on the page, except where it means something else.
  useEffect(() => {
    if (!isAnswering) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, a, [contenteditable], [role=button], [role=dialog]")) return;
      event.preventDefault();
      session.send({ type: "PRIMARY" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAnswering, session]);

  // While the answer is about to send itself, any key stops it, so nobody is rushed.
  useEffect(() => {
    if (!autoSending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Shift" || event.key === "Control" || event.key === "Alt" || event.key === "Meta") return;
      session.send({ type: "STOP_COUNTDOWN" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [autoSending, session]);

  // Keep keyboard users where the next action is. Nothing moves on the very first render.
  useEffect(() => {
    if (previousPhase.current === phase) return;
    previousPhase.current = phase;
    if (phase === "type-instead") {
      editorRef.current?.querySelector("textarea")?.focus({ preventScroll: true });
    } else if (isAnswering || phase === "heard") {
      controlsRef.current?.querySelector("button")?.focus({ preventScroll: true });
    }
  }, [phase, isAnswering]);

  useEffect(() => {
    if (editing) editorRef.current?.querySelector("textarea")?.focus({ preventScroll: true });
  }, [editing]);

  // Tell the parent once when answering begins, for the evidence page's "began after" time.
  const began = useRef(false);
  useEffect(() => {
    if (began.current || !(phase === "listening" || (phase === "type-instead" && text))) return;
    began.current = true;
    onBegin?.();
  }, [phase, text, onBegin]);

  // Long answers keep the newest words in view.
  useLayoutEffect(() => {
    const box = captionRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [finalText, interimText]);

  const primaryLabel: Partial<Record<VoicePhase, string>> = {
    ready: "Answer aloud",
    thinking: "Answer now",
    speaking: "Answer now",
    "your-turn": "Start talking",
    listening: closing ? "Finishing" : "Done",
  };

  const announcement = announcementFor(state, text);
  const status = verdict
    ? verdict.passed
      ? "Proven"
      : "Not yet"
    : closing
      ? "Finishing up"
      : final && phase === "ready"
        ? "Final interview question"
        : STATUS[phase];

  return (
    <section
      aria-label={final ? "Final interview question" : "Spoken follow-up question"}
      className="@container rounded-sheet border border-rule bg-sheet"
    >
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      <div className="grid gap-x-8 gap-y-3 p-4 @2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @2xl:p-8">
        <div className="flex items-center justify-center @2xl:items-start @2xl:pt-4">
          <Orb
            mood={moodOf(state)}
            getMeter={() => session.activeMeter()}
            // On a phone, the answer needs the room more than the orb does.
            className={`block aspect-square w-full ${final ? "@2xl:max-w-[12rem]" : "@2xl:max-w-[22rem]"} ${
              phase === "heard" || phase === "type-instead"
                ? "max-w-[4.5rem]"
                : phase === "verdict"
                  ? "max-w-[7.5rem]"
                  : "max-w-[11.5rem]"
            }`}
          />
        </div>

        <div className={`flex min-w-0 flex-col ${final ? "min-h-[16rem]" : "min-h-[23rem] @2xl:min-h-[26rem]"}`}>
          <div className="flex min-h-7 items-center gap-2">
            {verdict?.passed && <StateMark state="proven" size={18} />}
            {(phase === "listening" || holding) && !closing && <LiveDot />}
            <p className={`text-sm font-semibold ${verdict?.passed ? "text-proven" : verdict ? "text-contour" : "text-forest-deep"}`}>
              {status}
            </p>
          </div>

          <div className="mt-2">
            <SpokenQuestion
              id={questionId}
              question={question}
              following={phase === "speaking"}
              getPosition={() => session.speechPosition()}
              size={phase === "verdict" || phase === "heard" || phase === "type-instead" ? "small" : "large"}
            />
          </div>

          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            {phase === "listening" && (
              <>
                {notice && <p className="mb-2 text-sm text-ink-soft">{NOTICE_SENTENCE[notice]}</p>}
                <LiveCaptions
                  boxRef={captionRef}
                  finalText={finalText}
                  interimText={interimText}
                  closing={closing}
                  micLive={micLive}
                />
              </>
            )}

            {(phase === "ready" || phase === "thinking" || phase === "speaking") && (
              <p className="text-base text-ink-soft">
                {phase === "ready"
                  ? `${final ? "It mixes topics you proved." : "It's about what you just explained."} One tap: you'll hear the question, then just answer out loud.`
                  : "The microphone opens when the question ends. Tap Answer now to start sooner."}
              </p>
            )}

            {phase === "your-turn" && (
              <p className="text-base text-ink-soft">
                {notice ? NOTICE_SENTENCE[notice] : "Tap when you're ready. The microphone stays off until then."}
              </p>
            )}

            {phase === "heard" && !editing && (
              <div className="flex flex-col gap-3">
                {notice && <p className="text-base text-danger">{NOTICE_SENTENCE[notice]}</p>}
                <p
                  className="cursor-text border-l-2 border-accent pl-4 text-lg leading-relaxed text-ink"
                  onClick={() => session.send({ type: "STOP_COUNTDOWN" })}
                >
                  {text}
                </p>
                {holding && <p className="text-sm text-ink-soft">Still listening for a moment, in case you have more to say.</p>}
                {countdownEndsAt !== null && <Countdown endsAt={countdownEndsAt} />}
              </div>
            )}

            {((phase === "heard" && editing) || phase === "type-instead") && (
              <Editor
                id={`${baseId}-answer`}
                questionId={questionId}
                editorRef={editorRef}
                phase={phase}
                reason={reason}
                notice={notice}
                text={text}
                onEdit={(value) => session.edit(value)}
              />
            )}

            {phase === "checking" && (
              <div className="text-base text-ink-soft">
                <p className="text-ink">{text}</p>
                <p className="mt-3 text-sm">Checking this against what you explained.</p>
              </div>
            )}

            {phase === "verdict" && (
              <div className="flex flex-col gap-3">
                {verdict?.feedback && <p className="text-xl font-medium text-pretty">{verdict.feedback}</p>}
                <p className="text-sm text-ink-soft">You said: {text}</p>
              </div>
            )}
          </div>

          <div ref={controlsRef} className="mt-5 flex min-h-13 flex-wrap items-center gap-x-3 gap-y-2">
            {isAnswering && (
              <Button
                size="lg"
                className="@max-md:px-4"
                pending={closing}
                aria-describedby={questionId}
                onClick={() => session.send({ type: "PRIMARY" })}
              >
                {primaryLabel[phase]}
                {!closing && <SpaceHint />}
              </Button>
            )}

            {phase === "heard" && (
              <>
                <Button size="lg" disabled={!text.trim()} onClick={() => session.send({ type: "SUBMIT" })}>
                  {autoSending ? "Send now" : "Send answer"}
                </Button>
                {!editing && (
                  <Button variant="subtle" size="lg" onClick={() => session.send({ type: "EDIT" })}>
                    Edit
                  </Button>
                )}
                <Button variant="quiet" onClick={() => session.send({ type: "RERECORD" })}>
                  Re-record
                </Button>
              </>
            )}

            {phase === "type-instead" && (
              <>
                <Button size="lg" disabled={!text.trim()} onClick={() => session.send({ type: "SUBMIT" })}>
                  Send answer
                </Button>
                {reason !== "mic-denied" && reason !== "mic-missing" && reason !== "unsupported" && (
                  <Button variant="quiet" onClick={() => session.send({ type: "RETRY_VOICE" })}>
                    Use voice
                  </Button>
                )}
              </>
            )}

            {phase === "your-turn" && (
              <Button variant="quiet" onClick={() => session.send({ type: "REPLAY" })}>
                Hear it again
              </Button>
            )}

            {isAnswering && (
              <Button variant="quiet" className="ml-auto @max-md:px-1" onClick={() => session.send({ type: "TYPE_INSTEAD" })}>
                Type instead
              </Button>
            )}

            {phase === "verdict" && onContinue && (
              <Button size="lg" onClick={onContinue}>
                Continue
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SpaceHint() {
  return (
    <kbd className="hidden rounded-[0.3rem] border border-on-dark/40 px-1.5 py-px font-sans text-xs font-medium text-on-dark @lg:inline-block">
      Space
    </kbd>
  );
}

/** A small pulsing dot: the microphone is open. It holds still with reduced motion. */
function LiveDot() {
  return (
    <span aria-hidden="true" className="relative flex size-2.5">
      <span className="absolute inline-flex size-full rounded-full bg-accent-bright opacity-60 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2.5 rounded-full bg-accent-bright" />
    </span>
  );
}

/** "Sending in 3", counting down, with a thin bar that empties. */
function Countdown({ endsAt }: { endsAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, endsAt - now);
  return (
    <div className="flex flex-col gap-1.5" aria-hidden="true">
      <p className="text-sm text-ink-soft tabular-nums">
        Sending in {Math.ceil(left / 1000)}. Press any key or Edit to stop.
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-rule">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (left / COUNTDOWN_MS) * 100)}%` }} />
      </div>
    </div>
  );
}

function LiveCaptions({
  boxRef,
  finalText,
  interimText,
  closing,
  micLive,
}: {
  boxRef: RefObject<HTMLDivElement | null>;
  finalText: string;
  interimText: string;
  closing: boolean;
  micLive: boolean;
}) {
  const empty = !finalText && !interimText;
  return (
    <div
      ref={boxRef}
      tabIndex={empty ? undefined : 0}
      aria-label="What you've said so far"
      className="max-h-48 min-h-20 overflow-y-auto border-l-2 border-forest pl-4 text-lg leading-relaxed @2xl:max-h-56"
    >
      {empty ? (
        <p className="text-locked">
          {closing
            ? "Finishing up."
            : micLive
              ? "Go ahead. Your words appear here as you talk."
              : "Allow your microphone if your browser asks."}
        </p>
      ) : (
        <p>
          <span className="text-ink">{finalText}</span>
          {finalText && interimText ? " " : ""}
          <span className="text-locked">{interimText}</span>
        </p>
      )}
    </div>
  );
}

function Editor({
  id,
  questionId,
  editorRef,
  phase,
  reason,
  notice,
  text,
  onEdit,
}: {
  id: string;
  questionId: string;
  editorRef: RefObject<HTMLDivElement | null>;
  phase: VoicePhase;
  reason: FallbackReason | null;
  notice: VoiceNotice | null;
  text: string;
  onEdit: (value: string) => void;
}) {
  const hint =
    phase === "heard"
      ? "This exact text is what gets checked. Fix anything it misheard. An edited answer is recorded as typed."
      : undefined;
  const fallback = phase === "type-instead" && reason ? FALLBACK_SENTENCE[reason] : "";
  return (
    <div ref={editorRef} className="flex flex-col gap-3">
      {fallback && <p className="text-base text-ink">{fallback}</p>}
      {notice && <p className="text-base text-danger">{NOTICE_SENTENCE[notice]}</p>}
      <Field id={id} label="Your answer" hint={hint}>
        {(control) => (
          <Textarea
            {...control}
            aria-describedby={[questionId, control["aria-describedby"]].filter(Boolean).join(" ")}
            rows={5}
            value={text}
            onChange={(event) => onEdit(event.target.value)}
          />
        )}
      </Field>
    </div>
  );
}

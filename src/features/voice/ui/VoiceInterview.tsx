"use client";

import { useEffect, useId, useLayoutEffect, useRef, type RefObject } from "react";
import { Button, Field, StateMark, Textarea } from "@/shared/ui";
import type { AudioMeter, VoiceAdapters } from "../adapters/types";
import type { FallbackReason, VoiceNotice, VoicePhase, VoiceState, VoiceVerdict } from "../machine";
import type { InputMethod } from "../session";
import type { Transcript } from "../transcript";
import { Orb, type OrbMood } from "./Orb";
import { SpokenQuestion } from "./SpokenQuestion";
import { useVoiceInterview } from "./useVoiceInterview";

type AnswerHandler<Result> = (text: string, inputMethod: InputMethod) => Promise<Result> | Result;

export type VoiceInterviewProps = {
  attemptId: string;
  question: string;
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
};

function moodOf(phase: VoicePhase, verdict: VoiceVerdict | null): OrbMood {
  switch (phase) {
    case "thinking":
    case "checking":
      return "thinking";
    case "speaking":
      return "voice";
    case "listening":
      return "mic";
    case "verdict":
      return verdict?.passed ? "proven" : "not-yet";
    case "your-turn":
      return "voice";
    default:
      return "rest";
  }
}

function announcementFor(state: VoiceState, heardText: string): string {
  switch (state.phase) {
    case "speaking":
      return "Asking the question aloud.";
    case "your-turn":
      return state.notice ? NOTICE_SENTENCE[state.notice] : "Your turn. Press Space or the Start talking button.";
    case "listening":
      return state.closing ? "Finishing up." : "Listening. Press Space or the Done button when you finish.";
    case "heard":
      return state.notice ? NOTICE_SENTENCE[state.notice] : `Here's what I heard: ${heardText}. Edit it if needed, then send.`;
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

function Interview({ attemptId, question, onAnswer, onTypeInstead, onBegin, onContinue, adapters, initial }: VoiceInterviewProps) {
  const { session, snapshot } = useVoiceInterview({ attemptId, onAnswer, onTypeInstead, adapters, initial });
  const { state, finalText, interimText, text, micLive } = snapshot;
  const { phase, closing, reason, notice, verdict } = state;
  const baseId = useId();
  const questionId = `${baseId}-question`;
  const controlsRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const previousPhase = useRef(phase);

  const isAnswering = phase === "ready" || phase === "thinking" || phase === "speaking" || phase === "your-turn" || phase === "listening";

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

  // Keep keyboard users where the next action is. Nothing moves on the very first render.
  useEffect(() => {
    if (previousPhase.current === phase) return;
    previousPhase.current = phase;
    if (phase === "heard" || phase === "type-instead") {
      editorRef.current?.querySelector("textarea")?.focus({ preventScroll: true });
    } else if (isAnswering) {
      controlsRef.current?.querySelector("button")?.focus({ preventScroll: true });
    }
  }, [phase, isAnswering]);

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
    ready: "Hear the question",
    thinking: "Answer now",
    speaking: "Answer now",
    "your-turn": "Start talking",
    listening: closing ? "Finishing" : "Done",
  };

  const announcement = announcementFor(state, text);
  const status = verdict ? (verdict.passed ? "Proven" : "Not yet") : closing ? "Finishing up" : STATUS[phase];

  return (
    <section
      aria-label="Spoken follow-up question"
      className="@container rounded-sheet border border-rule bg-sheet"
    >
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      <div className="grid gap-x-8 gap-y-3 p-4 @2xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @2xl:p-8">
        <div className="flex items-center justify-center @2xl:items-start @2xl:pt-4">
          <Orb
            mood={moodOf(phase, verdict)}
            getMeter={() => session.activeMeter()}
            // On a phone, an answer box needs the room more than the orb does.
            className={`block aspect-square w-full @2xl:max-w-[22rem] ${
              phase === "heard" || phase === "type-instead"
                ? "max-w-[4.5rem]"
                : phase === "verdict"
                  ? "max-w-[7.5rem]"
                  : "max-w-[11.5rem]"
            }`}
          />
        </div>

        <div className="flex min-h-[23rem] min-w-0 flex-col @2xl:min-h-[26rem]">
          <div className="flex min-h-7 items-center gap-2">
            {verdict?.passed && <StateMark state="proven" size={18} />}
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
              <LiveCaptions
                boxRef={captionRef}
                finalText={finalText}
                interimText={interimText}
                closing={closing}
                micLive={micLive}
              />
            )}

            {(phase === "ready" || phase === "thinking" || phase === "speaking") && (
              <p className="text-base text-ink-soft">
                {phase === "ready" ? "It's about what you just explained. Listen, then answer out loud." : ""}
              </p>
            )}

            {phase === "your-turn" && (
              <p className="text-base text-ink-soft">
                {notice ? NOTICE_SENTENCE[notice] : "Take a moment if you need one. The microphone stays off until you tap."}
              </p>
            )}

            {(phase === "heard" || phase === "type-instead") && (
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
                  Send answer
                </Button>
                <Button variant="subtle" size="lg" onClick={() => session.send({ type: "SAY_MORE" })}>
                  Say more
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
  phase: "heard" | "type-instead";
  reason: FallbackReason | null;
  notice: VoiceNotice | null;
  text: string;
  onEdit: (value: string) => void;
}) {
  const hint =
    phase === "heard"
      ? "This exact text is what gets checked. Fix anything it misheard. Edited answers are recorded as typed."
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

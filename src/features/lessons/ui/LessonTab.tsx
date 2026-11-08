"use client";

import { Clock } from "lucide-react";
import { useEffect, useState } from "react";
import type { PublicSkillNode } from "@/shared/types";
import { Button, ErrorNotice, InlineText, ReadAloudButton } from "@/shared/ui";
import type { Lesson } from "../types";
import { fetchLesson } from "./api";

export type LessonTabProps = {
  mapId: string;
  skill: PublicSkillNode;
  /** Shown as "Prove <skill>" at the end, when the learner can prove this skill. */
  onReady?: () => void;
};

type Phase = { kind: "loading" } | { kind: "ready"; lesson: Lesson } | { kind: "error"; message: string };

/** The Read tab: a 3 to 5 minute lesson, written on first open and saved for everyone after. */
export function LessonTab(props: LessonTabProps) {
  // Keyed, so opening another skill starts from a clean slate.
  return <LessonBody key={`${props.mapId}/${props.skill.id}`} {...props} />;
}

function LessonBody({ mapId, skill, onReady }: LessonTabProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchLesson(mapId, skill.id).then((result) => {
      if (cancelled) return;
      setPhase(result.ok ? { kind: "ready", lesson: result.lesson } : { kind: "error", message: result.message });
    });
    return () => {
      cancelled = true;
    };
  }, [mapId, skill.id, attempt]);

  if (phase.kind === "loading") return <LessonSkeleton />;
  if (phase.kind === "error") {
    return (
      <ErrorNotice
        message={phase.message}
        onRetry={() => {
          setPhase({ kind: "loading" });
          setAttempt((count) => count + 1);
        }}
      />
    );
  }

  const { lesson } = phase;

  return (
    <article className="flex max-w-[65ch] flex-col gap-6 text-[1.0625rem] leading-7">
      <div className="flex flex-col items-start gap-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
          <span className="inline-flex items-center gap-1.5 font-medium text-ink">
            <Clock aria-hidden="true" size={15} />
            {lesson.readingMinutes} min read
          </span>
          <span aria-hidden="true">·</span>
          {/* The model never sees the posting or PDF, so the lesson cannot quote it. Verified
              quotes stay in "Where this came from". */}
          <span>Written by AI. Check important facts.</span>
        </p>
        <ReadAloudButton what="this lesson" text={lessonAloud(skill.title, lesson)} />
      </div>

      <section className="flex flex-col gap-3">
        <h4 className="font-display text-lg font-semibold">The idea</h4>
        {lesson.idea.map((paragraph, index) => (
          <p key={index}>
            <InlineText text={paragraph} />
          </p>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h4 className="font-display text-lg font-semibold">An example</h4>
        <p>
          <InlineText text={lesson.example.intro} />
        </p>
        {lesson.example.code && (
          // Focusable, so a keyboard can scroll a long line of code sideways.
          <pre tabIndex={0} aria-label="Code example" className="overflow-x-auto rounded-control border border-rule-strong bg-paper p-4 font-mono text-sm leading-6">
            <code>{lesson.example.code}</code>
          </pre>
        )}
        <p>
          <InlineText text={lesson.example.after} />
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h4 className="font-display text-lg font-semibold">Common mistakes</h4>
        <ul className="flex flex-col gap-3">
          {lesson.mistakes.map((item, index) => (
            <li key={index} className="border-l-2 border-rule-strong pl-3">
              <p className="font-medium">
                <InlineText text={item.mistake} />
              </p>
              <p className="text-ink-soft">
                <InlineText text={item.fix} />
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h4 className="font-display text-lg font-semibold">Check yourself</h4>
        {lesson.checks.map((check, index) => (
          <CheckQuestion key={index} question={check.question} answer={check.answer} />
        ))}
      </section>

      {onReady && (
        <div className="flex flex-col items-start gap-2 border-t border-rule pt-5">
          <p className="text-ink-soft">Got it? Proving it in your own words is how it sticks.</p>
          <Button onClick={onReady}>Prove {skill.title}</Button>
        </div>
      )}
    </article>
  );
}

function CheckQuestion({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2 rounded-control border border-rule-strong bg-raised/50 p-4">
      <p className="font-medium">
        <InlineText text={question} />
      </p>
      <Button variant="subtle" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide answer" : "Show answer"}
      </Button>
      {open && (
        <p className="text-ink-soft">
          <InlineText text={answer} />
        </p>
      )}
    </div>
  );
}

function LessonSkeleton() {
  return (
    <div className="flex max-w-[65ch] flex-col gap-3">
      <p role="status" className="text-sm text-ink-soft">
        Writing your lesson. The first read of a skill takes about 20 seconds, then it is saved.
      </p>
      {["w-1/3", "w-full", "w-11/12", "w-4/5", "w-1/4", "w-full", "w-2/3"].map((width, index) => (
        <div key={index} aria-hidden="true" className={`h-4 rounded-sm bg-raised motion-safe:animate-pulse ${width}`} />
      ))}
    </div>
  );
}

/** Everything a learner can read, in order, for the Read aloud button. The answers stay hidden. */
function lessonAloud(title: string, lesson: Lesson): string {
  return [
    `${title}. The idea.`,
    ...lesson.idea,
    "An example.",
    lesson.example.intro,
    lesson.example.after,
    "Common mistakes.",
    ...lesson.mistakes.map((item) => `${item.mistake} ${item.fix}`),
    "Check yourself.",
    ...lesson.checks.map((item) => item.question),
  ].join(" ");
}

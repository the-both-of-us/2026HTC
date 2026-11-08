"use client";

import {
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock,
  FlaskConical,
  Lightbulb,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { PublicSkillNode } from "@/shared/types";
import { Button, ErrorNotice, ReadAloudButton } from "@/shared/ui";
import type { Lesson } from "../types";
import { fetchLesson } from "./api";
import { HighlightedCode, MdBlocks, MdInline, plainText, unfence } from "./LessonMarkdown";

export type LessonTabProps = {
  mapId: string;
  skill: PublicSkillNode;
  /** Shown as "Prove <skill>" at the end, when the learner can prove this skill. */
  onReady?: () => void;
  /** Shown after the lesson, before "Prove <skill>", once the lesson has loaded (the skill's Shorts). */
  afterLesson?: ReactNode;
};

type Phase = { kind: "loading" } | { kind: "ready"; lesson: Lesson } | { kind: "error"; message: string };

/** The Read tab: a 3 to 5 minute lesson, written on first open and saved for everyone after. */
export function LessonTab(props: LessonTabProps) {
  // Keyed, so opening another skill starts from a clean slate.
  return <LessonBody key={`${props.mapId}/${props.skill.id}`} {...props} />;
}

function LessonBody({ mapId, skill, onReady, afterLesson }: LessonTabProps) {
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
    // In the full-page view (data-reading-page on the panel), the lesson fills the column in larger type.
    <article className="flex max-w-[65ch] flex-col gap-6 text-[1.0625rem] leading-7 lg:in-data-[reading-page]:max-w-none lg:in-data-[reading-page]:gap-8 lg:in-data-[reading-page]:text-[1.25rem] lg:in-data-[reading-page]:leading-8">
      <div className="flex flex-col items-start gap-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft lg:in-data-[reading-page]:text-base">
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

      <Section icon={Lightbulb} tone="idea" title="The idea">
        {lesson.idea.map((paragraph, index) => (
          <MdBlocks key={index} text={paragraph} />
        ))}
      </Section>

      <Section icon={FlaskConical} tone="example" title="An example">
        <MdBlocks text={lesson.example.intro} />
        {lesson.example.code && (
          // Focusable, so a keyboard can scroll a long line of code sideways.
          <pre
            tabIndex={0}
            aria-label="Code example"
            className="overflow-x-auto rounded-control border border-rule-strong border-l-4 border-l-read-example bg-paper p-4 font-mono text-sm leading-6 lg:in-data-[reading-page]:text-base lg:in-data-[reading-page]:leading-7"
          >
            <HighlightedCode code={unfence(lesson.example.code)} />
          </pre>
        )}
        <MdBlocks text={lesson.example.after} />
      </Section>

      <Section icon={TriangleAlert} tone="mistakes" title="Common mistakes">
        <ul className="flex flex-col gap-3">
          {lesson.mistakes.map((item, index) => (
            <li key={index} className="flex flex-col gap-2 rounded-control border border-rule-strong bg-sheet p-4">
              <p className="flex gap-2.5 font-medium">
                <CircleX aria-hidden="true" size={18} className="mt-[0.3em] shrink-0 text-danger" />
                <span>
                  <span className="sr-only">Mistake: </span>
                  <MdInline text={item.mistake} />
                </span>
              </p>
              <p className="flex gap-2.5 text-ink-soft">
                <CircleCheck aria-hidden="true" size={18} className="mt-[0.3em] shrink-0 text-proven" />
                <span>
                  <span className="sr-only">Fix: </span>
                  <MdInline text={item.fix} />
                </span>
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={CircleHelp} tone="checks" title="Check yourself">
        {lesson.checks.map((check, index) => (
          <CheckQuestion key={index} question={check.question} answer={check.answer} />
        ))}
      </Section>

      {afterLesson}

      {onReady && (
        <div className="flex flex-col items-start gap-2 border-t border-rule pt-5">
          <p className="text-ink-soft">Got it? Proving it in your own words is how it sticks.</p>
          <Button onClick={onReady}>Prove {skill.title}</Button>
        </div>
      )}
    </article>
  );
}

const TONES = {
  idea: "bg-read-key/15 text-read-key",
  example: "bg-read-example/15 text-read-example",
  mistakes: "bg-danger/12 text-danger",
  checks: "bg-read-tip/15 text-read-tip",
} as const;

/** A lesson section: its heading carries a coloured mark, so each kind of part is easy to find again. */
function Section({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: LucideIcon;
  tone: keyof typeof TONES;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h4 className="flex items-center gap-2.5 font-display text-lg font-semibold lg:in-data-[reading-page]:text-2xl">
        <span
          aria-hidden="true"
          className={`flex size-8 shrink-0 items-center justify-center rounded-full ${TONES[tone]}`}
        >
          <Icon size={17} />
        </span>
        {title}
      </h4>
      {children}
    </section>
  );
}

function CheckQuestion({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2 rounded-control border border-rule-strong border-l-4 border-l-read-tip bg-raised/50 p-4">
      <p className="font-medium">
        <MdInline text={question} />
      </p>
      <Button variant="subtle" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide answer" : "Show answer"}
      </Button>
      {open && (
        <div className="flex flex-col gap-2 text-ink-soft">
          <MdBlocks text={answer} />
        </div>
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
    ...lesson.idea.map(plainText),
    "An example.",
    plainText(lesson.example.intro),
    plainText(lesson.example.after),
    "Common mistakes.",
    ...lesson.mistakes.map((item) => `${plainText(item.mistake)} ${plainText(item.fix)}`),
    "Check yourself.",
    ...lesson.checks.map((item) => plainText(item.question)),
  ].join(" ");
}

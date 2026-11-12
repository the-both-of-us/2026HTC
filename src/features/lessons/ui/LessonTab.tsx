"use client";

import {
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock,
  FlaskConical,
  Lightbulb,
  Pencil,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { PublicSkillNode } from "@/shared/types";
import { Button, ErrorNotice, Field, pollLoop, ReadAloudButton, Spinner, Textarea } from "@/shared/ui";
import type { Lesson, LessonPart, PracticeCase, PracticeFeedback, PracticeHint } from "../types";
import { checkPractice, fetchLessonStep, fetchPracticeHint } from "./api";
import { draftOfLesson, draftOfParts, type LessonDraft } from "./draft";
import { HighlightedCode, MdBlocks, MdInline, plainText, unfence } from "./LessonMarkdown";

/** How often to ask again while the lesson is being written. */
const LESSON_POLL_MS = 1500;
/** The writer has 60 s on the server; stop asking a little after that and offer a retry. */
const GIVE_UP_MS = 150_000;

export type LessonTabProps = {
  mapId: string;
  skill: PublicSkillNode;
  /** Shown as "Prove <skill>" at the end, when the learner can prove this skill. */
  onReady?: () => void;
  /** Shown after the lesson, before "Prove <skill>", once the lesson has loaded (the skill's Shorts). */
  afterLesson?: ReactNode;
  /** Shown at the very end of a finished lesson: where to go next. */
  nextStep?: ReactNode;
  /**
   * Changes each time the learner selects the topic again. If the lesson is showing the "Try again"
   * failure, a new value starts a new attempt instead of leaving the stale failure up.
   */
  reselect?: number;
};

type Phase =
  | { kind: "loading" }
  | { kind: "writing"; attempt: number; parts: LessonPart[] }
  | { kind: "ready"; lesson: Lesson }
  | { kind: "error"; message: string };

/** "Written by AI (Claude Haiku, 12 s)." when the lesson says which model wrote it. */
function writtenByLine({ writtenBy }: Lesson): string {
  if (!writtenBy) return "Written by AI. Check important facts.";
  const seconds = Math.max(1, Math.round(writtenBy.ms / 1000));
  return `Written by AI (${writtenBy.model}, ${seconds} s). Check important facts.`;
}

/** The Read tab: a 3 to 5 minute lesson, written on first open and saved for everyone after. */
export function LessonTab(props: LessonTabProps) {
  // Keyed, so opening another skill starts from a clean slate.
  return <LessonBody key={`${props.mapId}/${props.skill.id}`} {...props} />;
}

function LessonBody({ mapId, skill, onReady, afterLesson, nextStep, reselect = 0 }: LessonTabProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  // The first POST starts the writer (or joins one already running); each answer carries the parts
  // so far. One request at a time, none while the tab is hidden, and it ends with the final lesson.
  useEffect(() => {
    const abort = new AbortController();
    const startedAt = Date.now();
    void pollLoop(
      async (signal) => {
        const step = await fetchLessonStep(mapId, skill.id, signal);
        if (signal.aborted) return false;
        if (step.kind === "lesson") {
          setPhase({ kind: "ready", lesson: step.lesson });
          return false;
        }
        if (step.kind === "error") {
          setPhase({ kind: "error", message: step.message });
          return false;
        }
        if (Date.now() - startedAt > GIVE_UP_MS) {
          setPhase({ kind: "error", message: "Writing the lesson is taking too long. Please try again in a moment." });
          return false;
        }
        setPhase({ kind: "writing", attempt: step.attempt, parts: step.parts });
        return true;
      },
      LESSON_POLL_MS,
      abort.signal,
      "now",
    );
    return () => abort.abort();
  }, [mapId, skill.id, attempt]);

  // Selecting the topic again while the failure is showing is the same as pressing Try again.
  const [seenReselect, setSeenReselect] = useState(reselect);
  if (seenReselect !== reselect) {
    setSeenReselect(reselect);
    if (phase.kind === "error") {
      setPhase({ kind: "loading" });
      setAttempt((count) => count + 1);
    }
  }

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

  const ready = phase.kind === "ready";
  const draft = ready ? draftOfLesson(phase.lesson) : draftOfParts(phase.parts);
  const lesson = ready ? phase.lesson : null;
  // A second attempt means the first was rejected: the parts are a rewrite, swapped in under a note.
  const improving = phase.kind === "writing" && phase.attempt > 1;
  if (!ready && phase.parts.length === 0) return <LessonSkeleton improving={improving} />;


  return (
    <LessonArticle
      mapId={mapId}
      skill={skill}
      draft={draft}
      lesson={lesson}
      improving={improving}
      afterLesson={afterLesson}
      onReady={onReady}
      nextStep={nextStep}
    />
  );
}

/**
 * The lesson page. With `lesson` it is final (reading time, who wrote it, read aloud, practice
 * boxes, "Prove"). Without it, it draws the parts written so far in order, with "Writing…" under the last.
 */
export function LessonArticle({
  mapId,
  skill,
  draft,
  lesson,
  improving = false,
  afterLesson,
  onReady,
  nextStep,
}: {
  mapId: string;
  skill: Pick<PublicSkillNode, "id" | "title">;
  draft: LessonDraft;
  lesson: Lesson | null;
  improving?: boolean;
  afterLesson?: ReactNode;
  onReady?: () => void;
  nextStep?: ReactNode;
}) {
  const writing = lesson === null;
  return (
    // In the full-page view (data-reading-page on the panel), the lesson fills the column in larger type.
    <article
      aria-busy={writing}
      className="flex max-w-[65ch] flex-col gap-6 text-[1.0625rem] leading-7 lg:in-data-[reading-page]:max-w-none lg:in-data-[reading-page]:gap-8 lg:in-data-[reading-page]:text-[1.25rem] lg:in-data-[reading-page]:leading-8"
    >
      <div className="flex flex-col items-start gap-3">
        {lesson ? (
          <>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft lg:in-data-[reading-page]:text-base">
              <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                <Clock aria-hidden="true" size={15} />
                {lesson.readingMinutes} min read
              </span>
              <span aria-hidden="true">·</span>
              {/* The model never sees the posting or PDF, so the lesson cannot quote it. Verified
                  quotes stay in "Where this came from". */}
              <span>{writtenByLine(lesson)}</span>
            </p>
            <ReadAloudButton what="this lesson" text={lessonAloud(skill.title, lesson)} />
          </>
        ) : (
          <p role="status" className="flex items-center gap-2 text-sm text-ink-soft">
            <Spinner size={14} />
            {improving ? "Improving this lesson…" : "Writing this lesson. You can start reading as the parts arrive."}
          </p>
        )}
      </div>

      {draft.idea.length > 0 && (
        <Section icon={Lightbulb} tone="idea" title="The idea">
          {draft.idea.map((paragraph, index) => (
            <MdBlocks key={index} text={paragraph} />
          ))}
        </Section>
      )}

      {draft.example && (
        <Section icon={FlaskConical} tone="example" title="An example">
          <MdBlocks text={draft.example.intro} />
          {draft.example.code && (
            // Focusable, so a keyboard can scroll a long line of code sideways.
            <pre
              tabIndex={0}
              aria-label="Code example"
              className="overflow-x-auto rounded-control border border-rule-strong border-l-4 border-l-read-example bg-paper p-4 font-mono text-sm leading-6 lg:in-data-[reading-page]:text-base lg:in-data-[reading-page]:leading-7"
            >
              <HighlightedCode code={unfence(draft.example.code)} />
            </pre>
          )}
          <MdBlocks text={draft.example.after} />
        </Section>
      )}

      {draft.mistakes.length > 0 && (
        <Section icon={TriangleAlert} tone="mistakes" title="Common mistakes">
          <ul className="flex flex-col gap-3">
            {draft.mistakes.map((item, index) => (
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
      )}

      {draft.checks.length > 0 && (
        <Section icon={CircleHelp} tone="checks" title="Check yourself">
          {draft.checks.map((check, index) => (
            <CheckQuestion key={index} question={check.question} answer={check.answer} />
          ))}
        </Section>
      )}

      {draft.practice.length > 0 && (
        <Section icon={Pencil} tone="practice" title="Practice">
          {draft.practice.map((practice, index) =>
            lesson ? (
              <PracticeQuestion key={index} mapId={mapId} nodeId={skill.id} index={index} practice={practice} />
            ) : (
              <PracticePreview key={index} practice={practice} />
            ),
          )}
        </Section>
      )}

      {writing && (
        <p role="status" className="flex items-center gap-2 text-ink-soft">
          <Spinner size={16} />
          Writing…
        </p>
      )}

      {lesson && afterLesson}

      {lesson && onReady && (
        <div className="flex flex-col items-start gap-2 border-t border-rule pt-5">
          <p className="text-ink-soft">Got it? Proving it in your own words is how it sticks.</p>
          <Button onClick={onReady}>Prove {skill.title}</Button>
        </div>
      )}

      {lesson && nextStep && <div className="flex flex-col items-start gap-2 border-t border-rule pt-5">{nextStep}</div>}
    </article>
  );
}

const TONES = {
  idea: "bg-read-key/15 text-read-key",
  example: "bg-read-example/15 text-read-example",
  mistakes: "bg-danger/12 text-danger",
  checks: "bg-read-tip/15 text-read-tip",
  practice: "bg-read-key/15 text-read-key",
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

const VERDICT_LABELS: Record<PracticeFeedback["verdict"], string> = {
  solid: "Solid",
  partly: "Partly there",
  off: "Not yet",
};

/** Hints 1 to 3 get more specific; the step after them shows a model answer. */
const HINT_COUNT = 3;

function hintButtonLabel(shown: number, loading: boolean): string {
  if (shown >= HINT_COUNT) return loading ? "Getting the answer" : "Show a model answer";
  if (loading) return "Getting a hint";
  return shown === 0 ? "Get a hint" : `Get a clearer hint (${shown + 1} of ${HINT_COUNT})`;
}

/**
 * A practice case: a situation, a question and a box. Checking an answer gets a verdict and a
 * specific note. A stuck learner can ask for up to three hints, each clearer than the last and
 * written for what they have typed, and then for a model answer. Practice never counts as proof.
 */
function PracticeQuestion({ mapId, nodeId, index, practice }: { mapId: string; nodeId: string; index: number; practice: PracticeCase }) {
  const [answer, setAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<PracticeFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hints, setHints] = useState<PracticeHint[]>([]);
  const [hinting, setHinting] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);
  const id = `practice-${nodeId}-${index}`;
  const modelAnswer = hints.find((hint) => hint.kind === "answer") ?? null;
  const shownHints = hints.filter((hint) => hint.kind === "hint");

  async function check() {
    setChecking(true);
    setError(null);
    const result = await checkPractice(mapId, nodeId, index, answer);
    setChecking(false);
    if (result.ok) setFeedback(result.feedback);
    else setError(result.message);
  }

  async function moreHelp() {
    setHinting(true);
    setHintError(null);
    const result = await fetchPracticeHint(mapId, nodeId, index, hints.length + 1, answer);
    setHinting(false);
    if (result.ok) setHints((all) => [...all, result.hint]);
    else setHintError(result.message);
  }

  return (
    <div className="flex flex-col items-start gap-3 rounded-control border border-rule-strong border-l-4 border-l-read-key bg-raised/50 p-4">
      <p className="text-ink-soft">
        <MdInline text={practice.scenario} />
      </p>
      <Field id={id} label={practice.question} error={error} className="w-full">
        {(control) => (
          <Textarea {...control} rows={4} value={answer} onChange={(event) => setAnswer(event.target.value)} disabled={checking} />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="subtle" size="sm" onClick={check} disabled={checking || answer.trim() === ""}>
          {checking ? "Checking" : "Check my answer"}
        </Button>
        {!modelAnswer && (
          <Button variant="subtle" size="sm" onClick={moreHelp} disabled={hinting}>
            {hintButtonLabel(shownHints.length, hinting)}
          </Button>
        )}
      </div>
      {feedback && (
        <p role="status" className="text-ink-soft">
          <span className="font-semibold text-ink">{VERDICT_LABELS[feedback.verdict]}.</span> {feedback.feedback}
        </p>
      )}
      <div role="status" aria-live="polite" className="flex w-full flex-col gap-2">
        {shownHints.length > 0 && (
          <ol className="flex flex-col gap-2">
            {shownHints.map((hint) => (
              <li key={hint.step} className="border-l-2 border-rule-strong pl-3 text-ink-soft">
                <span className="font-semibold text-ink">
                  Hint {hint.step} of {HINT_COUNT}.
                </span>{" "}
                <MdInline text={hint.text} />
              </li>
            ))}
          </ol>
        )}
        {modelAnswer && (
          <div className="border-l-2 border-read-key pl-3">
            <p className="font-semibold text-ink">A model answer</p>
            <p className="text-ink-soft">
              <MdInline text={modelAnswer.text} />
            </p>
            <p className="mt-1 text-sm text-ink-soft">Compare it with yours. Practice is not graded and does not count toward proving the skill.</p>
          </div>
        )}
        {hintError && <p className="text-sm text-ink-soft">{hintError}</p>}
      </div>
    </div>
  );
}

/** A practice case while the lesson is still being written: read-only, the box opens once it is final. */
function PracticePreview({ practice }: { practice: PracticeCase }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-control border border-rule-strong border-l-4 border-l-read-key bg-raised/50 p-4">
      <p className="text-ink-soft">
        <MdInline text={practice.scenario} />
      </p>
      <p className="font-medium">
        <MdInline text={practice.question} />
      </p>
      <p className="text-sm text-ink-soft">You can answer this once the lesson is finished.</p>
    </div>
  );
}

export function LessonSkeleton({ improving = false }: { improving?: boolean }) {
  return (
    <div className="flex max-w-[65ch] flex-col gap-3">
      <p role="status" className="text-sm text-ink-soft">
        {improving
          ? "Improving this lesson…"
          : "Writing your lesson. The first part shows in a few seconds, and the rest follows. It is saved for everyone after."}
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
    ...(lesson.practice?.length ? ["Practice.", ...lesson.practice.map((item) => `${plainText(item.scenario)} ${plainText(item.question)}`)] : []),
  ].join(" ");
}

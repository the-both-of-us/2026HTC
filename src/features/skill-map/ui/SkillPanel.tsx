import { FlashcardsTab } from "@/features/flashcards/client";
import { LessonTab } from "@/features/lessons/client";
import { ShareProofButton } from "@/features/proof/client";
import { QuizTab } from "@/features/quiz/client";
import { SkillShorts } from "@/features/reels/client";
import { ResourcesTab } from "@/features/resources/client";
import { assignFormats, FormatBadge, TeachBackPanel } from "@/features/teachback/client";
import clsx from "clsx";
import { BadgeCheck, ChevronRight, LockOpen, Maximize2, Minimize2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Citation, NodeState, PublicSkillNode, SourceKind } from "@/shared/types";
import {
  Badge,
  Button,
  buttonClasses,
  InlineText,
  NODE_STATE_LABELS,
  PretestBadge,
  prefersReducedMotion,
  ReadAloudButton,
  StateMark,
} from "@/shared/ui";
import type { NextStep } from "../nextStep";
import { JobAsksTag } from "./SkillNodeView";
import { StudyTabs } from "./StudyTabs";

/** What just changed, shown under the verdict after a skill is proven. */
export type ProvenNotice = { nodeId: string; unlockedIds: string[] };

type SkillPanelProps = {
  mapId: string;
  skills: PublicSkillNode[];
  skill: PublicSkillNode;
  states: Record<string, NodeState>;
  sourceKind: SourceKind;
  notice: ProvenNotice | null;
  /** The one next step after this skill. Always returns something, so the notice and the Read tab never come up empty. */
  nextStepFor: (currentNodeId: string, justUnlockedIds: string[]) => NextStep;
  /** Acts on a step that is not a link: opens the skill, unit, unit test or final. */
  onNextStep: (step: NextStep) => void;
  /** Counts each time a skill is selected, even the one already open (a retry for a failed lesson). */
  selectCount?: number;
  /** Only the map's owner can attempt its skills. */
  isOwner: boolean;
  /** The server checked its voice key works, so voice answers can be offered. */
  voiceReady: boolean;
  onSelect: (nodeId: string) => void;
  onProven: (nodeId: string) => void;
  /** "Unlock anyway": saves the unlock on the server. Throws an Error with a sentence for people. */
  onUnlock: (nodeId: string) => Promise<void>;
  /** Open only because it was unlocked anyway, before what it builds on was proven. */
  unlockedEarly: boolean;
  /** Topics proved by a pre-test question, not by an explanation. */
  knownIds?: ReadonlySet<string>;
  onClose: () => void;
  /** The streak and combo just earned, shown with what the proof opened. */
  reward?: ReactNode;
  /** The quick check that relights a proved skill that has started to fade. */
  relight?: ReactNode;
  /** Start in full-page reading, as when a course page links straight to this skill. */
  initialFullPage?: boolean;
};

const SOURCE_NAME: Record<SourceKind, string> = { posting: "posting", pdf: "PDF", topic: "topic" };

/** Everything about one skill: beside the map on large screens, a bottom sheet on phones. */
export function SkillPanel({
  mapId,
  skills,
  skill,
  states,
  sourceKind,
  notice,
  nextStepFor,
  onNextStep,
  selectCount = 0,
  isOwner,
  voiceReady,
  onSelect,
  onProven,
  onUnlock,
  unlockedEarly,
  knownIds,
  onClose,
  reward,
  relight,
  initialFullPage = false,
}: SkillPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const teachRef = useRef<HTMLElement>(null);
  // Full page covers the map so a lesson reads like a page, not a sidebar. It stays on
  // while you move between skills, until you go back to the map.
  const [fullPage, setFullPage] = useState(initialFullPage);
  const state = states[skill.id] ?? "locked";
  const known = state === "proven" && knownIds?.has(skill.id) === true;
  // A proof can land while another skill is open. The notice then belongs to that other skill.
  const ownNotice = notice?.nodeId === skill.id ? notice : null;

  const titleOf = (id: string) => skills.find((other) => other.id === id)?.title ?? id;
  const dependants = skills.filter((other) => other.prerequisites.includes(skill.id));
  const allProven = skills.every((other) => states[other.id] === "proven");
  const provenCount = skills.filter((other) => states[other.id] === "proven").length;
  const format = assignFormats(skills)[skill.id];
  // These tabs are typed for a full SkillNode, but only show its title and citation. Their
  // routes load the checkpoints on the server, so the browser never needs them.
  const studySkill = { ...skill, checkpoints: [] };
  const canProve = state !== "locked" && isOwner;

  // "Prove it" at the end of the lesson: down to the teach-back, with the cursor in its box if it has one.
  function goToTeachBack() {
    teachRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    teachRef.current?.querySelector("textarea")?.focus({ preventScroll: true });
  }

  // Read comes first, so you can learn a skill before you prove it. Anyone may read ahead.
  const study = (
    <StudyTabs
      tabs={[
        {
          id: "read",
          label: "Read",
          content: (
            <LessonTab
              mapId={mapId}
              skill={skill}
              reselect={selectCount}
              onReady={canProve && state !== "proven" ? goToTeachBack : undefined}
              // A finished lesson on a skill you already proved ends on where to go next.
              nextStep={
                state === "proven" ? (
                  <NextStepView step={nextStepFor(skill.id, [])} onGo={onNextStep} />
                ) : undefined
              }
              afterLesson={<SkillShorts mapId={mapId} nodeId={skill.id} />}
            />
          ),
        },
        ...(state === "locked"
          ? []
          : [
              { id: "flashcards", label: "Flashcards", content: <FlashcardsTab mapId={mapId} skill={studySkill} /> },
              { id: "quiz", label: "Quiz", content: <QuizTab mapId={mapId} skill={studySkill} /> },
            ]),
        // Looked up when the tab first opens, since each lookup spends a search quota.
        { id: "resources", label: "Resources", lazy: true, content: <ResourcesTab mapId={mapId} nodeId={skill.id} /> },
      ]}
    />
  );

  // Opening a skill moves focus here, so keyboard and screen reader users land on it.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    panelRef.current?.scrollTo({ top: 0 });
  }, [skill.id]);

  // Once a skill is proven, the panel goes back to the top, where the verdict is, and focus
  // moves to what the learner can do next. That sits right under the verdict, so it's in view.
  useEffect(() => {
    if (!ownNotice) return;
    panelRef.current?.scrollTo({ top: 0 });
    const next = noticeRef.current?.querySelector("button");
    (next ?? noticeRef.current)?.focus({ preventScroll: true });
  }, [ownNotice]);

  const nextStep = ownNotice && (
    <div
      ref={noticeRef}
      tabIndex={-1}
      role="status"
      className="flex flex-col gap-3 rounded-sheet border border-proven/60 bg-proven-surface p-4"
    >
      {reward}
      <p className="font-medium">
        {ownNotice.unlockedIds.length > 0
          ? `That opens ${listInWords(ownNotice.unlockedIds.map(titleOf))}.`
          : `${titleOf(ownNotice.nodeId)} is proven.`}
        {allProven && " Every skill on this map is now proven."}
      </p>
      <NextStepView step={nextStepFor(ownNotice.nodeId, ownNotice.unlockedIds)} onGo={onNextStep} primary />
    </div>
  );

  // "Built on", or what a locked skill waits for.
  const prerequisites = skill.prerequisites.length > 0 && (
    <section>
      <h3 className="mb-2 text-sm font-medium text-ink-soft">
        {state === "locked" ? "This skill opens once these are proven" : "Built on"}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {skill.prerequisites.map((id) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onSelect(id)}
              className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-control border border-rule-strong bg-raised/50 px-3 py-2 text-left transition-control hover:border-control-edge hover:bg-raised"
            >
              <StateMark state={states[id] ?? "locked"} size={15} className="shrink-0" />
              <span className="min-w-0 flex-1">{titleOf(id)}</span>
              <span className="shrink-0 text-sm text-ink-soft">
                {states[id] === "proven" && knownIds?.has(id) ? "Known (pre-test)" : NODE_STATE_LABELS[states[id] ?? "locked"]}
              </span>
              <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-ink-soft" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  
  );

  return (
    <>
      {/* On phones the sheet covers most of the screen. Tapping above it closes it.
          On large screens the panel is position: relative, so screen-reader-only text deep
          inside it is clipped by its scrolling instead of making the whole page taller. */}
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-20 bg-black/60 lg:hidden" />

      <section
        ref={panelRef}
        aria-labelledby="skill-panel-title"
        className={clsx(
          "panel-open fixed inset-x-0 bottom-0 overflow-y-auto border-t-2 border-ink bg-sheet",
          fullPage
            ? // Phones: the whole screen, above the site's top bar (z-40), so its buttons stay
              // reachable. Large screens: over the map area, since the parent row is relative.
              "top-0 z-50 border-t-0 lg:absolute lg:inset-0 lg:z-30"
            : "z-30 max-h-[88dvh] lg:relative lg:max-h-none lg:w-[28rem] lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l",
        )}
      >
        {/* The extra bottom padding keeps the end of the sheet clear of the phone's nav pill. */}
        <div
          // Lets what's inside (the lesson) read larger in full page: Tailwind's in-data-[reading-page]:.
          data-reading-page={fullPage || undefined}
          className={clsx(
            "flex flex-col gap-5 p-5 pb-24 lg:pb-6",
            // A wide reading page with larger text, so it uses the screen without long, small lines.
            fullPage && "mx-auto w-full max-w-5xl lg:gap-7 lg:px-10 lg:pt-5 lg:pb-16",
          )}
        >
          <header
            className={clsx(
              "flex items-start justify-between gap-3",
              // Full page: one slim row that stays at the top while you read.
              fullPage &&
                "sticky top-0 z-10 -mx-5 -mt-5 items-center border-b border-rule bg-sheet/95 px-5 py-2.5 backdrop-blur lg:-mx-10 lg:px-10",
            )}
          >
            <div
              className={clsx(
                "flex min-w-0",
                fullPage ? "flex-wrap items-center gap-x-3 gap-y-1.5" : "flex-col items-start gap-2",
              )}
            >
              <h2
                id="skill-panel-title"
                ref={headingRef}
                tabIndex={-1}
                className={clsx(
                  "text-xl leading-snug font-medium outline-none",
                  fullPage && "text-lg lg:text-2xl lg:leading-tight",
                )}
              >
                {skill.title}
              </h2>
              {/* Phones in full page keep the reading bar to one line: the badges are for the map view. */}
              <div className={clsx("flex flex-wrap items-center gap-2", fullPage && "max-sm:hidden")}>
                {known ? <PretestBadge /> : <Badge tone={state} />}
                {unlockedEarly && state === "available" && <Badge>Unlocked early</Badge>}
                <FormatBadge format={format} compact />
                {skill.fromSource ? (
                  <JobAsksTag kind={skill.citation?.kind} />
                ) : (
                  <Badge>{sourceKind === "topic" ? "AI-generated" : "Foundation"}</Badge>
                )}
              </div>
              {/* Only in Accessible learning mode. */}
              <ReadAloudButton what="this skill" text={skillReadAloud(skill)} />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-pressed={fullPage}
                onClick={() => setFullPage((on) => !on)}
                className="flex min-h-10 cursor-pointer items-center gap-2 rounded-control border border-rule-strong px-3 text-sm font-medium text-ink-soft transition-control hover:border-control-edge hover:bg-raised hover:text-ink"
              >
                {fullPage ? (
                  <Minimize2 aria-hidden="true" size={16} className="shrink-0" />
                ) : (
                  <Maximize2 aria-hidden="true" size={16} className="shrink-0" />
                )}
                {/* Icon only on phones, where the title needs the room. */}
                <span className="sr-only sm:not-sr-only">{fullPage ? "Back to map" : "Full page"}</span>
              </button>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-soft transition-control hover:bg-raised hover:text-ink"
              >
                <X aria-hidden="true" size={20} />
              </button>
            </div>
          </header>

          {/* Just proven: the verdict moves up, so the payoff is the first thing in view. */}
          {!ownNotice && (
            <>
              {fullPage ? (
                // Full page: the skill's background folds into one line, so the lesson starts near the top.
                <details className="group rounded-sheet border border-rule-strong bg-raised/50">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-ink-soft [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      aria-hidden="true"
                      size={16}
                      className="shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
                    />
                    <span className="shrink-0 font-medium text-ink">About this skill</span>
                    <span className="min-w-0 truncate group-open:hidden">
                      <InlineText text={skill.why} />
                    </span>
                  </summary>
                  <div className="flex flex-col gap-5 px-4 pb-4">
                    <p className="text-ink-soft lg:text-xl">
                      <InlineText text={skill.why} />
                    </p>
                    <section>
                      <h3 className="mb-2 text-sm font-medium text-ink-soft">Where this came from</h3>
                      <CitationBlock
                        citation={skill.citation}
                        sourceKind={sourceKind}
                        fromSource={skill.fromSource}
                        leadsTo={dependants.map((other) => other.title)}
                      />
                    </section>
                    {state !== "locked" && prerequisites}
                  </div>
                </details>
              ) : (
                <>
                <p className={clsx("text-ink-soft", fullPage && "lg:text-xl")}>
                  <InlineText text={skill.why} />
                </p>

                <section className="rounded-sheet border border-rule-strong bg-raised/50 p-4">
                  <h3 className="mb-2 text-sm font-medium text-ink-soft">Where this came from</h3>
                  <CitationBlock
                    citation={skill.citation}
                    sourceKind={sourceKind}
                    fromSource={skill.fromSource}
                    leadsTo={dependants.map((other) => other.title)}
                  />
                </section>
                </>
              )}
              {(!fullPage || state === "locked") && prerequisites}

              {/* Nothing is written for a locked skill: no lesson, cards or quiz until it opens. */}
              {state === "locked" ? (
                <UnlockAnyway key={skill.id} isOwner={isOwner} onUnlock={() => onUnlock(skill.id)} />
              ) : (
                study
              )}
            </>
          )}

          {isOwner && relight}

          {state !== "locked" && !isOwner && (
            <p className="border-t border-rule pt-5">
              This map belongs to someone else, so only they can prove skills on it.{" "}
              <Link href="/" className="font-medium text-accent-bright underline underline-offset-4">
                Build your own from a posting.
              </Link>
            </p>
          )}

          {canProve && (
            <section ref={teachRef} className="scroll-mt-4 border-t border-rule pt-5">
              <TeachBackPanel
                key={skill.id}
                mapId={mapId}
                node={skill}
                state={state}
                pretest={known}
                voiceReady={voiceReady}
                format={format}
                onProven={onProven}
                nextStep={nextStep}
                evidenceAction={provenCount > 0 && <ShareProofButton mapId={mapId} provenCount={provenCount} />}
              />
            </section>
          )}

          {/* Just proven: the verdict stays on top, and studying moves below it. */}
          {ownNotice && study}
        </div>
      </section>
    </>
  );
}

/** The header button's words for a step. */
export function nextStepButtonLabel(step: NextStep, nothingProvenYet: boolean): string {
  switch (step.kind) {
    case "skill":
      return nothingProvenYet ? "Start learning" : "Continue";
    case "unit-test":
      return "Take the unit test";
    case "unit":
      return `Start Unit ${step.unitNumber}`;
    case "final":
      return "Final interview";
    case "program":
      return step.nextCourseNumber ? "Next course" : "Back to program";
    case "finished":
      return "Dashboard";
    case "waiting":
      return "Continue";
  }
}

/** One sentence and, when there is somewhere to go, one button. Used after a proof and at the end of a lesson. */
export function NextStepView({ step, onGo, primary = false }: { step: NextStep; onGo: (step: NextStep) => void; primary?: boolean }) {
  const variant = primary ? "primary" : "subtle";
  switch (step.kind) {
    case "skill":
      return (
        <Button variant={variant} onClick={() => onGo(step)}>
          {step.reason === "unlocked" ? "Explain" : "Next skill:"} {step.title}
        </Button>
      );
    case "unit-test":
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-ink-soft">Every topic in {step.unitTitle} is proven. Its unit test is next.</p>
          <Button variant={variant} onClick={() => onGo(step)}>
            Take the unit test
          </Button>
        </div>
      );
    case "unit":
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-ink-soft">Unit {step.unitNumber}, {step.unitTitle}, is ready to start.</p>
          <Button variant={variant} onClick={() => onGo(step)}>
            Start Unit {step.unitNumber}
          </Button>
        </div>
      );
    case "final":
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-ink-soft">Every topic is proven. The final interview is open.</p>
          <Button variant={variant} onClick={() => onGo(step)}>
            Start the final interview
          </Button>
        </div>
      );
    case "program":
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-ink-soft">
            {step.nextCourseNumber
              ? `You finished this course. Course ${step.nextCourseNumber} of ${step.programTitle} is next.`
              : `You finished the last course of ${step.programTitle}.`}
          </p>
          <Link href={step.href} className={buttonClasses(variant)}>
            {step.nextCourseNumber ? "Go to the next course" : "Back to the program"}
          </Link>
        </div>
      );
    case "finished":
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-ink-soft">You finished this course.</p>
          <Link href={step.href} className={buttonClasses(variant)}>
            Go to your dashboard
          </Link>
        </div>
      );
    case "waiting":
      return <p className="text-ink-soft">{step.message}</p>;
  }
}

/** What a locked skill shows instead of its lesson, flashcards and quiz. */
function UnlockAnyway({ isOwner, onUnlock }: { isOwner: boolean; onUnlock: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    setPending(true);
    setError(null);
    try {
      await onUnlock();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The skill could not be unlocked this time. Please try again.");
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-sheet border border-dashed border-control-edge bg-raised/50 p-4">
      <h3 className="font-medium">The lesson, flashcards and quiz open with this skill</h3>
      {isOwner ? (
        <>
          <p className="text-ink-soft">
            Prove the skills above first, or unlock it now if you already know them. Unlocking opens
            everything here, including proving it, and the map marks it as unlocked early.
          </p>
          <div>
            <Button variant="subtle" onClick={unlock} disabled={pending}>
              <LockOpen aria-hidden="true" size={16} />
              {pending ? "Unlocking…" : "Unlock anyway"}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </>
      ) : (
        <p className="text-ink-soft">They open once the skills above are proven on your own copy of this map.</p>
      )}
    </section>
  );
}

function CitationBlock({
  citation,
  sourceKind,
  fromSource,
  leadsTo,
}: {
  citation: Citation | null;
  sourceKind: SourceKind;
  fromSource: boolean;
  leadsTo: string[];
}) {
  const source = SOURCE_NAME[sourceKind];

  if (sourceKind === "topic") {
    return (
      <p>
        AI-generated from the topic you named. There is no source to check it against, so this
        skill has no citation.
      </p>
    );
  }

  if (citation?.verified) {
    return (
      <figure className="flex flex-col gap-2">
        <blockquote className="leading-7">
          <span className="box-decoration-clone rounded-sm bg-highlight px-1">{citation.quote}</span>
        </blockquote>
        <figcaption className="flex items-center gap-1.5 text-sm font-medium text-accent-bright">
          <BadgeCheck aria-hidden="true" size={15} className="shrink-0" />
          Verified quote from the {SOURCE_NAME[citation.kind]}
          {citation.page ? `, page ${citation.page}` : ""}
        </figcaption>
      </figure>
    );
  }

  if (citation) {
    return (
      <p>
        Not verified. OryxLearn could not find this wording{" "}
        {sourceKind === "pdf" ? "on the page of the PDF the AI named" : `in the ${source}`}, so it is not
        shown as a quote. Check the {source} yourself.
      </p>
    );
  }

  if (!fromSource && leadsTo.length > 0) {
    return (
      <p>
        The {source} does not name this directly. It is a foundation for {listInWords(leadsTo)}.
      </p>
    );
  }

  return <p>OryxLearn has no quote from the {source} for this skill. Check the {source} yourself.</p>;
}

/** What "Read this skill aloud" says: the name, why it matters, and a verified quote. */
function skillReadAloud(skill: PublicSkillNode): string {
  const quote = skill.citation?.verified ? ` The ${SOURCE_NAME[skill.citation.kind]} says: ${skill.citation.quote}` : "";
  return `${skill.title}. ${skill.why}${quote}`;
}

/** "A", "A and B", "A, B and C". */
function listInWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

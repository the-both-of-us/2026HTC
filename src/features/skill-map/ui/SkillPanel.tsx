import { FlashcardsTab } from "@/features/flashcards/client";
import { ShareProofButton } from "@/features/proof/client";
import { QuizTab } from "@/features/quiz/client";
import { TeachBackPanel } from "@/features/teachback/client";
import clsx from "clsx";
import { BadgeCheck, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Citation, NodeState, PublicSkillNode, SourceKind } from "@/shared/types";
import { Badge, Button, NODE_STATE_LABELS, StateMark } from "@/shared/ui";
import { JobAsksTag } from "./SkillNodeView";

/** What just changed, shown under the verdict after a skill is proven. */
export type ProvenNotice = { nodeId: string; unlockedIds: string[] };

type SkillPanelProps = {
  mapId: string;
  skills: PublicSkillNode[];
  skill: PublicSkillNode;
  states: Record<string, NodeState>;
  sourceKind: SourceKind;
  notice: ProvenNotice | null;
  /** Only the map's owner can attempt its skills. */
  isOwner: boolean;
  onSelect: (nodeId: string) => void;
  onProven: (nodeId: string) => void;
  onClose: () => void;
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
  isOwner,
  onSelect,
  onProven,
  onClose,
}: SkillPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const state = states[skill.id] ?? "locked";
  // A proof can land while another skill is open. The notice then belongs to that other skill.
  const ownNotice = notice?.nodeId === skill.id ? notice : null;

  const titleOf = (id: string) => skills.find((other) => other.id === id)?.title ?? id;
  const dependants = skills.filter((other) => other.prerequisites.includes(skill.id));
  const allProven = skills.every((other) => states[other.id] === "proven");
  const provenCount = skills.filter((other) => states[other.id] === "proven").length;
  // These tabs are typed for a full SkillNode, but only show its title and citation. Their
  // routes load the checkpoints on the server, so the browser never needs them.
  const studySkill = { ...skill, checkpoints: [] };

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
      <p className="font-medium">
        {ownNotice.unlockedIds.length > 0
          ? `That opens ${listInWords(ownNotice.unlockedIds.map(titleOf))}.`
          : `${titleOf(ownNotice.nodeId)} is proven.`}
        {allProven && " Every skill on this map is now proven."}
      </p>
      {ownNotice.unlockedIds.map((id, index) => (
        <Button key={id} variant={index === 0 ? "primary" : "subtle"} onClick={() => onSelect(id)}>
          Explain {titleOf(id)}
        </Button>
      ))}
    </div>
  );

  return (
    <>
      {/* On phones the sheet covers most of the screen. Tapping above it closes it. */}
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-20 bg-black/60 lg:hidden" />

      <section
        ref={panelRef}
        aria-labelledby="skill-panel-title"
        className={clsx(
          "panel-open fixed inset-x-0 bottom-0 z-30 max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-rule-strong bg-sheet shadow-panel",
          "lg:static lg:max-h-none lg:w-[28rem] lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l",
        )}
      >
        {/* The extra bottom padding keeps the end of the sheet clear of the phone's nav pill. */}
        <div className="flex flex-col gap-5 p-5 pb-24 lg:pb-6">
          <header className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col items-start gap-2">
              <h2
                id="skill-panel-title"
                ref={headingRef}
                tabIndex={-1}
                className="text-xl leading-snug font-medium outline-none"
              >
                {skill.title}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={state} />
                {skill.fromSource ? (
                  <JobAsksTag kind={skill.citation?.kind} />
                ) : (
                  <Badge>{sourceKind === "topic" ? "AI-generated" : "Foundation"}</Badge>
                )}
              </div>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-control text-ink-soft transition-control hover:bg-raised hover:text-ink"
            >
              <X aria-hidden="true" size={20} />
            </button>
          </header>

          {/* Just proven: the verdict moves up, so the payoff is the first thing in view. */}
          {!ownNotice && (
            <>
              <p className="text-ink-soft">{skill.why}</p>

              <section className="rounded-sheet border border-rule-strong bg-raised/50 p-4">
                <h3 className="mb-2 text-sm font-medium text-ink-soft">Where this came from</h3>
                <CitationBlock
                  citation={skill.citation}
                  sourceKind={sourceKind}
                  fromSource={skill.fromSource}
                  leadsTo={dependants.map((other) => other.title)}
                />
              </section>

              {skill.prerequisites.length > 0 && (
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
                            {NODE_STATE_LABELS[states[id] ?? "locked"]}
                          </span>
                          <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-ink-soft" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

            </>
          )}

          {state !== "locked" && !isOwner && (
            <p className="border-t border-rule pt-5">
              This map belongs to someone else, so only they can prove skills on it.{" "}
              <Link href="/" className="font-medium text-accent-bright underline underline-offset-4">
                Build your own from a posting.
              </Link>
            </p>
          )}

          {state !== "locked" && isOwner && (
            <section className="border-t border-rule pt-5">
              <TeachBackPanel
                key={skill.id}
                mapId={mapId}
                node={skill}
                state={state}
                onProven={onProven}
                nextStep={nextStep}
                evidenceAction={provenCount > 0 && <ShareProofButton mapId={mapId} provenCount={provenCount} />}
              />
            </section>
          )}

          {state !== "locked" && (
            <>
              <FlashcardsTab mapId={mapId} skill={studySkill} />
              <QuizTab mapId={mapId} skill={studySkill} />
            </>
          )}
        </div>
      </section>
    </>
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

/** "A", "A and B", "A, B and C". */
function listInWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

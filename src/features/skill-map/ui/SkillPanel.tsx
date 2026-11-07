import { FlashcardsTab } from "@/features/flashcards/client";
import { QuizTab } from "@/features/quiz/client";
import { TeachBackPanel } from "@/features/teachback/client";
import clsx from "clsx";
import { useEffect, useRef } from "react";
import type { Citation, NodeState, PublicSkillNode, SourceKind } from "@/shared/types";
import { Badge, Button, StateMark } from "@/shared/ui";
import { JobTab } from "./SkillNodeView";

/** What just changed, shown under the result after a skill is proven. */
export type ProvenNotice = { nodeId: string; unlockedIds: string[] };

type SkillPanelProps = {
  mapId: string;
  skills: PublicSkillNode[];
  skill: PublicSkillNode;
  states: Record<string, NodeState>;
  sourceKind: SourceKind;
  notice: ProvenNotice | null;
  onSelect: (nodeId: string) => void;
  onProven: (nodeId: string) => void;
  onClose: () => void;
};

const SOURCE_NAME: Record<SourceKind, string> = { posting: "posting", pdf: "PDF" };

/** Everything about one skill: a side panel on large screens, a bottom sheet on phones. */
export function SkillPanel({
  mapId,
  skills,
  skill,
  states,
  sourceKind,
  notice,
  onSelect,
  onProven,
  onClose,
}: SkillPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const state = states[skill.id] ?? "locked";

  const titleOf = (id: string) => skills.find((other) => other.id === id)?.title ?? id;
  const dependants = skills.filter((other) => other.prerequisites.includes(skill.id));
  const allProven = skills.every((other) => states[other.id] === "proven");
  // These tabs are typed for a full SkillNode, but only show its title and citation. Their
  // routes load the checkpoints on the server, so the browser never needs them.
  const studySkill = { ...skill, checkpoints: [] };

  // Opening a skill moves focus here, so keyboard and screen reader users land on it.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.closest("aside")?.scrollTo({ top: 0 });
  }, [skill.id]);

  // Once a skill is proven, focus moves to what the learner can do next. The notice
  // sits right under the result, so the result stays in view.
  useEffect(() => {
    if (!notice) return;
    const next = noticeRef.current?.querySelector("button");
    (next ?? noticeRef.current)?.focus();
  }, [notice]);

  return (
    <>
      {/* On phones the sheet covers most of the screen. Tapping above it closes it. */}
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-20 bg-black/60 lg:hidden" />

      <aside
        aria-labelledby="skill-panel-title"
        className={clsx(
          "panel-open fixed inset-x-0 bottom-0 z-30 max-h-[88dvh] overflow-y-auto rounded-t-control border-t-2 border-ink bg-sheet",
          "lg:absolute lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-[30rem] lg:rounded-none lg:border-2",
        )}
      >
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <header className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col items-start gap-2.5">
              <h2
                id="skill-panel-title"
                ref={headingRef}
                tabIndex={-1}
                className="text-2xl font-medium outline-none"
              >
                {skill.title}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={state} />
                {skill.fromSource ? (
                  <JobTab inline />
                ) : (
                  <span className="font-display text-sm italic">Foundation</span>
                )}
              </div>
            </div>
            <Button variant="subtle" size="sm" onClick={onClose} className="shrink-0">
              Close
            </Button>
          </header>

          <section>
            <h3 className="mb-1 text-base font-semibold">Why it matters</h3>
            <p>{skill.why}</p>
          </section>

          <section>
            <h3 className="mb-1 text-base font-semibold">Where this came from</h3>
            <CitationBlock
              citation={skill.citation}
              sourceKind={sourceKind}
              fromSource={skill.fromSource}
              leadsTo={dependants.map((other) => other.title)}
            />
          </section>

          {skill.prerequisites.length > 0 && (
            <section>
              <h3 className="mb-1 text-base font-semibold">Prove first</h3>
              {state === "locked" && <p className="mb-1">This skill opens once these are proven.</p>}
              <ul className="flex flex-col gap-1">
                {skill.prerequisites.map((id) => (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => onSelect(id)}
                      className="flex min-h-10 cursor-pointer items-center gap-2 text-left underline decoration-1 underline-offset-4 hover:decoration-2"
                    >
                      <StateMark state={states[id] ?? "locked"} size={18} className="shrink-0" />
                      {titleOf(id)}
                      <span className="sr-only">, {states[id] ?? "locked"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {state !== "locked" && (
            <section className="border-t border-rule pt-5">
              <TeachBackPanel
                key={skill.id}
                mapId={mapId}
                node={skill}
                state={state}
                onProven={onProven}
              />
            </section>
          )}

          {state !== "locked" && (
            <>
              <FlashcardsTab mapId={mapId} skill={studySkill} />
              <QuizTab mapId={mapId} skill={studySkill} />
            </>
          )}

          {notice && (
            <div
              ref={noticeRef}
              tabIndex={-1}
              role="status"
              className="flex flex-col gap-3 rounded-control border-2 border-proven bg-paper p-4"
            >
              <p className="font-semibold">
                {titleOf(notice.nodeId)} is proven.
                {notice.unlockedIds.length > 0 &&
                  ` That opens ${listInWords(notice.unlockedIds.map(titleOf))}.`}
                {allProven && " Every skill on this map is now proven."}
              </p>
              {notice.unlockedIds.map((id) => (
                <Button key={id} variant="primary" onClick={() => onSelect(id)}>
                  Explain {titleOf(id)}
                </Button>
              ))}
            </div>
          )}
        </div>
      </aside>
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

  if (citation?.verified) {
    return (
      <figure className="flex flex-col gap-1.5">
        <figcaption className="text-sm font-semibold text-forest">
          Verified quote from the {SOURCE_NAME[citation.kind]}
          {citation.page ? `, page ${citation.page}` : ""}
        </figcaption>
        <blockquote className="font-display text-base leading-7">
          <span className="box-decoration-clone bg-highlight px-1">{citation.quote}</span>
        </blockquote>
      </figure>
    );
  }

  if (citation) {
    return (
      <p>
        Not verified. OryxLearn could not find this wording in the {source}, so it is not shown as a
        quote. Check the {source} yourself.
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

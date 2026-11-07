import clsx from "clsx";
import { Lock } from "lucide-react";
import type { NodeState, PublicSkillNode } from "@/shared/types";
import { StateMark } from "@/shared/ui";
import { JobAsksTag } from "./SkillNodeView";

const GROUPS: { state: NodeState; heading: string; empty: string }[] = [
  { state: "available", heading: "Ready to prove", empty: "Nothing is open right now." },
  { state: "proven", heading: "Proven", empty: "Nothing proven yet. Your first skill will show here." },
  { state: "locked", heading: "Locked", empty: "Nothing is locked." },
];

const ROW_CLASSES: Record<NodeState, string> = {
  locked: "border-dashed border-locked/50 bg-locked-surface/60 text-ink-soft hover:border-locked",
  available: "border-accent/60 bg-sheet hover:border-accent-bright hover:shadow-glow",
  proven: "border-proven/50 bg-proven-surface/70 hover:border-proven",
};

type SkillListProps = {
  skills: PublicSkillNode[];
  states: Record<string, NodeState>;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
};

/** The same skills as the map, as plain lists. The default on phones, and for screen readers. */
export function SkillList({ skills, states, selectedId, onSelect }: SkillListProps) {
  const titleOf = (id: string) => skills.find((skill) => skill.id === id)?.title ?? id;

  return (
    <div className="flex flex-col gap-8 pb-8">
      {GROUPS.map(({ state, heading, empty }) => {
        const group = skills.filter((skill) => (states[skill.id] ?? "locked") === state);
        return (
          <section key={state} aria-labelledby={`skills-${state}`}>
            <h2 id={`skills-${state}`} className="mb-3 flex items-center gap-2 text-lg font-medium">
              <StateMark state={state} size={16} />
              {heading}
              <span className="text-sm font-normal text-ink-soft tabular-nums">{group.length}</span>
            </h2>
            {group.length === 0 ? (
              <p className="rounded-sheet border border-dashed border-rule-strong px-4 py-5 text-center text-ink-soft">
                {empty}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {group.map((skill) => {
                  const waitingOn = skill.prerequisites.filter((id) => states[id] !== "proven");
                  return (
                    <li key={skill.id}>
                      <button
                        type="button"
                        data-skill-button={skill.id}
                        aria-expanded={selectedId === skill.id}
                        onClick={() => onSelect(skill.id)}
                        className={clsx(
                          "flex min-h-14 w-full cursor-pointer items-start gap-3 rounded-sheet border p-3.5 text-left transition-control aria-expanded:ring-2 aria-expanded:ring-ink",
                          ROW_CLASSES[state],
                        )}
                      >
                        <StateMark state={state} size={18} className="mt-0.5 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block leading-6 font-medium">{skill.title}</span>
                          <span className="mt-0.5 line-clamp-2 block text-sm text-ink-soft">
                            {state === "locked" && waitingOn.length > 0
                              ? `Needs ${waitingOn.map(titleOf).join(", ")}`
                              : skill.why}
                          </span>
                        </span>
                        {skill.fromSource ? (
                          <JobAsksTag />
                        ) : (
                          <span className="shrink-0 text-sm text-ink-soft">Foundation</span>
                        )}
                        {state === "locked" && (
                          <Lock aria-hidden="true" size={15} className="mt-1 shrink-0" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

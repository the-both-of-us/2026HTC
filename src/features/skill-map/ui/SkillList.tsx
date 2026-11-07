import type { NodeState, SkillNode } from "@/shared/types";
import { StateMark } from "@/shared/ui";
import { JobTab } from "./SkillNodeView";

const GROUPS: { state: NodeState; heading: string; empty: string }[] = [
  { state: "available", heading: "Ready to prove", empty: "Nothing is open right now." },
  { state: "proven", heading: "Proven", empty: "Nothing proven yet." },
  { state: "locked", heading: "Locked", empty: "Nothing is locked." },
];

type SkillListProps = {
  skills: SkillNode[];
  states: Record<string, NodeState>;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
};

/** The same skills as the map, as plain lists. Used on phones and by screen readers. */
export function SkillList({ skills, states, selectedId, onSelect }: SkillListProps) {
  const titleOf = (id: string) => skills.find((skill) => skill.id === id)?.title ?? id;

  return (
    <div className="flex flex-col gap-8 pb-8">
      {GROUPS.map(({ state, heading, empty }) => {
        const group = skills.filter((skill) => (states[skill.id] ?? "locked") === state);
        return (
          <section key={state} aria-labelledby={`skills-${state}`}>
            <h2 id={`skills-${state}`} className="mb-2 flex items-center gap-2 text-xl font-medium">
              <StateMark state={state} size={20} />
              {heading}
              <span className="font-sans text-base font-normal text-ink-soft">{group.length}</span>
            </h2>
            {group.length === 0 ? (
              <p className="text-ink-soft">{empty}</p>
            ) : (
              <ul className="flex flex-col border-t border-rule">
                {group.map((skill) => {
                  const waitingOn = skill.prerequisites.filter((id) => states[id] !== "proven");
                  return (
                    <li key={skill.id} className="border-b border-rule">
                      <button
                        type="button"
                        data-skill-button={skill.id}
                        aria-expanded={selectedId === skill.id}
                        onClick={() => onSelect(skill.id)}
                        className="flex min-h-14 w-full cursor-pointer items-start gap-3 py-3 text-left hover:bg-sheet aria-expanded:bg-highlight"
                      >
                        <StateMark state={state} size={22} className="mt-0.5 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span
                            className={
                              skill.fromSource
                                ? "block font-display text-lg leading-6 font-semibold"
                                : "block text-lg leading-6"
                            }
                          >
                            {skill.title}
                          </span>
                          {state === "locked" && waitingOn.length > 0 && (
                            <span className="mt-0.5 block text-sm text-ink-soft">
                              Needs {waitingOn.map(titleOf).join(", ")}
                            </span>
                          )}
                        </span>
                        {skill.fromSource ? (
                          <JobTab inline />
                        ) : (
                          <span className="font-display text-sm text-ink-soft italic">Foundation</span>
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

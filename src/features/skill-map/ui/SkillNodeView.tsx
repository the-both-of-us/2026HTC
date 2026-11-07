import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import type { CSSProperties } from "react";
import type { NodeState, PublicSkillNode } from "@/shared/types";
import { NODE_STATE_LABELS, StateMark } from "@/shared/ui";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout";

export type SkillNodeData = {
  skill: PublicSkillNode;
  state: NodeState;
  layer: number;
  selected: boolean;
  /** Plays the column-by-column entrance. */
  reveal: boolean;
  justProven: boolean;
  justUnlocked: boolean;
};

export type SkillFlowNode = Node<SkillNodeData, "skill">;

const STATE_CLASSES: Record<NodeState, string> = {
  locked: "hatch-locked border-2 border-dashed border-locked text-ink-soft",
  available: "bg-available-surface border-3 border-available text-ink",
  proven: "bg-proven-surface border-2 border-proven text-on-proven",
};

/** One skill on the map. Its shape and symbol say its state, so colour is never alone. */
export function SkillNodeView({ data }: NodeProps<SkillFlowNode>) {
  const { skill, state, layer, selected, reveal, justProven, justUnlocked } = data;

  return (
    // The handles sit on this outer box, which never moves. React Flow measures them
    // once, so they must stay clear of the inner box's entrance animation.
    <div style={{ width: NODE_WIDTH, height: NODE_HEIGHT }} className="relative">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div
        style={{ "--reveal-layer": layer } as CSSProperties}
        className={clsx(
          "relative flex size-full items-center gap-2.5 rounded-control px-2.5 transition-control",
          STATE_CLASSES[state],
          // A hard double ring in highlighter yellow: the map's "you are here".
          selected && "shadow-[0_0_0_3px_var(--color-highlight),0_0_0_5px_var(--color-ink)]",
          reveal && "skill-reveal",
          justUnlocked && "skill-unlock",
        )}
      >
        {skill.fromSource && <JobTab />}

        <NodeMark state={state} landing={justProven} />

        <div className="min-w-0 flex-1">
          <p
            className={clsx(
              "line-clamp-2",
              skill.fromSource
                ? "font-display text-[1.0625rem] leading-5 font-semibold"
                : "text-base leading-5 font-medium",
            )}
          >
            {skill.title}
          </p>
          <p className="mt-1 flex justify-between gap-2 text-sm leading-4">
            <span className="font-semibold">{NODE_STATE_LABELS[state]}</span>
            {!skill.fromSource && <span className="font-display italic">Foundation</span>}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

/** The tab on top of a skill the posting asks for. Foundations have none. */
export function JobTab({ inline = false }: { inline?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-t-control border border-contour bg-sheet px-1.5 text-sm leading-[1.1875rem] font-semibold text-contour",
        inline ? "rounded-b-control" : "absolute -top-[1.3125rem] left-2 border-b-0",
      )}
    >
      <FlagIcon />
      Job asks
    </span>
  );
}

function FlagIcon() {
  return (
    <svg width={11} height={12} viewBox="0 0 11 12" aria-hidden="true">
      <path d="M1.5 0v12" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.2 1h8l-2.4 2.5L10.2 6h-8z" fill="currentColor" />
    </svg>
  );
}

function NodeMark({ state, landing }: { state: NodeState; landing: boolean }) {
  if (state !== "proven") return <StateMark state={state} size={28} className="shrink-0" />;

  // On the dark fill, the proven symbol sits on a pale disc, like a stamped seal.
  return (
    <span
      className={clsx(
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-sheet",
        landing && "stamp-land",
      )}
    >
      <StateMark state="proven" size={23} />
    </span>
  );
}

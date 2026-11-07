import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import { Briefcase, FileText, Lock } from "lucide-react";
import type { CSSProperties } from "react";
import type { NodeState, PublicSkillNode, SourceKind } from "@/shared/types";
import { NODE_STATE_LABELS, StateMark } from "@/shared/ui";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout";

export type SkillNodeData = {
  skill: PublicSkillNode;
  state: NodeState;
  layer: number;
  selected: boolean;
  /** Plays the row-by-row entrance. */
  reveal: boolean;
  justProven: boolean;
  justUnlocked: boolean;
};

export type SkillFlowNode = Node<SkillNodeData, "skill">;

const CARD_CLASSES: Record<NodeState, string> = {
  locked:
    "border-dashed border-locked/70 bg-locked-surface text-ink/85 hover:border-ink-soft hover:text-ink",
  available:
    "border-accent bg-available-surface text-ink shadow-glow hover:border-accent-bright hover:shadow-glow-strong",
  proven: "border-proven bg-proven-surface text-ink shadow-glow-green hover:shadow-[0_0_24px_rgb(91_170_122/0.45)]",
};

const HANDLE_COLOURS: Record<NodeState, string> = {
  locked: "var(--color-locked)",
  available: "var(--color-accent-bright)",
  proven: "var(--color-proven)",
};

/** One skill on the map. Its edge, its status dot and its words all say its state. */
export function SkillNodeView({ data }: NodeProps<SkillFlowNode>) {
  const { skill, state, layer, selected, reveal, justProven, justUnlocked } = data;

  return (
    // The handles sit on this outer box, which only ever fades. React Flow measures them
    // once, so they must stay clear of the inner card's movement.
    <div
      style={
        {
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
          "--reveal-layer": layer,
          "--handle-colour": HANDLE_COLOURS[state],
        } as CSSProperties
      }
      className={clsx("relative", reveal && "node-fade-in")}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div
        className={clsx(
          "flex size-full flex-col justify-between rounded-sheet border-[1.5px] px-3 py-2.5 transition-control hover:-translate-y-0.5",
          CARD_CLASSES[state],
          selected && "ring-2 ring-ink ring-offset-2 ring-offset-paper",
          reveal && "card-reveal",
          justProven && "card-proven",
          justUnlocked && "card-unlock",
        )}
      >
        <div className="flex items-start gap-2">
          <StateMark
            state={state}
            size={state === "proven" ? 17 : 14}
            className={clsx("shrink-0", state === "proven" ? "mt-[1px]" : "mt-[3px]", justProven && "mark-land")}
          />
          <p title={skill.title} className="line-clamp-2 min-w-0 flex-1 text-[0.9375rem] leading-[1.25] font-medium">
            {skill.title}
          </p>
          {state === "locked" && <Lock aria-hidden="true" size={14} className="mt-[3px] shrink-0" />}
        </div>
        <p className="flex items-center justify-between gap-2 text-[0.8125rem] leading-none">
          <span>{NODE_STATE_LABELS[state]}</span>
          {skill.fromSource && <JobAsksTag kind={skill.citation?.kind} />}
        </p>
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

/** A small tag on a skill the posting or PDF names. Foundations have none. */
export function JobAsksTag({ kind }: { kind?: SourceKind }) {
  const Icon = kind === "pdf" ? FileText : Briefcase;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber/45 bg-amber/10 px-1.5 py-0.5 text-xs leading-none font-medium text-amber">
      <Icon aria-hidden="true" size={11} />
      {kind === "pdf" ? "In your PDF" : "Job asks"}
    </span>
  );
}

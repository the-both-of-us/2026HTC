import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import { Briefcase, FileText, Lock, Star } from "lucide-react";
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
  /** Initials of study circle members who proved this skill. */
  avatars: string[];
  /** A proved skill fades a step at 3, 7 and 14 days, until it's relit. 0 is fully lit. */
  dim: number;
  /** Today's topic of the day. */
  featured: boolean;
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

/** Fading is a nudge to revisit, never a lost proof, so the card only dims. */
const DIM_CLASSES = ["", "opacity-80 saturate-50", "opacity-60 saturate-25", "opacity-45 grayscale"];

/** One skill on the map. Its edge, its status dot and its words all say its state. */
export function SkillNodeView({ data }: NodeProps<SkillFlowNode>) {
  const { skill, state, layer, selected, reveal, justProven, justUnlocked, avatars, dim, featured } = data;
  const fading = state === "proven" && dim > 0;

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
          "flex size-full flex-col justify-between rounded-sheet border-[1.5px] px-[12px] py-[10px] transition-control hover:-translate-y-0.5",
          CARD_CLASSES[state],
          selected && "ring-2 ring-ink ring-offset-2 ring-offset-paper",
          reveal && "card-reveal",
          justProven && "card-proven",
          justUnlocked && "card-unlock",
          fading && DIM_CLASSES[dim],
          featured && state === "available" && "ring-2 ring-amber/70",
        )}
      >
        <div className="flex items-start gap-2">
          <StateMark
            state={state}
            size={state === "proven" ? 17 : 14}
            className={clsx("shrink-0", state === "proven" ? "mt-[1px]" : "mt-[3px]", justProven && "mark-land")}
          />
          <p title={skill.title} className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-[1.25] font-medium">
            {skill.title}
          </p>
          {state === "locked" && <Lock aria-hidden="true" size={14} className="mt-[3px] shrink-0" />}
        </div>
        <p className="flex items-center justify-between gap-2 text-[13px] leading-none">
          <span>{fading ? "Fading, relight it" : NODE_STATE_LABELS[state]}</span>
          {featured && state === "available" && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber">
              <Star aria-hidden="true" size={11} />
              Today
            </span>
          )}
          {skill.fromSource && <JobAsksTag kind={skill.citation?.kind} />}
        </p>
      </div>
      {avatars.length > 0 && <Avatars initials={avatars} />}
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

/** Up to four circle members' initials on the card's top edge, then "+n". */
function Avatars({ initials }: { initials: string[] }) {
  const shown = initials.slice(0, 4);
  return (
    <p
      aria-label={`Proved by ${initials.length} in your circle`}
      className="absolute -top-3 right-2 flex -space-x-1.5"
    >
      {shown.map((text, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="flex size-6 items-center justify-center rounded-full border-2 border-paper bg-proven text-[10px] font-semibold text-paper"
        >
          {text}
        </span>
      ))}
      {initials.length > shown.length && (
        <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-full border-2 border-paper bg-raised text-[10px] text-ink">
          +{initials.length - shown.length}
        </span>
      )}
    </p>
  );
}

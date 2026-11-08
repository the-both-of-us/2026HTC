import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import { Briefcase, FileText, Lock, Star } from "lucide-react";
import type { CSSProperties } from "react";
import { FormatBadge, type TopicFormat } from "@/features/teachback/client";
import type { NodeState, PublicSkillNode, SourceKind } from "@/shared/types";
import { NODE_STATE_LABELS, Seal, StateMark } from "@/shared/ui";
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
  /** Opened with "Unlock anyway", before what it builds on was proven. */
  unlockedEarly?: boolean;
  /** How this topic is proved: see assignFormats. */
  format?: TopicFormat;
};

export type SkillFlowNode = Node<SkillNodeData, "skill">;

const CARD_CLASSES: Record<NodeState, string> = {
  locked:
    "border-dashed border-locked/70 bg-locked-surface text-ink/85 hover:border-ink-soft hover:text-ink",
  available:
    "border-ink bg-sheet text-ink hover:bg-paper-hi",
  proven: "border-proven bg-sheet text-ink hover:bg-paper-hi",
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
  const { skill, state, layer, selected, reveal, justProven, justUnlocked, avatars, dim, featured, format } = data;
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
          "flex size-full flex-col justify-between rounded-sheet border-[1.5px] px-[12px] py-[10px] transition-control",
          CARD_CLASSES[state],
          selected && "outline-2 outline-offset-2 outline-ink",
          reveal && "card-reveal",
          justProven && "card-proven",
          justUnlocked && "card-unlock",
          fading && DIM_CLASSES[dim],
          featured && state === "available" && "outline-1 outline-offset-2 outline-dashed outline-ink-soft",
        )}
      >
        <div className="flex items-start gap-2">
          {state === "proven" ? (
            // A small seal struck from the skill id: the same mark the evidence page uses.
            <Seal fingerprint={skill.id} size={20} className={clsx("-mt-[1px] shrink-0", justProven && "mark-land")} />
          ) : (
            <StateMark state={state} size={14} className="mt-[3px] shrink-0" />
          )}
          <p title={skill.title} className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-[1.25] font-medium">
            {skill.title}
          </p>
          {state === "locked" && <Lock aria-hidden="true" size={14} className="mt-[3px] shrink-0" />}
        </div>
        <p className="flex items-center justify-between gap-2 text-[13px] leading-none">
          <span>
            {fading
              ? "Fading, relight it"
              : data.unlockedEarly && state === "available"
                ? "Unlocked early"
                : NODE_STATE_LABELS[state]}
          </span>
          <span className="flex items-center gap-1">
            {featured && state === "available" && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber">
                <Star aria-hidden="true" size={11} />
                Today
              </span>
            )}
            {format && state !== "proven" && <FormatBadge format={format} compact />}
            {/* The panel still says so. On the card, today's topic needs the room. */}
            {skill.fromSource && !(featured && state === "available") && <JobAsksTag kind={skill.citation?.kind} />}
          </span>
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
    <span className="inline-flex shrink-0 items-center gap-1 rounded-control border border-dashed border-amber px-1.5 py-0.5 text-xs leading-none font-medium text-amber">
      <Icon aria-hidden="true" size={11} />
      {kind === "pdf" ? "In your notes" : "In the source"}
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

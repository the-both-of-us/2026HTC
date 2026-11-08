import { Handle, Position, useStore, type Node, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import { Briefcase, FileText, Lock, Star } from "lucide-react";
import type { CSSProperties } from "react";
import { FormatBadge, type TopicFormat } from "@/features/teachback/client";
import type { NodeState, PublicSkillNode, SourceKind } from "@/shared/types";
import { NODE_STATE_LABELS, Seal, StateMark } from "@/shared/ui";
import { COMPACT_METRICS, NODE_HEIGHT, NODE_WIDTH } from "./layout";

export type SkillNodeData = {
  skill: PublicSkillNode;
  state: NodeState;
  layer: number;
  selected: boolean;
  /** Plays the row-by-row entrance. */
  reveal: boolean;
  justProven: boolean;
  justUnlocked: boolean;
  /** Study circle members who proved this skill. */
  avatars: MapAvatar[];
  /** A proved skill fades a step at 3, 7 and 14 days, until it's relit. 0 is fully lit. */
  dim: number;
  /** Today's topic of the day. */
  featured: boolean;
  /** Opened with "Unlock anyway", before what it builds on was proven. */
  unlockedEarly?: boolean;
  /** How this topic is proved: see assignFormats. */
  format?: TopicFormat;
  /** A read-only, title-only card sized so the whole map fits one screen. */
  compact?: boolean;
};

/** One study circle member on a card: initials shown, the name in the tooltip. */
export type MapAvatar = { initials: string; name: string };

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
export function SkillNodeView(props: NodeProps<SkillFlowNode>) {
  return props.data.compact ? <CompactNodeView {...props} /> : <FullNodeView {...props} />;
}

function FullNodeView({ data }: NodeProps<SkillFlowNode>) {
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
      {avatars.length > 0 && <Avatars people={avatars} />}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

const COMPACT_CARD_CLASSES: Record<NodeState, string> = {
  locked: "border-dashed border-locked bg-locked-surface text-ink",
  available: "border-ink bg-sheet text-ink",
  proven: "border-proven bg-proven-surface text-ink",
};

/**
 * A study circle's shared map on a projector: the title only, in type that stays about 15px on
 * screen however far the map is zoomed out to fit, and who proved it underneath.
 */
function CompactNodeView({ data }: NodeProps<SkillFlowNode>) {
  const { skill, state, layer, reveal, justProven, avatars } = data;
  // Screen pixels per map pixel. Text and avatars are divided by it, so they keep their size.
  const zoom = useStore((store) => store.transform[2]);
  const unzoom = 1 / Math.max(zoom, 0.1);
  const titlePx = Math.min(22, Math.max(15, 15.5 * unzoom));
  const sealPx = Math.min(30, 19 * unzoom);

  return (
    <div
      style={
        {
          width: COMPACT_METRICS.nodeWidth,
          height: COMPACT_METRICS.nodeHeight,
          "--reveal-layer": layer,
          "--handle-colour": HANDLE_COLOURS[state],
        } as CSSProperties
      }
      className={clsx("relative", reveal && "node-fade-in")}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div
        className={clsx(
          "flex size-full items-center rounded-sheet border-[1.5px] px-[9px] py-[6px]",
          COMPACT_CARD_CLASSES[state],
          justProven && "card-proven card-cheer",
        )}
      >
        <p
          title={skill.title}
          style={{ fontSize: titlePx }}
          className="line-clamp-3 min-w-0 flex-1 leading-[1.12] font-medium font-stretch-[85%] [overflow-wrap:anywhere] hyphens-auto"
        >
          {skill.title}
          <span className="sr-only">. {NODE_STATE_LABELS[state]}.</span>
        </p>
      </div>
      {/* The proven seal sits on the card's top edge, so the title keeps the whole width. */}
      {state === "proven" && (
        <span
          aria-hidden="true"
          className="absolute top-0 left-2 -translate-y-1/2 rounded-full bg-paper p-[1.5px]"
        >
          <Seal fingerprint={skill.id} size={sealPx} className={clsx("block", justProven && "mark-land")} />
        </span>
      )}
      {avatars.length > 0 && <Avatars people={avatars} scale={unzoom} />}
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

/** "Sam", "Sam and Lee", "Sam, Lee and Priya". */
function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Who in the circle proved this card, as overlapping initials: three, then "+n". The names are
 * in the tooltip and for screen readers. `scale` undoes the map's zoom on a compact card, which
 * hangs them just under its bottom edge instead of over the top one.
 */
function Avatars({ people, scale }: { people: MapAvatar[]; scale?: number }) {
  const shown = people.length > 4 ? people.slice(0, 3) : people;
  const names = `Proved by ${joinNames(people.map((person) => person.name))}`;
  const size = scale ? Math.min(34, 24 * scale) : 24;
  return (
    <p
      title={names}
      data-avatars=""
      className={clsx(
        "absolute right-2 flex",
        scale ? "top-full -translate-y-[35%]" : "-top-3",
      )}
      style={{ fontSize: scale ? Math.min(15, 11 * scale) : 10 }}
    >
      <span className="sr-only">{names}</span>
      {shown.map((person, index) => (
        <span
          key={index}
          aria-hidden="true"
          style={{ width: size, height: size, marginLeft: index === 0 ? 0 : -size * 0.28 }}
          className="flex items-center justify-center rounded-full border-2 border-paper bg-proven leading-none font-semibold text-on-proven"
        >
          {person.initials}
        </span>
      ))}
      {people.length > shown.length && (
        <span
          aria-hidden="true"
          style={{ width: size, height: size, marginLeft: -size * 0.28 }}
          className="flex items-center justify-center rounded-full border-2 border-paper bg-ink leading-none font-semibold text-on-ink"
        >
          +{people.length - shown.length}
        </span>
      )}
    </p>
  );
}

import clsx from "clsx";
import type { ReactNode } from "react";
import type { NodeState } from "@/shared/types";
import { NODE_STATE_LABELS, StateMark } from "./StateMark";

type BadgeTone = "neutral" | "sample" | "danger" | NodeState;

// Seal: square labels with an ink rule. Dashed means "not the real thing yet": samples and locked skills.
const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-rule-strong text-ink-soft bg-sheet",
  sample: "border-ink-soft text-ink-soft bg-transparent border-dashed",
  danger: "border-danger text-danger bg-danger-surface",
  locked: "border-locked text-ink-soft bg-locked-surface border-dashed",
  available: "border-ink text-ink bg-sheet",
  proven: "border-ink text-on-ink bg-ink",
};

type BadgeProps = {
  tone?: BadgeTone;
  /** Defaults to the state's name for locked, available and proven. */
  children?: ReactNode;
  className?: string;
};

/** A small label. Node-state tones add their status mark, so they never rely on colour. */
export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  const isNodeState = tone === "locked" || tone === "available" || tone === "proven";

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-control border-[1.5px] px-2 py-px text-sm font-semibold",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {isNodeState && <StateMark state={tone} size={13} className={tone === "proven" ? "text-on-ink" : undefined} />}
      {children ?? (isNodeState ? NODE_STATE_LABELS[tone] : null)}
    </span>
  );
}

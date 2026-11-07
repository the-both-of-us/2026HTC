import clsx from "clsx";
import type { ReactNode } from "react";
import type { NodeState } from "@/shared/types";
import { NODE_STATE_LABELS, StateMark } from "./StateMark";

type BadgeTone = "neutral" | "sample" | "danger" | NodeState;

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-rule-strong text-ink-soft bg-raised",
  sample: "border-amber/60 text-amber bg-amber/10 border-dashed",
  danger: "border-danger text-danger bg-danger-surface",
  locked: "border-locked/70 text-ink-soft bg-locked-surface border-dashed",
  available: "border-accent/60 text-accent-bright bg-accent/10",
  proven: "border-proven/70 text-proven bg-proven/10",
};

type BadgeProps = {
  tone?: BadgeTone;
  /** Defaults to the state's name for locked, available and proven. */
  children?: ReactNode;
  className?: string;
};

/** A small pill label. Node-state tones add their status dot, so they never rely on colour. */
export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  const isNodeState = tone === "locked" || tone === "available" || tone === "proven";

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {isNodeState && <StateMark state={tone} size={13} />}
      {children ?? (isNodeState ? NODE_STATE_LABELS[tone] : null)}
    </span>
  );
}

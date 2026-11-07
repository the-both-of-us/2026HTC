import clsx from "clsx";
import type { ReactNode } from "react";
import type { NodeState } from "@/shared/types";
import { NODE_STATE_LABELS, StateMark } from "./StateMark";

type BadgeTone = "neutral" | "sample" | "danger" | NodeState;

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-control-edge text-ink-soft bg-sheet",
  sample: "border-contour text-contour bg-sheet border-dashed",
  danger: "border-danger text-danger bg-danger-surface",
  locked: "border-locked text-locked bg-sheet border-dashed",
  available: "border-available text-available bg-sheet",
  proven: "border-proven text-on-proven bg-proven",
};

type BadgeProps = {
  tone?: BadgeTone;
  /** Defaults to the state's name for locked, available and proven. */
  children?: ReactNode;
  className?: string;
};

/** A short label. Node-state tones add their map symbol, so they never rely on colour. */
export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  const isNodeState = tone === "locked" || tone === "available" || tone === "proven";

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-control border px-2 py-0.5 text-sm font-semibold",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {tone === "available" && <StateMark state="available" size={14} />}
      {tone === "locked" && <StateMark state="locked" size={14} />}
      {tone === "proven" && <ProvenMarkOnFill />}
      {children ?? (isNodeState ? NODE_STATE_LABELS[tone] : null)}
    </span>
  );
}

/** The proven triangle, inverted to sit on the badge's dark fill. */
function ProvenMarkOnFill() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5 22.5 21h-21z" fill="var(--color-on-proven)" />
      <circle cx="12" cy="14.5" r="2.8" fill="var(--color-proven)" />
    </svg>
  );
}

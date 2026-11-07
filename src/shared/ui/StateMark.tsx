import type { NodeState } from "@/shared/types";

export const NODE_STATE_LABELS: Record<NodeState, string> = {
  locked: "Locked",
  available: "Available",
  proven: "Proven",
};

type StateMarkProps = {
  state: NodeState;
  /** Width and height in pixels. */
  size?: number;
  className?: string;
};

/**
 * The status mark for a skill's state, after Seal's ledger. Each state has its own shape, so
 * the three stay distinct in greyscale and for colour-blind readers: a solid ink disc with a
 * tick, an open ring on a blank, and a dotted ring.
 * Decorative: always put the state's name in text nearby.
 */
export function StateMark({ state, size = 20, className }: StateMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      {state === "proven" && (
        <>
          <circle cx="12" cy="12" r="11" fill="var(--color-ink)" />
          <path d="m6.8 12.6 3.6 3.6 6.8-7.6" fill="none" stroke="var(--color-on-ink)" strokeWidth="2.8" />
        </>
      )}
      {state === "available" && (
        <circle cx="12" cy="12" r="9.5" fill="var(--color-sheet)" stroke="var(--color-ink)" strokeWidth="2.5" />
      )}
      {state === "locked" && (
        <circle
          cx="12"
          cy="12"
          r="9.5"
          fill="none"
          stroke="var(--color-locked)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="0.1 4.6"
        />
      )}
    </svg>
  );
}

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
 * The status dot for a skill's state. Each state has its own shape, so the three stay
 * distinct in greyscale and for colour-blind readers: a filled circle with a tick, a dot
 * in a ring, and a dashed ring.
 * Decorative: always put the state's name in text nearby.
 */
export function StateMark({ state, size = 20, className }: StateMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      {state === "proven" && (
        <>
          <circle cx="12" cy="12" r="11" fill="var(--color-proven)" />
          <path
            d="m6.8 12.6 3.6 3.6 6.8-7.6"
            fill="none"
            stroke="var(--color-on-proven)"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {state === "available" && (
        <>
          <circle cx="12" cy="12" r="10" fill="none" stroke="var(--color-available)" strokeWidth="2.5" />
          <circle cx="12" cy="12" r="4.6" fill="var(--color-accent-bright)" />
        </>
      )}
      {state === "locked" && (
        <circle
          cx="12"
          cy="12"
          r="9.5"
          fill="none"
          stroke="var(--color-locked)"
          strokeWidth="2.5"
          strokeDasharray="4 3.45"
        />
      )}
    </svg>
  );
}

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
 * The map symbol for a skill's state. Each state has its own shape, so the three
 * stay distinct in greyscale and for colour-blind readers. Borrowed from survey
 * maps: a filled triangle with a dot marks a fixed, checked station.
 * Decorative: always put the state's name in text nearby.
 */
export function StateMark({ state, size = 20, className }: StateMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
    >
      {state === "proven" && (
        <>
          <path
            d="M12 2.5 22.5 21h-21z"
            fill="var(--color-proven)"
            stroke="var(--color-proven)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="14.5" r="2.6" fill="var(--color-on-proven)" />
        </>
      )}
      {state === "available" && (
        <path
          d="M12 4.5 20.8 20H3.2z"
          fill="var(--color-available-surface)"
          stroke="var(--color-available)"
          strokeWidth="3"
          strokeLinejoin="round"
        />
      )}
      {state === "locked" && (
        <circle
          cx="12"
          cy="12"
          r="8.5"
          fill="var(--color-locked-surface)"
          stroke="var(--color-locked)"
          strokeWidth="2.25"
          strokeDasharray="3.5 3"
        />
      )}
    </svg>
  );
}

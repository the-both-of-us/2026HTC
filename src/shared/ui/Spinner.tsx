type SpinnerProps = {
  /** Width and height in pixels. */
  size?: number;
  /** Set this when no visible text nearby says what is happening. */
  label?: string;
  className?: string;
};

/**
 * A dashed ring that turns. With reduced motion it stays still, so always pair it
 * with words that say what is happening.
 */
export function Spinner({ size = 20, label, className }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
    >
      <g className="animate-spinner">
        <circle
          cx="12"
          cy="12"
          r="9.5"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="14 45.7"
        />
        <circle
          cx="12"
          cy="12"
          r="9.5"
          stroke="currentColor"
          strokeOpacity="0.3"
          strokeWidth="3"
        />
      </g>
    </svg>
  );
}

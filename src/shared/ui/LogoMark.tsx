import clsx from "clsx";

/** OryxLearn's mark: an oryx's two long horns on an accent tile. Decorative, so name it nearby. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-[28%] border border-accent/45 bg-accent/15 shadow-glow",
        className,
      )}
    >
      <svg width={size * 0.72} height={size * 0.72} viewBox="0 0 24 24" fill="none">
        <path
          d="M9.5 21C9.5 13 6.8 7 3.5 3M14.5 21c0-8 2.7-14 6-18"
          stroke="var(--color-accent-bright)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

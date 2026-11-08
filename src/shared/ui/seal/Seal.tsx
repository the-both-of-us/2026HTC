import { useId } from "react";
import { reededEdge, ring, sealDrawing, type SealDetail, type SealKind, type SealPaint } from "./guilloche";

/** proven: struck in ink and foil. ink: drawn in ink only. on-ink: light lines for a dark band. */
export type SealState = "proven" | "ink" | "on-ink";

const KIND: Record<SealState, SealKind> = { proven: "struck", ink: "ink", "on-ink": "white" };

type SealProps = {
  /** Any string. A SHA-256 hex digest is drawn as it is; anything else is hashed first. */
  fingerprint: string;
  /** Width and height in pixels. Leave it out to fill the parent box. */
  size?: number;
  state?: SealState;
  /** Chosen from `size` when left out. Pass it when the seal fills its box. */
  detail?: SealDetail;
  /** Radius of the plain centre in the 200 box: 27 fits a tick, 38 fits a figure. */
  center?: number;
  /** Text repeated round the rim in tiny type, like a banknote's microprinting. */
  microtext?: string;
  /** Names the seal for screen readers. Without it the seal is decorative. */
  label?: string;
  /** Ink lines in a soft teal gradient instead of flat ink. For the landing's hero seal. */
  tint?: boolean;
  className?: string;
};

function detailFor(size: number | undefined): SealDetail {
  if (size === undefined || size <= 110) return "node";
  if (size <= 260) return "mid";
  if (size <= 520) return "big";
  return "hero";
}

/** A guilloche seal drawn from a fingerprint. The same fingerprint always gives the same seal. */
export function Seal({ fingerprint, size, state = "proven", detail, center = 27, microtext, label, tint = false, className }: SealProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const drawing = sealDrawing(fingerprint, {
    detail: detail ?? detailFor(size),
    kind: KIND[state],
    center,
    micro: Boolean(microtext),
  });
  const paint = (p: SealPaint) =>
    p === "foil" ? `url(#${id}-foil)` : p === "paper" ? "var(--color-paper)" : p === "on-ink" ? "var(--color-on-ink)" : tint ? `url(#${id}-tint)` : "var(--color-ink)";
  const r = drawing.microRadius;

  return (
    <svg
      viewBox="0 0 200 200"
      width={size ?? "100%"}
      height={size ?? "100%"}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={className}
    >
      {tint && (
        <defs>
          <linearGradient id={`${id}-tint`} gradientUnits="userSpaceOnUse" x1="20" y1="20" x2="180" y2="180">
            <stop offset="0" stopColor="var(--color-proven)" />
            <stop offset=".55" stopColor="var(--color-accent-bright)" />
            <stop offset="1" stopColor="var(--color-ink)" />
          </linearGradient>
        </defs>
      )}
      {state === "proven" && (
        <defs>
          <linearGradient id={`${id}-foil`} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--color-foil-a)" />
            <stop offset=".5" stopColor="var(--color-foil-b)" />
            <stop offset="1" stopColor="var(--color-foil-c)" />
          </linearGradient>
        </defs>
      )}
      <path d={drawing.band.d} fillRule="evenodd" fill={paint(drawing.band.paint)} />
      {drawing.lines.map((line, index) => (
        <path
          key={index}
          d={line.d}
          fill="none"
          stroke={paint(line.paint)}
          strokeWidth={line.width}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {r !== null && microtext && (
        <>
          <path id={`${id}-micro`} d={`M${100 - r} 100a${r} ${r} 0 1 1 ${2 * r} 0a${r} ${r} 0 1 1 ${-2 * r} 0`} fill="none" />
          <text fontSize="5.2" fontWeight={600} fill="var(--color-ink)" style={{ letterSpacing: ".2px", fontStretch: "85%" }}>
            <textPath href={`#${id}-micro`} textLength={(Math.PI * 2 * r - 1.5).toFixed(1)} lengthAdjust="spacing">
              {`${microtext} ${microtext}`}
            </textPath>
          </text>
        </>
      )}
    </svg>
  );
}

const REEDS = reededEdge();

/** An unstruck blank: a reeded rim like a coin's and nothing in the middle. For skills ready to prove. */
export function SealBlank({ size, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 200 200" width={size ?? "100%"} height={size ?? "100%"} aria-hidden="true" focusable="false" className={className}>
      <path d={REEDS} stroke="var(--color-ink)" strokeWidth={1.15} vectorEffect="non-scaling-stroke" />
      <path d={ring(84)} fill="none" stroke="var(--color-ink)" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
      <path d={ring(36)} fill="none" stroke="var(--color-ink)" strokeWidth={1} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

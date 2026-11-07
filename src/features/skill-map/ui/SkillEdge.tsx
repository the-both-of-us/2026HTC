import type { Edge, EdgeProps } from "@xyflow/react";
import clsx from "clsx";
import type { CSSProperties } from "react";
import { edgePath, type Point } from "./layout";

export type SkillEdgeData = {
  waypoints: Point[];
  /** The skill this line leaves is proven. */
  live: boolean;
  /** That skill was proven just now, so the line draws itself. */
  justLit: boolean;
  /** Plays the row-by-row entrance. */
  reveal: boolean;
  layer: number;
};

export type SkillFlowEdge = Edge<SkillEdgeData, "skill">;

/**
 * A curved line between two skills. Thin and dim until its source is proven, then thick
 * and bright with a soft halo. Thickness carries the meaning, so it reads in greyscale.
 */
export function SkillEdge({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<SkillFlowEdge>) {
  const waypoints = data?.waypoints ?? [];
  const path = edgePath({ x: sourceX, y: sourceY }, waypoints, { x: targetX, y: targetY });
  const style = { "--reveal-layer": data?.layer ?? 0 } as CSSProperties;

  if (!data?.live) {
    return (
      <path
        d={path}
        fill="none"
        stroke="var(--color-violet-dim)"
        strokeWidth={2}
        style={style}
        className={clsx(data?.reveal && "line-reveal")}
      />
    );
  }

  // pathLength=1 lets the draw animation work on a line of any length.
  const drawn = data.justLit ? { pathLength: 1, className: "line-draw" } : {};

  return (
    <g style={style} className={clsx(data.reveal && "line-reveal")}>
      <path d={path} fill="none" stroke="var(--color-violet)" strokeOpacity={0.22} strokeWidth={7} {...drawn} />
      <path d={path} fill="none" stroke="var(--color-violet)" strokeWidth={3} {...drawn} />
    </g>
  );
}

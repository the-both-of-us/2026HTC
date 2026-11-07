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
  /** Plays the column-by-column entrance. */
  reveal: boolean;
  layer: number;
};

export type SkillFlowEdge = Edge<SkillEdgeData, "skill">;

/**
 * A line between two skills. Dashed and thin until its source is proven, then solid
 * and thick with pale dots travelling along it. Line style carries the meaning, so it
 * still reads in greyscale and with motion turned off.
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
        stroke="var(--color-locked)"
        strokeWidth={2}
        strokeDasharray="5 6"
        style={style}
        className={clsx(data?.reveal && "line-reveal")}
      />
    );
  }

  return (
    <g style={style} className={clsx(data.reveal && "line-reveal")}>
      <path
        d={path}
        fill="none"
        stroke="var(--color-proven)"
        strokeWidth={4.5}
        pathLength={data.justLit ? 1 : undefined}
        className={clsx(data.justLit && "line-draw")}
      />
      <path
        d={path}
        fill="none"
        stroke="var(--color-highlight)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray="1 17"
        className={clsx("line-live-dots", data.justLit && "line-dots-late")}
      />
    </g>
  );
}

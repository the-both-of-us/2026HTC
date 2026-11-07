"use client";

import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { assignFormats } from "@/features/teachback/client";
import { Maximize, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { NodeState, PublicSkillNode, SourceKind } from "@/shared/types";
import { prefersReducedMotion, StateMark } from "@/shared/ui";
import "./map.css";
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from "./layout";
import { SkillEdge, type SkillFlowEdge } from "./SkillEdge";
import { JobAsksTag, SkillNodeView, type SkillFlowNode } from "./SkillNodeView";

const LARGE_SCREEN = "(min-width: 1024px)";
const PHONE_SCREEN = "(max-width: 640px)";
const PAN_MS = 400;

/** Keeps the whole map clear of the legend and overview at the bottom and the zoom buttons on the left. */
const FIT_VIEW = {
  padding: { top: "28px", right: "28px", bottom: "118px", left: "68px" },
  maxZoom: 1,
} as const;

const NODE_TYPES = { skill: SkillNodeView };
const EDGE_TYPES = { skill: SkillEdge };

const ARIA_LABELS = {
  "node.a11yDescription.default": "Press Enter to open this skill.",
  "minimap.ariaLabel": "Overview of the whole map",
};

const MINIMAP_COLOURS: Record<NodeState, string> = {
  locked: "#3a4356",
  available: "#4b8fd4",
  proven: "#5baa7a",
};

/** A movement should take no time for people who prefer reduced motion, or use Learning Mode. */
function motionMs(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

type MapCanvasProps = {
  skills: PublicSkillNode[];
  states: Record<string, NodeState>;
  selectedId: string | null;
  sourceKind: SourceKind;
  reveal: boolean;
  justProvenId: string | null;
  justUnlockedIds: string[];
  /** How far each proved skill has faded since it was proved, 0 to 3. */
  dim?: Record<string, number>;
  /** Today's topic, which is worth double. */
  featuredId?: string | null;
  onSelect: (nodeId: string) => void;
  /** A study circle's initials for each skill: who has proved it. */
  avatars?: Record<string, string[]>;
};

export function MapCanvas(props: MapCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({
  skills,
  states,
  selectedId,
  sourceKind,
  reveal,
  justProvenId,
  justUnlockedIds,
  dim,
  featuredId = null,
  onSelect,
  avatars,
}: MapCanvasProps) {
  const flow = useReactFlow<SkillFlowNode, SkillFlowEdge>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  /** Where the map was before opening a skill moved it, so closing can put it back. */
  const viewBeforePan = useRef<Viewport | null>(null);

  // Where things go depends only on the map's structure, never on progress, so
  // proving a skill never moves anything.
  const layout = useMemo(() => layoutGraph(skills), [skills]);

  const nodes = useMemo<SkillFlowNode[]>(() => {
    const skillById = new Map(skills.map((skill) => [skill.id, skill]));
    const formats = assignFormats(skills);
    return layout.nodes.flatMap((placed) => {
      const skill = skillById.get(placed.id);
      if (!skill) return [];
      const state = states[skill.id] ?? "locked";
      return {
        id: skill.id,
        type: "skill" as const,
        position: { x: placed.x, y: placed.y },
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        // No aria-label: a button is named by its text, so it says exactly what it shows.
        ariaRole: "button" as const,
        domAttributes: {
          "aria-roledescription": "skill",
          "aria-expanded": selectedId === skill.id,
          onKeyDown: (event: KeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(skill.id);
            }
          },
        },
        data: {
          skill,
          state,
          layer: placed.layer,
          selected: selectedId === skill.id,
          reveal,
          justProven: justProvenId === skill.id,
          justUnlocked: justUnlockedIds.includes(skill.id),
          avatars: avatars?.[skill.id] ?? [],
          dim: dim?.[skill.id] ?? 0,
          featured: featuredId === skill.id,
          format: formats[skill.id],
        },
      };
    });
  }, [layout, skills, states, selectedId, reveal, justProvenId, justUnlockedIds, dim, featuredId, onSelect, avatars]);

  const edges = useMemo<SkillFlowEdge[]>(() => {
    const layerById = new Map(layout.nodes.map((placed) => [placed.id, placed.layer]));
    return layout.edges.map((edge) => ({
      id: `${edge.from}>${edge.to}`,
      type: "skill" as const,
      source: edge.from,
      target: edge.to,
      focusable: false,
      selectable: false,
      data: {
        waypoints: edge.waypoints,
        live: states[edge.from] === "proven",
        justLit: justProvenId === edge.from,
        reveal,
        layer: layerById.get(edge.from) ?? 0,
      },
    }));
  }, [layout, states, justProvenId, reveal]);

  // On a phone the whole map would be too small to read, so start at the first skill
  // the learner can act on, at full size so the words stay readable, and let them pan.
  useEffect(() => {
    if (!ready || !window.matchMedia(PHONE_SCREEN).matches) return;
    const first =
      layout.nodes.find((placed) => states[placed.id] === "available") ?? layout.nodes[0];
    if (first) {
      flow.setCenter(first.x + NODE_WIDTH / 2, first.y + NODE_HEIGHT / 2, { zoom: 1 });
    }
    // Only when the map first appears: later progress must not move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Opening the side panel narrows the map, which can hide the selected skill, so pan to it.
  // The effect runs after the panel is on screen, so clientWidth is already the new width.
  useEffect(() => {
    const container = containerRef.current;
    if (!ready || !container) return;
    if (!window.matchMedia(LARGE_SCREEN).matches) return;

    if (!selectedId) {
      if (viewBeforePan.current) flow.setViewport(viewBeforePan.current, { duration: motionMs(PAN_MS) });
      viewBeforePan.current = null;
      return;
    }

    const placed = layout.nodes.find((candidate) => candidate.id === selectedId);
    if (!placed) return;

    const { x, y, zoom } = flow.getViewport();
    const left = placed.x * zoom + x;
    const top = placed.y * zoom + y;
    const margin = 32;
    const isHidden =
      left < margin ||
      left + NODE_WIDTH * zoom > container.clientWidth - margin ||
      top < margin ||
      top + NODE_HEIGHT * zoom > container.clientHeight - margin;
    if (!isHidden) return;

    viewBeforePan.current ??= { x, y, zoom };
    flow.setViewport(
      {
        x: container.clientWidth / 2 - (placed.x + NODE_WIDTH / 2) * zoom,
        y: container.clientHeight / 2 - (placed.y + NODE_HEIGHT / 2) * zoom,
        zoom,
      },
      { duration: motionMs(PAN_MS) },
    );
  }, [selectedId, ready, layout, flow]);

  const handleNodeClick: NodeMouseHandler<SkillFlowNode> = (_event, node) => onSelect(node.id);

  return (
    <div className="flex size-full flex-col">
      {/* On a phone the legend sits above the map, so it never covers a skill. */}
      <div className="flex justify-center border-b border-rule px-2 py-2 sm:hidden">
        <Legend sourceKind={sourceKind} />
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1">
        <ReactFlow<SkillFlowNode, SkillFlowEdge>
          aria-label="Skill map. Use Tab to move between skills and Enter to open one."
          className="skill-map-flow"
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodeClick={handleNodeClick}
          onInit={() => setReady(true)}
          fitView
          fitViewOptions={FIT_VIEW}
          minZoom={0.35}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          panOnScroll
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          panActivationKeyCode={null}
          multiSelectionKeyCode={null}
          ariaLabelConfig={ARIA_LABELS}
          attributionPosition="top-right"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} color="#27324a" />

          <Panel
            position="bottom-left"
            className="flex flex-col divide-y divide-rule-strong rounded-control border border-rule-strong bg-raised/95 shadow-panel"
          >
            <ZoomButton label="Zoom in" onClick={() => flow.zoomIn({ duration: motionMs(150) })}>
              <Plus aria-hidden="true" size={18} />
            </ZoomButton>
            <ZoomButton label="Zoom out" onClick={() => flow.zoomOut({ duration: motionMs(150) })}>
              <Minus aria-hidden="true" size={18} />
            </ZoomButton>
            <ZoomButton
              label="Show whole map"
              onClick={() => flow.fitView({ ...FIT_VIEW, duration: motionMs(PAN_MS) })}
            >
              <Maximize aria-hidden="true" size={16} />
            </ZoomButton>
          </Panel>

          <Panel position="bottom-center" className="hidden w-max sm:block">
            <Legend sourceKind={sourceKind} />
          </Panel>

          <MiniMap<SkillFlowNode>
            position="bottom-right"
            pannable
            zoomable
            style={{ width: 150, height: 96 }}
            bgColor="#0c1018"
            maskColor="rgb(7 10 16 / 0.72)"
            maskStrokeColor="#2a3446"
            nodeBorderRadius={18}
            nodeColor={(node) => MINIMAP_COLOURS[node.data.state]}
          />
        </ReactFlow>
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-10 cursor-pointer items-center justify-center text-ink-soft transition-control first:rounded-t-control last:rounded-b-control hover:bg-rule-strong hover:text-ink focus-visible:-outline-offset-2"
    >
      {children}
    </button>
  );
}

/** How to read the map: each state's dot and name, and the tag for what the posting or PDF names. */
function Legend({ sourceKind }: { sourceKind: SourceKind }) {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1 rounded-full border border-rule-strong bg-sheet/95 px-4 py-1.5 text-sm text-ink-soft shadow-panel">
      <li className="inline-flex items-center gap-1.5">
        <StateMark state="proven" size={13} />
        Proven
      </li>
      <li className="inline-flex items-center gap-1.5">
        <StateMark state="available" size={13} />
        Available
      </li>
      <li className="inline-flex items-center gap-1.5">
        <StateMark state="locked" size={13} />
        Locked
      </li>
      {/* A topic map has no source, so no skill carries the tag. */}
      {sourceKind !== "topic" && (
        <li className="inline-flex">
          <JobAsksTag kind={sourceKind} />
        </li>
      )}
    </ul>
  );
}

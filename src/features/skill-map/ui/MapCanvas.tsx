"use client";

import {
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { NodeState, PublicSkillNode } from "@/shared/types";
import { Button } from "@/shared/ui";
import "./map.css";
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from "./layout";
import { SkillEdge, type SkillFlowEdge } from "./SkillEdge";
import { SkillNodeView, type SkillFlowNode } from "./SkillNodeView";

/** Width of the side panel on large screens, so the map can keep a node clear of it. */
const PANEL_WIDTH = 480;
const LARGE_SCREEN = "(min-width: 1024px)";
const PHONE_SCREEN = "(max-width: 640px)";
const PAN_MS = 400;

const NODE_TYPES = { skill: SkillNodeView };
const EDGE_TYPES = { skill: SkillEdge };

const ARIA_LABELS = {
  "node.a11yDescription.default": "Press Enter to open this skill.",
};

type MapCanvasProps = {
  skills: PublicSkillNode[];
  states: Record<string, NodeState>;
  selectedId: string | null;
  reveal: boolean;
  justProvenId: string | null;
  justUnlockedIds: string[];
  onSelect: (nodeId: string) => void;
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
  reveal,
  justProvenId,
  justUnlockedIds,
  onSelect,
}: MapCanvasProps) {
  const flow = useReactFlow<SkillFlowNode, SkillFlowEdge>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  // Where things go depends only on the map's structure, never on progress, so
  // proving a skill never moves anything.
  const layout = useMemo(() => layoutGraph(skills), [skills]);

  const nodes = useMemo<SkillFlowNode[]>(() => {
    const skillById = new Map(skills.map((skill) => [skill.id, skill]));
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
        },
      };
    });
  }, [layout, skills, states, selectedId, reveal, justProvenId, justUnlockedIds, onSelect]);

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
  // the learner can act on and let them pan.
  useEffect(() => {
    if (!ready || !window.matchMedia(PHONE_SCREEN).matches) return;
    const first =
      layout.nodes.find((placed) => states[placed.id] === "available") ?? layout.nodes[0];
    if (first) {
      flow.setCenter(first.x + NODE_WIDTH / 2, first.y + NODE_HEIGHT / 2, { zoom: 0.85 });
    }
    // Only when the map first appears: later progress must not move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Keep the selected skill visible when the side panel covers the right of the map.
  useEffect(() => {
    const container = containerRef.current;
    if (!selectedId || !ready || !container) return;
    const placed = layout.nodes.find((candidate) => candidate.id === selectedId);
    if (!placed) return;

    const isLarge = window.matchMedia(LARGE_SCREEN).matches;
    if (!isLarge) return;

    const { x, y, zoom } = flow.getViewport();
    const left = placed.x * zoom + x;
    const right = left + NODE_WIDTH * zoom;
    const top = placed.y * zoom + y;
    const clearWidth = container.clientWidth - PANEL_WIDTH;
    const margin = 32;
    const isHidden =
      right > clearWidth - margin ||
      left < margin ||
      top < margin ||
      top + NODE_HEIGHT * zoom > container.clientHeight - margin;
    if (!isHidden) return;

    // setCenter centres on the whole canvas; shifting it by half the panel centres
    // the skill in the part the panel leaves clear.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    flow.setCenter(
      placed.x + NODE_WIDTH / 2 + PANEL_WIDTH / 2 / zoom,
      placed.y + NODE_HEIGHT / 2,
      { zoom, duration: reduceMotion ? 0 : PAN_MS },
    );
  }, [selectedId, ready, layout, flow]);

  const handleNodeClick: NodeMouseHandler<SkillFlowNode> = (_event, node) => onSelect(node.id);

  return (
    <div ref={containerRef} className="relative size-full">
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
        fitViewOptions={{ padding: 0.07, maxZoom: 1.05 }}
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
      >
        <Panel position="bottom-left" className="flex gap-1.5">
          <Button
            variant="subtle"
            size="sm"
            aria-label="Zoom out"
            onClick={() => flow.zoomOut({ duration: 150 })}
          >
            <span aria-hidden="true">−</span>
          </Button>
          <Button
            variant="subtle"
            size="sm"
            aria-label="Zoom in"
            onClick={() => flow.zoomIn({ duration: 150 })}
          >
            <span aria-hidden="true">+</span>
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => flow.fitView({ padding: 0.07, maxZoom: 1.05, duration: PAN_MS })}
          >
            Show whole map
          </Button>
        </Panel>
      </ReactFlow>
    </div>
  );
}

/**
 * Places a skill map's nodes in columns, left to right, without a layout library.
 *
 * 1. Hide "shortcut" lines: if A leads to B and B leads to C, a line from A to C adds
 *    clutter and no information.
 * 2. Layers: a node sits one column right of its furthest prerequisite (longest path).
 * 3. A line that skips columns gets an invisible waypoint in each column it crosses,
 *    so it can run between nodes instead of behind them.
 * 4. Order inside each column: sort by the average position of neighbours (barycentre),
 *    sweeping back and forth, and keep the order with the fewest crossings.
 * 5. Heights: move each item towards its neighbours, without overlapping.
 * 6. Groups no line connects are laid out separately and stacked, so they stay close.
 *
 * Pure: same input, same output, no React and no DOM.
 */

export type LayoutInput = { id: string; prerequisites: string[] };

export type Point = { x: number; y: number };

export type PlacedNode = {
  id: string;
  /** Column, counted from 0 at the left. */
  layer: number;
  /** Top-left corner. */
  x: number;
  y: number;
};

export type RoutedEdge = {
  from: string;
  to: string;
  /** Points the line passes through between the two nodes. Empty for neighbours. */
  waypoints: Point[];
};

export type GraphLayout = {
  /** In reading order: by column, then top to bottom. Keyboard Tab follows this order. */
  nodes: PlacedNode[];
  edges: RoutedEdge[];
};

export const NODE_WIDTH = 264;
export const NODE_HEIGHT = 88;
const COLUMN_GAP = 60;
/** Space between two nodes in a column. Leaves room for the tab above a node. */
const ROW_GAP = 34;
/** Space next to a waypoint, which is only a line and needs less room than a node. */
const WAYPOINT_GAP = 18;
/** Space between groups of nodes that no line connects. */
const GROUP_GAP = 56;
const SWEEPS = 8;
const HEIGHT_PASSES = 8;

type Link = { from: string; to: string };

/** One thing in a column: a real node, or a waypoint on a line that skips columns. */
type Item = { id: string; isWaypoint: boolean };

export function layoutGraph(input: LayoutInput[]): GraphLayout {
  const links = withoutShortcuts(input);
  const layerOf = assignLayers(input, links);

  const nodes: PlacedNode[] = [];
  const edges: RoutedEdge[] = [];
  let top = 0;

  // Groups share nothing, so each is laid out alone and stacked under the last.
  for (const group of connectedGroups(input, links)) {
    const groupIds = new Set(group.map((node) => node.id));
    const groupLinks = links.filter((link) => groupIds.has(link.from));
    const placed = placeGroup(group, groupLinks, layerOf);

    const shift = top - Math.min(...placed.nodes.map((node) => node.y));
    for (const node of placed.nodes) nodes.push({ ...node, y: node.y + shift });
    for (const edge of placed.edges) {
      edges.push({
        ...edge,
        waypoints: edge.waypoints.map((point) => ({ x: point.x, y: point.y + shift })),
      });
    }
    top = Math.max(...nodes.map((node) => node.y)) + NODE_HEIGHT + GROUP_GAP;
  }

  nodes.sort((a, b) => a.layer - b.layer || a.y - b.y);
  return { nodes, edges };
}

/** Columns, order and heights for one connected group of nodes. */
function placeGroup(input: LayoutInput[], links: Link[], layerOf: Map<string, number>): GraphLayout {
  const { columns, segments, waypointIds } = buildColumns(input, links, layerOf);
  orderColumns(columns, segments);
  const centreY = assignHeights(columns, segments);

  const nodes: PlacedNode[] = input.map((node) => ({
    id: node.id,
    layer: at(layerOf, node.id),
    x: columnX(at(layerOf, node.id)),
    y: at(centreY, node.id) - NODE_HEIGHT / 2,
  }));

  const edges = links.map((link) => ({
    from: link.from,
    to: link.to,
    waypoints: (waypointIds.get(linkKey(link)) ?? []).flatMap(({ id, layer }) => {
      const y = at(centreY, id);
      // The line crosses the whole column in a straight run, as wide as a node.
      return [
        { x: columnX(layer), y },
        { x: columnX(layer) + NODE_WIDTH, y },
      ];
    }),
  }));

  return { nodes, edges };
}

/**
 * Splits the map into groups joined by lines, largest first, so the main path sits at
 * the top. Nodes with no lines at all share one group, stacked in the first column.
 */
function connectedGroups(input: LayoutInput[], links: Link[]): LayoutInput[][] {
  const neighbours = new Map<string, string[]>();
  for (const node of input) neighbours.set(node.id, []);
  for (const { from, to } of links) {
    neighbours.get(from)?.push(to);
    neighbours.get(to)?.push(from);
  }

  const seen = new Set<string>();
  const groups: LayoutInput[][] = [];
  const loners: LayoutInput[] = [];

  for (const node of input) {
    if (seen.has(node.id)) continue;
    const ids: string[] = [];
    const stack = [node.id];
    seen.add(node.id);
    while (stack.length > 0) {
      const id = stack.pop() as string;
      ids.push(id);
      for (const next of neighbours.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    const group = input.filter((candidate) => ids.includes(candidate.id));
    if (ids.length === 1) loners.push(node);
    else groups.push(group);
  }

  groups.sort((a, b) => b.length - a.length);
  if (loners.length > 0) groups.push(loners);
  return groups;
}

/** An SVG path from `start` to `end` through the waypoints, leaving each point flat. */
export function edgePath(start: Point, waypoints: Point[], end: Point): string {
  const points = [start, ...waypoints, end];
  let path = `M ${start.x} ${start.y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const midX = (a.x + b.x) / 2;
    path += ` C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`;
  }
  return path;
}

/** Crossings between neighbouring columns: how tangled an ordering is. */
function countCrossings(columns: Item[][], segments: Link[]): number {
  const position = positions(columns);
  const columnOf = new Map<string, number>();
  columns.forEach((column, index) => column.forEach((item) => columnOf.set(item.id, index)));

  let crossings = 0;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];
      if (columnOf.get(a.from) !== columnOf.get(b.from)) continue;
      const startOrder = at(position, a.from) - at(position, b.from);
      const endOrder = at(position, a.to) - at(position, b.to);
      if (startOrder * endOrder < 0) crossings++;
    }
  }
  return crossings;
}

function columnX(layer: number): number {
  return layer * (NODE_WIDTH + COLUMN_GAP);
}

function linkKey(link: Link): string {
  return `${link.from}>${link.to}`;
}

/** Every prerequisite as a link, minus those another prerequisite already implies. */
function withoutShortcuts(input: LayoutInput[]): Link[] {
  const prerequisitesOf = new Map<string, string[]>();
  for (const node of input) prerequisitesOf.set(node.id, node.prerequisites);
  const known = new Set(prerequisitesOf.keys());

  /** All nodes that must come before `id`. The `seen` set makes a cycle harmless. */
  function ancestors(id: string, seen = new Set<string>()): Set<string> {
    for (const prerequisite of prerequisitesOf.get(id) ?? []) {
      if (!seen.has(prerequisite)) {
        seen.add(prerequisite);
        ancestors(prerequisite, seen);
      }
    }
    return seen;
  }

  const links: Link[] = [];
  for (const node of input) {
    const direct = node.prerequisites.filter((p) => known.has(p) && p !== node.id);
    for (const prerequisite of direct) {
      const isShortcut = direct.some(
        (other) => other !== prerequisite && ancestors(other).has(prerequisite),
      );
      if (!isShortcut) links.push({ from: prerequisite, to: node.id });
    }
  }
  return links;
}

/**
 * Longest-path layering. Then any node with no prerequisites slides right to sit next
 * to its nearest dependant, because a long line across the map only adds clutter.
 */
function assignLayers(input: LayoutInput[], links: Link[]): Map<string, number> {
  const layer = new Map<string, number>();
  const waitingOn = new Map<string, number>();
  const childrenOf = new Map<string, string[]>();
  for (const node of input) {
    layer.set(node.id, 0);
    waitingOn.set(node.id, 0);
    childrenOf.set(node.id, []);
  }
  for (const { from, to } of links) {
    waitingOn.set(to, at(waitingOn, to) + 1);
    childrenOf.get(from)?.push(to);
  }

  // Visit a node only once all its prerequisites are placed. A cycle, which validation
  // rejects anyway, is simply never visited, so this cannot loop forever.
  const queue = input.filter((node) => waitingOn.get(node.id) === 0).map((node) => node.id);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const child of childrenOf.get(id) ?? []) {
      layer.set(child, Math.max(at(layer, child), at(layer, id) + 1));
      waitingOn.set(child, at(waitingOn, child) - 1);
      if (waitingOn.get(child) === 0) queue.push(child);
    }
  }

  const hasPrerequisite = new Set(links.map((link) => link.to));
  for (const node of input) {
    const children = childrenOf.get(node.id) ?? [];
    if (!hasPrerequisite.has(node.id) && children.length > 0) {
      layer.set(node.id, Math.min(...children.map((child) => at(layer, child))) - 1);
    }
  }
  return layer;
}

/** Turns layers into columns of items, and links into one-column-long segments. */
function buildColumns(input: LayoutInput[], links: Link[], layerOf: Map<string, number>) {
  const columnCount = Math.max(0, ...input.map((node) => at(layerOf, node.id))) + 1;
  const columns: Item[][] = Array.from({ length: columnCount }, () => []);
  for (const node of input) {
    columns[at(layerOf, node.id)].push({ id: node.id, isWaypoint: false });
  }

  const segments: Link[] = [];
  const waypointIds = new Map<string, { id: string; layer: number }[]>();
  for (const link of links) {
    const start = at(layerOf, link.from);
    const end = at(layerOf, link.to);
    const chain: { id: string; layer: number }[] = [];
    let previous = link.from;
    for (let layer = start + 1; layer < end; layer++) {
      const id = `${linkKey(link)}@${layer}`;
      columns[layer].push({ id, isWaypoint: true });
      chain.push({ id, layer });
      segments.push({ from: previous, to: id });
      previous = id;
    }
    if (end > start) segments.push({ from: previous, to: link.to });
    waypointIds.set(linkKey(link), chain);
  }
  return { columns, segments, waypointIds };
}

function positions(columns: Item[][]): Map<string, number> {
  const position = new Map<string, number>();
  for (const column of columns) column.forEach((item, index) => position.set(item.id, index));
  return position;
}

/** Sweeps left to right and back, sorting each column by its neighbours' positions. */
function orderColumns(columns: Item[][], segments: Link[]): void {
  let best = columns.map((column) => [...column]);
  let bestCrossings = countCrossings(columns, segments);

  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    const movingRight = sweep % 2 === 0;
    const indexes = columns.map((_, index) => index);
    if (!movingRight) indexes.reverse();

    for (const index of indexes.slice(1)) {
      const position = positions(columns);
      const neighbours = movingRight
        ? neighbourMap(segments, "to", "from")
        : neighbourMap(segments, "from", "to");
      const score = new Map<string, number>();
      for (const item of columns[index]) {
        const around = neighbours.get(item.id) ?? [];
        score.set(
          item.id,
          around.length > 0 ? mean(around.map((id) => at(position, id))) : at(position, item.id),
        );
      }
      columns[index].sort((a, b) => at(score, a.id) - at(score, b.id));
    }

    const crossings = countCrossings(columns, segments);
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      best = columns.map((column) => [...column]);
    }
  }

  best.forEach((column, index) => {
    columns[index] = column;
  });
}

function neighbourMap(segments: Link[], key: "from" | "to", value: "from" | "to") {
  const neighbours = new Map<string, string[]>();
  for (const segment of segments) {
    const list = neighbours.get(segment[key]) ?? [];
    list.push(segment[value]);
    neighbours.set(segment[key], list);
  }
  return neighbours;
}

/** The gap that keeps two neighbouring items in a column from touching, centre to centre. */
function spacing(a: Item, b: Item): number {
  if (a.isWaypoint && b.isWaypoint) return WAYPOINT_GAP;
  if (a.isWaypoint || b.isWaypoint) return NODE_HEIGHT / 2 + WAYPOINT_GAP;
  return NODE_HEIGHT + ROW_GAP;
}

/** Moves each column's items towards their neighbours' heights, keeping order and spacing. */
function assignHeights(columns: Item[][], segments: Link[]): Map<string, number> {
  const centreY = new Map<string, number>();
  for (const column of columns) {
    let y = 0;
    column.forEach((item, index) => {
      if (index > 0) y += spacing(column[index - 1], item);
      centreY.set(item.id, y);
    });
  }

  const previousItems = neighbourMap(segments, "to", "from");
  const nextItems = neighbourMap(segments, "from", "to");

  for (let pass = 0; pass < HEIGHT_PASSES; pass++) {
    const movingRight = pass % 2 === 0;
    const neighbours = movingRight ? previousItems : nextItems;
    const order = columns.map((_, index) => index);
    if (!movingRight) order.reverse();

    for (const index of order) {
      const column = columns[index];
      const wanted = column.map((item) => {
        const around = neighbours.get(item.id) ?? [];
        return around.length > 0 ? mean(around.map((id) => at(centreY, id))) : at(centreY, item.id);
      });

      // Top to bottom: go where you want, unless that would overlap the item above.
      const placed: number[] = [];
      column.forEach((item, i) => {
        placed.push(i === 0 ? wanted[0] : Math.max(wanted[i], placed[i - 1] + spacing(column[i - 1], item)));
      });
      // Pushing only ever moves items down, so move the column back up to compensate.
      const drift = mean(placed.map((y, i) => y - wanted[i]));
      column.forEach((item, i) => centreY.set(item.id, placed[i] - drift));
    }
  }
  return centreY;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Map lookup for keys that are known to exist. */
function at(map: Map<string, number>, key: string): number {
  return map.get(key) ?? 0;
}

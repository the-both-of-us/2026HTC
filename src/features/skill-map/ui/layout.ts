/**
 * Places a skill map's nodes in rows, top to bottom, without a layout library.
 *
 * 1. Hide "shortcut" lines: if A leads to B and B leads to C, a line from A to C adds
 *    clutter and no information.
 * 2. Layers: a node sits one row below its furthest prerequisite (longest path).
 * 3. A line that skips rows gets an invisible waypoint in each row it crosses,
 *    so it can run between nodes instead of behind them.
 * 4. Order inside each row: sort by the average position of neighbours (barycentre),
 *    sweeping back and forth, and keep the order with the fewest crossings.
 * 5. Sideways positions: move each item towards its neighbours, without overlapping.
 * 6. Groups no line connects are laid out separately, side by side, so they stay close.
 *
 * Pure: same input, same output, no React and no DOM.
 */

export type LayoutInput = { id: string; prerequisites: string[] };

export type Point = { x: number; y: number };

export type PlacedNode = {
  id: string;
  /** Row within its group, counted from 0 at the top. */
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
  /** In reading order: by row, then left to right. Keyboard Tab follows this order. */
  nodes: PlacedNode[];
  edges: RoutedEdge[];
};

export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 84;

/** Card size and the gaps around cards. */
export type LayoutMetrics = {
  nodeWidth: number;
  nodeHeight: number;
  /** Space between rows, where the curved lines run. */
  rowGap: number;
  /** Space between two nodes in a row. */
  nodeGap: number;
  /** Space next to a waypoint, which is only a line and needs less room than a node. */
  waypointGap: number;
  /** Space between groups of nodes that no line connects. */
  groupGap: number;
  /** Groups beside each other wrap below this width, so the map stays readable on a laptop. */
  maxShelfWidth: number;
};

export const DEFAULT_METRICS: LayoutMetrics = {
  nodeWidth: NODE_WIDTH,
  nodeHeight: NODE_HEIGHT,
  rowGap: 56,
  nodeGap: 22,
  waypointGap: 16,
  groupGap: 48,
  maxShelfWidth: 1300,
};

/** Smaller title-only cards, so a whole map fits one screen (a study circle on a projector). */
export const COMPACT_METRICS: LayoutMetrics = {
  nodeWidth: 156,
  nodeHeight: 72,
  rowGap: 34,
  nodeGap: 12,
  waypointGap: 10,
  groupGap: 32,
  maxShelfWidth: 900,
};
const SWEEPS = 8;
const HEIGHT_PASSES = 8;

type Link = { from: string; to: string };

/** One thing in a row: a real node, or a waypoint on a line that skips rows. */
type Item = { id: string; isWaypoint: boolean };

export function layoutGraph(input: LayoutInput[], metrics: LayoutMetrics = DEFAULT_METRICS): GraphLayout {
  const links = withoutShortcuts(input);
  const layerOf = assignLayers(input, links);

  const nodes: PlacedNode[] = [];
  const edges: RoutedEdge[] = [];
  let left = 0;
  let top = 0;
  let shelfBottom = 0;

  // Groups share nothing, so each is laid out alone. They sit side by side, like books
  // on a shelf, and a group that would make the shelf too wide starts a new one below.
  for (const group of connectedGroups(input, links)) {
    const groupIds = new Set(group.map((node) => node.id));
    const groupLinks = links.filter((link) => groupIds.has(link.from));
    const placed = placeGroup(group, groupLinks, shelfLayers(group, layerOf), metrics);

    const minX = Math.min(...placed.nodes.map((node) => node.x));
    const groupWidth = Math.max(...placed.nodes.map((node) => node.x)) + metrics.nodeWidth - minX;
    const groupHeight = Math.max(...placed.nodes.map((node) => node.y)) + metrics.nodeHeight;

    if (left > 0 && left + groupWidth > metrics.maxShelfWidth) {
      left = 0;
      top = shelfBottom + metrics.groupGap;
    }

    const shiftX = left - minX;
    for (const node of placed.nodes) nodes.push({ ...node, x: node.x + shiftX, y: node.y + top });
    for (const edge of placed.edges) {
      edges.push({
        ...edge,
        waypoints: edge.waypoints.map((point) => ({ x: point.x + shiftX, y: point.y + top })),
      });
    }
    left += groupWidth + metrics.groupGap;
    shelfBottom = Math.max(shelfBottom, top + groupHeight);
  }

  nodes.sort((a, b) => a.y - b.y || a.x - b.x);
  return { nodes, edges };
}

/** A group's layers counted from its own top row, so a shelf has no empty rows above it. */
function shelfLayers(group: LayoutInput[], layerOf: Map<string, number>): Map<string, number> {
  const first = Math.min(...group.map((node) => at(layerOf, node.id)));
  return new Map(group.map((node) => [node.id, at(layerOf, node.id) - first]));
}

/** Rows, order and sideways positions for one connected group of nodes. */
function placeGroup(input: LayoutInput[], links: Link[], layerOf: Map<string, number>, m: LayoutMetrics): GraphLayout {
  const { rows, segments, waypointIds } = buildRows(input, links, layerOf);
  orderRows(rows, segments);
  const centreX = assignCentres(rows, segments, m);

  const nodes: PlacedNode[] = input.map((node) => ({
    id: node.id,
    layer: at(layerOf, node.id),
    x: at(centreX, node.id) - m.nodeWidth / 2,
    y: rowY(at(layerOf, node.id), m),
  }));

  const edges = links.map((link) => ({
    from: link.from,
    to: link.to,
    waypoints: (waypointIds.get(linkKey(link)) ?? []).flatMap(({ id, layer }) => {
      const x = at(centreX, id);
      // The line crosses the whole row in a straight run, as tall as a node.
      return [
        { x, y: rowY(layer, m) },
        { x, y: rowY(layer, m) + m.nodeHeight },
      ];
    }),
  }));

  return { nodes, edges };
}

/**
 * Splits the map into groups joined by lines, largest first, so the main path sits on
 * the left. Nodes with no lines at all share one group, side by side in the first row.
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

/** An SVG path from `start` to `end` through the waypoints, leaving each point vertically. */
export function edgePath(start: Point, waypoints: Point[], end: Point): string {
  const points = [start, ...waypoints, end];
  let path = `M ${start.x} ${start.y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const midY = (a.y + b.y) / 2;
    path += ` C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`;
  }
  return path;
}

/** Crossings between neighbouring rows: how tangled an ordering is. */
function countCrossings(rows: Item[][], segments: Link[]): number {
  const position = positions(rows);
  const rowOf = new Map<string, number>();
  rows.forEach((row, index) => row.forEach((item) => rowOf.set(item.id, index)));

  let crossings = 0;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];
      if (rowOf.get(a.from) !== rowOf.get(b.from)) continue;
      const startOrder = at(position, a.from) - at(position, b.from);
      const endOrder = at(position, a.to) - at(position, b.to);
      if (startOrder * endOrder < 0) crossings++;
    }
  }
  return crossings;
}

function rowY(layer: number, m: LayoutMetrics): number {
  return layer * (m.nodeHeight + m.rowGap);
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
 * Longest-path layering. Then any node with no prerequisites slides down to sit next
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

/** Turns layers into rows of items, and links into one-row-long segments. */
function buildRows(input: LayoutInput[], links: Link[], layerOf: Map<string, number>) {
  const rowCount = Math.max(0, ...input.map((node) => at(layerOf, node.id))) + 1;
  const rows: Item[][] = Array.from({ length: rowCount }, () => []);
  for (const node of input) {
    rows[at(layerOf, node.id)].push({ id: node.id, isWaypoint: false });
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
      rows[layer].push({ id, isWaypoint: true });
      chain.push({ id, layer });
      segments.push({ from: previous, to: id });
      previous = id;
    }
    if (end > start) segments.push({ from: previous, to: link.to });
    waypointIds.set(linkKey(link), chain);
  }
  return { rows, segments, waypointIds };
}

function positions(rows: Item[][]): Map<string, number> {
  const position = new Map<string, number>();
  for (const row of rows) row.forEach((item, index) => position.set(item.id, index));
  return position;
}

/** Sweeps top to bottom and back, sorting each row by its neighbours' positions. */
function orderRows(rows: Item[][], segments: Link[]): void {
  let best = rows.map((row) => [...row]);
  let bestCrossings = countCrossings(rows, segments);

  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    const movingDown = sweep % 2 === 0;
    const indexes = rows.map((_, index) => index);
    if (!movingDown) indexes.reverse();

    for (const index of indexes.slice(1)) {
      const position = positions(rows);
      const neighbours = movingDown
        ? neighbourMap(segments, "to", "from")
        : neighbourMap(segments, "from", "to");
      const score = new Map<string, number>();
      for (const item of rows[index]) {
        const around = neighbours.get(item.id) ?? [];
        score.set(
          item.id,
          around.length > 0 ? mean(around.map((id) => at(position, id))) : at(position, item.id),
        );
      }
      rows[index].sort((a, b) => at(score, a.id) - at(score, b.id));
    }

    const crossings = countCrossings(rows, segments);
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      best = rows.map((row) => [...row]);
    }
  }

  best.forEach((row, index) => {
    rows[index] = row;
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

/** The gap that keeps two neighbouring items in a row from touching, centre to centre. */
function spacing(a: Item, b: Item, m: LayoutMetrics): number {
  if (a.isWaypoint && b.isWaypoint) return m.waypointGap;
  if (a.isWaypoint || b.isWaypoint) return m.nodeWidth / 2 + m.waypointGap;
  return m.nodeWidth + m.nodeGap;
}

/** Moves each row's items towards their neighbours' centres, keeping order and spacing. */
function assignCentres(rows: Item[][], segments: Link[], m: LayoutMetrics): Map<string, number> {
  const centreX = new Map<string, number>();
  for (const row of rows) {
    let x = 0;
    row.forEach((item, index) => {
      if (index > 0) x += spacing(row[index - 1], item, m);
      centreX.set(item.id, x);
    });
  }

  const previousItems = neighbourMap(segments, "to", "from");
  const nextItems = neighbourMap(segments, "from", "to");

  for (let pass = 0; pass < HEIGHT_PASSES; pass++) {
    const movingDown = pass % 2 === 0;
    const neighbours = movingDown ? previousItems : nextItems;
    const order = rows.map((_, index) => index);
    if (!movingDown) order.reverse();

    for (const index of order) {
      const row = rows[index];
      const wanted = row.map((item) => {
        const around = neighbours.get(item.id) ?? [];
        return around.length > 0 ? mean(around.map((id) => at(centreX, id))) : at(centreX, item.id);
      });

      // Left to right: go where you want, unless that would overlap the item before.
      const placed: number[] = [];
      row.forEach((item, i) => {
        placed.push(i === 0 ? wanted[0] : Math.max(wanted[i], placed[i - 1] + spacing(row[i - 1], item, m)));
      });
      // Pushing only ever moves items right, so move the row back left to compensate.
      const drift = mean(placed.map((x, i) => x - wanted[i]));
      row.forEach((item, i) => centreX.set(item.id, placed[i] - drift));
    }
  }
  return centreX;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Map lookup for keys that are known to exist. */
function at(map: Map<string, number>, key: string): number {
  return map.get(key) ?? 0;
}

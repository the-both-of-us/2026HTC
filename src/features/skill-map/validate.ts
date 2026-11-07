import { normalizeForMatch, quoteAppearsIn } from "@/shared/quote";
import type { Citation, SkillNode, SourceKind } from "@/shared/types";
import type { RawNode } from "./prompt";

/**
 * Checks on what the model returned. Nothing here calls the model or trusts it:
 * every function is pure, so whatever comes back, the map that leaves this file
 * has unique ids, no broken links, no loops and honest citations.
 */

export const MAX_NODES = 14;
export const MIN_CHECKPOINTS = 3;
export const MAX_CHECKPOINTS = 4;

const MAX_SLUG_LENGTH = 60;

/** A PDF map keeps its pages in one string, split by this, so each citation can be checked against its own page. */
export const PAGE_BREAK = "\f";

/** "Time-Series Cleaning!" becomes "time-series-cleaning". Empty if nothing is usable. */
export function toSlug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents: "é" becomes "e"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, "");
}

/**
 * Gives every node a clean id and removes repeats. A node repeats if its id or its
 * title matches an earlier one. Prerequisites that pointed at a removed repeat are
 * moved to the node that was kept.
 */
export function dedupeNodes(nodes: RawNode[]): RawNode[] {
  const keptIdByKey = new Map<string, string>();
  const kept: RawNode[] = [];

  nodes.forEach((node, index) => {
    const titleKey = toSlug(node.title);
    const id = toSlug(node.id) || titleKey || `skill-${index + 1}`;
    const existing = keptIdByKey.get(id) ?? keptIdByKey.get(titleKey);

    if (existing) {
      keptIdByKey.set(id, existing);
      return;
    }

    keptIdByKey.set(id, id);
    if (titleKey) keptIdByKey.set(titleKey, id);
    kept.push({ ...node, id });
  });

  return kept.map((node) => ({
    ...node,
    prerequisites: node.prerequisites.map((prerequisite) => {
      const slug = toSlug(prerequisite);
      return keptIdByKey.get(slug) ?? slug;
    }),
  }));
}

/** Trims checkpoints, removes repeats, keeps at most 4, and drops nodes left with under 3. */
export function cleanCheckpoints(nodes: RawNode[]): RawNode[] {
  const cleaned = nodes.map((node) => {
    const seen = new Set<string>();
    const checkpoints = node.checkpoints
      .map((checkpoint) => checkpoint.trim())
      .filter((checkpoint) => {
        const key = normalizeForMatch(checkpoint);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return { ...node, checkpoints: checkpoints.slice(0, MAX_CHECKPOINTS) };
  });

  return cleaned.filter((node) => node.checkpoints.length >= MIN_CHECKPOINTS);
}

/**
 * Keeps at most `max` nodes, in their original order. What the posting asks for
 * directly comes first, then foundations, so a long reply never loses a real requirement.
 */
export function capNodes(nodes: RawNode[], max: number = MAX_NODES): RawNode[] {
  if (nodes.length <= max) return nodes;

  const fromSource = nodes.filter((node) => node.fromSource);
  const foundations = nodes.filter((node) => !node.fromSource);
  const keep = new Set([...fromSource, ...foundations].slice(0, max));
  return nodes.filter((node) => keep.has(node));
}

/** Removes prerequisites that don't exist, point at the node itself, or repeat. */
export function dropBadPrerequisites(nodes: RawNode[]): RawNode[] {
  const ids = new Set(nodes.map((node) => node.id));

  return nodes.map((node) => ({
    ...node,
    prerequisites: [...new Set(node.prerequisites)].filter(
      (prerequisite) => ids.has(prerequisite) && prerequisite !== node.id,
    ),
  }));
}

/**
 * Removes the links that close a loop. It walks the graph from each node in list
 * order, following prerequisites. If a prerequisite leads back to a node we are still
 * in the middle of visiting, that link closes a loop, so it goes. The same input
 * always loses the same links.
 */
export function breakCycles(nodes: RawNode[]): RawNode[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const inProgress = new Set<string>();
  const finished = new Set<string>();
  const keptLinks = new Map<string, string[]>();

  function visit(node: RawNode) {
    inProgress.add(node.id);
    const kept: string[] = [];

    for (const prerequisite of node.prerequisites) {
      const next = nodeById.get(prerequisite);
      if (!next || inProgress.has(prerequisite)) continue;
      kept.push(prerequisite);
      if (!finished.has(prerequisite)) visit(next);
    }

    inProgress.delete(node.id);
    finished.add(node.id);
    keptLinks.set(node.id, kept);
  }

  for (const node of nodes) {
    if (!finished.has(node.id)) visit(node);
  }

  return nodes.map((node) => ({ ...node, prerequisites: keptLinks.get(node.id) ?? [] }));
}

/**
 * The learner needs somewhere to start. A graph with no loops always has a root, so
 * after breakCycles this changes nothing; it stays as a cheap guarantee.
 */
export function ensureRoot(nodes: RawNode[]): RawNode[] {
  if (nodes.length === 0 || nodes.some((node) => node.prerequisites.length === 0)) return nodes;
  return nodes.map((node, index) => (index === 0 ? { ...node, prerequisites: [] } : node));
}

/**
 * Foundations have no citation. A node from the source always has one, but its quote
 * is kept only if code found it in the source. For a PDF it cites the page code found it on.
 * Otherwise the UI can say it is unverified.
 */
export function buildCitation(node: RawNode, source: string, kind: SourceKind): Citation | null {
  // A topic has no source, so nothing in its map can be quoted.
  if (!node.fromSource || kind === "topic") return null;

  const quote = node.quote?.trim() ?? "";
  if (kind === "pdf") {
    // Cite the page the quote is really on. Models often name the wrong page, so check
    // the named page first, then the others.
    const pages = source.split(PAGE_BREAK);
    const named = (node.page ?? 0) - 1;
    const order = [named, ...pages.keys()].filter((index) => index >= 0 && index < pages.length);
    const found = order.find((index) => quoteOnPdfPage(quote, pages[index]));
    return found === undefined
      ? { kind, quote: "", verified: false }
      : { kind, quote, page: found + 1, verified: true };
  }
  return quoteAppearsIn(quote, source)
    ? { kind, quote, verified: true }
    : { kind, quote: "", verified: false };
}

/** Below this many letters, a quote with its spaces removed could match by chance. */
const MIN_SQUASHED_QUOTE = 12;

/**
 * PDF text breaks lines wherever the page did, even mid-word ("local tim" then "e."). So
 * a PDF quote also counts if its characters appear in order with the spaces ignored.
 */
export function quoteOnPdfPage(quote: string, pageText: string): boolean {
  if (quoteAppearsIn(quote, pageText)) return true;
  const squash = (text: string) => normalizeForMatch(text).replace(/ /g, "");
  const squashed = squash(quote);
  return squashed.length >= MIN_SQUASHED_QUOTE && squash(pageText).includes(squashed);
}

/** Models like to write special hyphens and spaces, which some fonts draw badly. */
export function cleanText(text: string): string {
  return text
    .replace(/[\u2010\u2011]/g, "-")
    .replace(/[\u00a0\u202f]/g, " ")
    .trim();
}

/** Runs every check, in the order they depend on each other. */
export function validateNodes(rawNodes: RawNode[], source: string, kind: SourceKind): SkillNode[] {
  const deduped = dedupeNodes(rawNodes);
  const withCheckpoints = cleanCheckpoints(deduped);
  const capped = capNodes(withCheckpoints);
  const linked = dropBadPrerequisites(capped);
  const acyclic = breakCycles(linked);
  const rooted = ensureRoot(acyclic);

  return rooted.map((node) => ({
    id: node.id,
    title: cleanText(node.title),
    why: cleanText(node.why),
    prerequisites: node.prerequisites,
    // A topic has no source, so nothing in its map is "from the source".
    fromSource: kind !== "topic" && node.fromSource,
    citation: buildCitation(node, source, kind),
    checkpoints: node.checkpoints.map(cleanText),
  }));
}

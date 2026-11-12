/*
 * What the front page sends. Postings and PDFs always build one private map. The program shape is
 * for topics only: a topic goes to `/api/programs` (the server reads the catalog and
 * replies `{ programId }` or `{ mapId }`) unless the person asked for one course.
 */

export type Shape = "auto" | "program" | "course";
export type BuildKind = "topic" | "posting";

export type BuildTarget = { url: string; body: Record<string, unknown> };

export function buildTarget(kind: BuildKind, text: string, shape: Shape): BuildTarget {
  if (kind === "posting") return { url: "/api/maps", body: { text, kind: "posting" } };
  if (shape === "course") return { url: "/api/maps", body: { text, kind: "topic" } };
  return { url: "/api/programs", body: { text, kind: "topic", shape } };
}

/** Where a successful reply goes: a program, or a map (`id` from /api/maps, `mapId` from /api/programs). */
export function destinationOf(body: unknown): string | null {
  const reply = body as { programId?: unknown; mapId?: unknown; id?: unknown } | null;
  if (typeof reply?.programId === "string") return `/program/${reply.programId}`;
  const mapId = reply?.mapId ?? reply?.id;
  return typeof mapId === "string" ? `/map/${mapId}` : null;
}

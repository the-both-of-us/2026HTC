import type { CourseSyllabus, SkillNode } from "@/shared/types";

/*
 * Wave 2 contract for learner maps of catalog courses, and the route shapes that change.
 * Plain data, safe for a browser except where a comment says otherwise.
 */

/**
 * Where the canonical build of a course map stands, for the map page's planning state.
 * - syllabus: "ready" final; "running" a live claim is writing it (the attached syllabus has
 *   `planning: true`); "idle" neither (never started, failed or died): the page offers
 *   "Try again", which is `POST /api/maps/[id]/units/u1` (it restarts the syllabus build).
 * - unit1: the canonical `unit-nodes/<courseId>/u1`, same three states. "ready" means the map has
 *   (or on this read got) unit 1's nodes.
 */
export type CourseBuildState = {
  syllabus: "ready" | "running" | "idle";
  unit1: "ready" | "running" | "idle";
};

/**
 * `GET /api/maps/[id]` reply 200: `PublicSkillMap` (see storage.ts). For a map with a courseId the
 * loader first runs `syncCourseMap` (zero model calls), so the reply carries the attached
 * syllabus (`syllabus.planning: true` while it streams) and `build`. The map page polls it every
 * 1.5 s while `build.syllabus` or `build.unit1` is "running". 403/404/500 `{ error }` as before.
 */
export type { PublicSkillMap as MapResponse } from "./storage";

/**
 * `POST /api/maps` (no shape change): `{ text, kind?: "posting" | "topic" }`. A posting builds one
 * private map as today. A topic resolves its catalog course (at most one check call), creates the
 * learner map with `courseId` and `nodes: []`, starts the canonical syllabus in `after()`, and
 * replies at once. Reply 201 `CreateMapResponse`; errors `{ error }`.
 */
export type CreateMapRequest = { text: string; kind?: "posting" | "topic" };
export type CreateMapResponse = { id: string };

/** What `ensureUnitNodes` needs. Works on the partial (planning) syllabus once the unit is committed. */
export type UnitNodesInput = {
  /** `contentIdOf(map)`: the catalog courseId, or the map id for a posting/PDF map. */
  contentId: string;
  unitId: string;
  /** The course's syllabus as it stands (final, or planning with this unit committed). */
  syllabus: CourseSyllabus;
  course: { title: string; audience: string; programTitle?: string };
  /** Epoch ms by which the build must finish. A build that cannot fit is not started. */
  deadline: number;
};

/**
 * "ready": `unit-nodes/<contentId>/<unitId>` exists (now or already), with its nodes.
 * "running": another writer holds the claim. "no-time": not started, the deadline is too close.
 * A failed build throws (AiUnavailableError, AiRefusedError or SkillMapError) after the claim is cleaned up.
 */
export type UnitNodesResult =
  | { status: "ready"; nodes: SkillNode[] }
  | { status: "running" }
  | { status: "no-time" };

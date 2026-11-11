import { getCatalogCourse, getCatalogProgram } from "@/features/catalog";
import { cleanAudience } from "@/shared/audience";
import { readOnce, startOnce } from "@/shared/store/once";
import { SYLLABUS_SHAPE, type CourseSyllabus, type SkillMap, type SkillNode, type SyllabusUnit } from "@/shared/types";
import { inBackground, routeDeadline } from "./background";
import { askModelForUnit, SkillMapError, UNIT_TOTAL_MS } from "./build";
import type { UnitPromptInput } from "./prompt";
import {
  claimUnitAppend,
  getSkillMap,
  getUnitCache,
  getUnitClaim,
  releaseUnitAppend,
  saveSkillMap,
  unitNodesKey,
  type UnitCacheEntry,
} from "./storage";
import type { UnitNodesInput, UnitNodesResult } from "./types";
import { NODE_LIMITS, validateUnitNodes } from "./validate";

/**
 * After this long, a unit append claim counts as a request that died. An append is a few store
 * operations with no model call, so this is short.
 */
export const STALE_UNIT_CLAIM_MS = 30_000;

/** A repair call is made only when at least this much time is left before the deadline. */
const MIN_REPAIR_MS = 20_000;

export type GenerateUnitResult = { status: "ready"; map: SkillMap } | { status: "building" };

const NOT_FOUND = "We could not find that unit. It may have been removed.";
const TOO_FEW = "We could not build this unit this time. Please try again.";

/** The canonical content id. Repeated here (not imported from canonical.ts) to keep the import graph a tree. */
const contentIdOf = (map: Pick<SkillMap, "id" | "courseId">) => map.courseId ?? map.id;

function limitsFor(syllabus: Pick<CourseSyllabus, "depth">) {
  return syllabus.depth === "degree" ? NODE_LIMITS.degreeUnit : NODE_LIMITS.quickUnit;
}

/** True once the unit's nodes are in the map (`built` on the learner's syllabus), or every planned topic is a node. */
export function isUnitBuilt(map: Pick<SkillMap, "nodes" | "syllabus">, unitId: string): boolean {
  const unit = map.syllabus?.units.find((candidate) => candidate.id === unitId);
  if (!unit) return false;
  if (unit.built) return true;
  const ids = new Set(map.nodes.map((node) => node.id));
  return unit.topics.length > 0 && unit.topics.every((topic) => ids.has(topic.id));
}

/** How many units the prompt says the course has: while the syllabus is still being written, its planned shape. */
function unitCountOf(syllabus: CourseSyllabus): number {
  return syllabus.planning ? Math.max(syllabus.units.length, SYLLABUS_SHAPE[syllabus.depth].units) : syllabus.units.length;
}

/** The unit as the unit prompt sees it. Links it may name are only those inside the unit. */
function promptInput(syllabus: CourseSyllabus, unit: SyllabusUnit, course: UnitNodesInput["course"]): UnitPromptInput {
  const inUnit = new Set(unit.topics.map((topic) => topic.id));
  const outcomeById = new Map(syllabus.outcomes.map((outcome) => [outcome.id, outcome.text]));
  const audience = cleanAudience(course.audience);
  return {
    courseTitle: course.title,
    ...(course.programTitle && { programTitle: course.programTitle }),
    ...(audience && { audience }),
    unitNumber: syllabus.units.indexOf(unit) + 1,
    unitCount: unitCountOf(syllabus),
    unitTitle: unit.title,
    outcomes: unit.outcomeIds.flatMap((id) => outcomeById.get(id) ?? []),
    topics: unit.topics.map((topic) => ({ ...topic, buildsOn: topic.buildsOn.filter((id) => inUnit.has(id)) })),
  };
}

/**
 * One model call for the unit (plan profile), plus one repair call when any topic came back
 * missing or unusable and the deadline leaves room. Throws a 422 when fewer than the floor survive.
 */
async function writeUnitNodes(
  syllabus: CourseSyllabus,
  unit: SyllabusUnit,
  course: UnitNodesInput["course"],
  deadline: number,
): Promise<SkillNode[]> {
  const limits = limitsFor(syllabus);
  const input = promptInput(syllabus, unit, course);
  const reply = await askModelForUnit(input, Math.min(UNIT_TOTAL_MS, deadline - Date.now()));
  let nodes = validateUnitNodes(reply.nodes, unit.id, unit.topics, [], limits.max);

  const built = new Set(nodes.map((node) => node.id));
  const missing = unit.topics.map((topic) => topic.id).filter((id) => !built.has(id));
  const left = deadline - Date.now();
  if (missing.length > 0 && left >= MIN_REPAIR_MS) {
    const repair = await askModelForUnit({ ...input, missing }, Math.min(UNIT_TOTAL_MS, left)).catch((error: unknown) => {
      // The first reply may already be enough: only fail if it is not.
      console.warn(`[skill-map] unit repair failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (repair) nodes = validateUnitNodes([...reply.nodes, ...repair.nodes], unit.id, unit.topics, [], limits.max);
  }

  if (nodes.length < limits.min) throw new SkillMapError(TOO_FEW, 422);
  return nodes;
}

/**
 * Builds the canonical nodes of one unit once, under `startOnce("unit-nodes/<contentId>/<unitId>")`.
 * Zero calls when they exist; "running" when another writer holds the claim; "no-time" when the
 * deadline cannot fit a unit call (60 s). Works on a planning syllabus once the unit is committed.
 */
export async function ensureUnitNodes(input: UnitNodesInput): Promise<UnitNodesResult> {
  const unit = input.syllabus.units.find((candidate) => candidate.id === input.unitId);
  if (!unit || unit.topics.length === 0) throw new SkillMapError(NOT_FOUND, 404);
  const key = unitNodesKey(input.contentId, input.unitId);

  if (input.deadline - Date.now() < UNIT_TOTAL_MS) {
    const read = await readOnce<UnitCacheEntry>(key);
    if (read.state === "ready") return { status: "ready", nodes: read.value.nodes };
    return read.state === "running" ? { status: "running" } : { status: "no-time" };
  }

  const started = await startOnce<UnitCacheEntry>(key, async () => ({
    contentId: input.contentId,
    unitId: input.unitId,
    nodes: await writeUnitNodes(input.syllabus, unit, input.course, input.deadline),
    builtAt: new Date().toISOString(),
  }));
  if (started === "running") return { status: "running" };
  if (started === "ready") {
    const entry = await getUnitCache(input.contentId, input.unitId);
    return entry ? { status: "ready", nodes: entry.nodes } : { status: "running" };
  }
  const entry = await started.work;
  return { status: "ready", nodes: entry.nodes };
}

/**
 * The course as the unit prompt names it. For a catalog course: its canonical title and audience,
 * and its home program's title when it has one, so every learner's build gets the same prompt.
 * For a posting or PDF map: the map's own title and audience.
 */
export async function unitCourseOf(map: SkillMap): Promise<UnitNodesInput["course"]> {
  const own = { title: map.title, audience: map.audience ?? "" };
  if (!map.courseId) return own;
  try {
    const course = await getCatalogCourse(map.courseId);
    if (!course) return own;
    const program = course.homeProgramId ? await getCatalogProgram(course.homeProgramId) : null;
    return { title: course.title, audience: course.audience, ...(program && { programTitle: program.title }) };
  } catch (error) {
    console.warn(`[skill-map] could not read the catalog course: ${error instanceof Error ? error.message : String(error)}`);
    return own;
  }
}

/** Starts the canonical build of a unit after the response. Never throws. */
export function scheduleUnitNodes(map: SkillMap, syllabus: CourseSyllabus, unitId: string, deadline = routeDeadline()): void {
  inBackground(`unit ${unitId}`, async () =>
    ensureUnitNodes({ contentId: contentIdOf(map), unitId, syllabus, course: await unitCourseOf(map), deadline }),
  );
}

/**
 * Pre-generation rule 3: once unit k is appended for any learner, the canonical build of unit k+1
 * starts in the background, if the syllabus has it and nobody built or is building it.
 */
function prebuildNextUnit(map: SkillMap, syllabus: CourseSyllabus, unitId: string, deadline: number): void {
  const index = syllabus.units.findIndex((unit) => unit.id === unitId);
  const next = syllabus.units[index + 1];
  if (index < 0 || !next || next.built) return;
  inBackground(`unit ${next.id} ahead`, async () => {
    const read = await readOnce(unitNodesKey(contentIdOf(map), next.id));
    if (read.state !== "idle") return;
    await ensureUnitNodes({
      contentId: contentIdOf(map),
      unitId: next.id,
      syllabus,
      course: await unitCourseOf(map),
      deadline,
    });
  });
}

/** For a map that stores its own syllabus (no courseId): marks the unit built, keeping only topics that have a node. */
function markBuilt(syllabus: CourseSyllabus, unitId: string, nodeIds: Set<string>, rootMapId: string): CourseSyllabus {
  return {
    ...syllabus,
    rootMapId,
    units: syllabus.units.map((unit) =>
      unit.id === unitId ? { ...unit, built: true, topics: unit.topics.filter((topic) => nodeIds.has(topic.id)) } : unit,
    ),
  };
}

/**
 * Appends the canonical nodes of a unit to one learner map (zero model calls), holding
 * `unit-claims/<mapId>` for the read, change, write. Returns the map as it now is (with its
 * syllabus attached again), or null when another request is appending to this map right now.
 * Then starts the next unit's canonical build (rule 3), under `deadline` (the deadline of the
 * request or background job that called this; a request now by default).
 */
export async function appendUnit(mapId: string, unitId: string, canonical: SkillNode[], deadline: number = routeDeadline()): Promise<SkillMap | null> {
  const claim = { unitId, claimedAt: new Date().toISOString() };
  if (!(await claimUnitAppend(mapId, claim))) {
    const held = await getUnitClaim(mapId);
    const age = held ? Date.now() - Date.parse(held.claimedAt) : Infinity;
    if (age < STALE_UNIT_CLAIM_MS) return null;
    await releaseUnitAppend(mapId);
    if (!(await claimUnitAppend(mapId, claim))) return null;
  }

  let result: SkillMap | null = null;
  try {
    // Read under the claim: another unit may have been appended since the caller read the map.
    const fresh = await getSkillMap(mapId);
    if (!fresh?.syllabus) throw new SkillMapError(NOT_FOUND, 404);
    const syllabus = fresh.syllabus;
    const unit = syllabus.units.find((candidate) => candidate.id === unitId);
    if (!unit) throw new SkillMapError(NOT_FOUND, 404);

    const taken = new Set(fresh.nodes.map((node) => node.id));
    const planned = new Set(unit.topics.map((topic) => topic.id));
    const added = canonical.filter((node) => planned.has(node.id) && !taken.has(node.id));
    if (added.length === 0 && !isUnitBuilt(fresh, unitId)) throw new SkillMapError(TOO_FEW, 422);

    if (added.length > 0) {
      const nodes = [...fresh.nodes, ...added];
      const unitNodeIds = new Set(nodes.filter((node) => planned.has(node.id)).map((node) => node.id));
      // A catalog course map stores no syllabus (saveSkillMap strips it); an older map keeps its own.
      const updated: SkillMap = fresh.courseId
        ? { ...fresh, nodes }
        : { ...fresh, nodes, syllabus: markBuilt(syllabus, unitId, unitNodeIds, contentIdOf(fresh)) };
      await saveSkillMap(updated);
    }
    result = (await getSkillMap(mapId)) ?? fresh;
  } finally {
    await releaseUnitAppend(mapId);
  }
  if (result?.syllabus) prebuildNextUnit(result, result.syllabus, unitId, deadline);
  return result;
}

/**
 * `POST /api/maps/[id]/units/[unitId]` behind `startUnit` (programs). Zero model calls in the request:
 * - the canonical `unit-nodes/<contentIdOf(map)>/<unitId>` exists: it is appended and "ready";
 * - a claim on it is live, or another request is appending to this map: "building";
 * - otherwise the canonical build starts after the response: "building". The client asks again every 2 s.
 *
 * Checks that `viewerId` owns the map and that its syllabus has the unit (404 otherwise). It does
 * not check the unlock rule (unit k-1 half proved): the caller does, since progress lives in teachback.
 */
export async function generateUnit(map: SkillMap, unitId: string, viewerId: string): Promise<GenerateUnitResult> {
  const syllabus = map.syllabus;
  if (map.ownerId !== viewerId || !syllabus?.units.some((unit) => unit.id === unitId)) {
    throw new SkillMapError(NOT_FOUND, 404);
  }
  if (isUnitBuilt(map, unitId)) return { status: "ready", map };

  const read = await readOnce<UnitCacheEntry>(unitNodesKey(contentIdOf(map), unitId));
  if (read.state === "ready") {
    const updated = await appendUnit(map.id, unitId, read.value.nodes);
    return updated ? { status: "ready", map: updated } : { status: "building" };
  }
  if (read.state === "idle") scheduleUnitNodes(map, syllabus, unitId);
  return { status: "building" };
}

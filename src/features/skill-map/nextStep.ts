import type { NodeState, ProgramLink } from "@/shared/types";
import type { UnitRailItem } from "./unitView";

/*
 * The one next step a learner is shown after a proof, at the end of a lesson and on the header
 * button. Pure: no React, no store. It always returns exactly one step, so a leaf of the graph
 * never leaves the learner with nothing to do.
 */

export type NextStep =
  /** A skill to open. `reason` says why it was picked. */
  | { kind: "skill"; nodeId: string; title: string; reason: "unlocked" | "unit" | "other-unit" }
  /** A fully proved unit whose test is not passed. */
  | { kind: "unit-test"; unitId: string; unitTitle: string }
  /** A unit that is not built yet and can be started now. */
  | { kind: "unit"; unitId: string; unitTitle: string; unitNumber: number }
  /** The course final, open and not passed. */
  | { kind: "final" }
  /** The course is done and it belongs to a program: back to the program page. */
  | { kind: "program"; programId: string; programTitle: string; href: string; nextCourseNumber: number | null }
  /** A standalone course is done. */
  | { kind: "finished"; href: string }
  /** Only locked work remains; `message` says what would open it. */
  | { kind: "waiting"; message: string };

export type NextStepInput = {
  /** The map's skills in map order. */
  skills: { id: string; title: string; prerequisites?: string[] }[];
  states: Record<string, NodeState>;
  /** The unit rail of a syllabus course, or null on a posting, PDF or older map (no units). */
  units: UnitRailItem[] | null;
  /** The syllabus has unit tests (degree courses). */
  unitTestsRequired?: boolean;
  /** Ids of units whose test is passed. */
  passedUnitTests?: ReadonlySet<string>;
  /** The course final is passed. */
  finalPassed?: boolean;
  /** The syllabus is still being written, so more units will come. */
  planning?: boolean;
  /** Skills the proof that just happened opened. Empty when none, or when nothing was just proven. */
  justUnlockedIds?: string[];
  /** The skill just proven or just read, so it is never suggested again. */
  currentNodeId?: string | null;
  /** The unit being worked in, used when there is no current skill. */
  currentUnitId?: string | null;
  program?: Pick<ProgramLink, "id" | "title" | "courseNumber" | "courseCount"> | null;
};

const DASHBOARD = "/dashboard";

export function computeNextStep(input: NextStepInput): NextStep {
  const { skills, states, units, program } = input;
  const passedTests = input.passedUnitTests ?? new Set<string>();
  const titleOf = (id: string) => skills.find((skill) => skill.id === id)?.title ?? id;
  const isAvailable = (id: string) => states[id] === "available" && id !== input.currentNodeId;
  const skillStep = (nodeId: string, reason: "unlocked" | "unit" | "other-unit"): NextStep => ({
    kind: "skill",
    nodeId,
    title: titleOf(nodeId),
    reason,
  });

  // 1. What this proof just opened.
  const unlocked = (input.justUnlockedIds ?? []).find(isAvailable);
  if (unlocked) return skillStep(unlocked, "unlocked");

  // The unit being worked in: the one holding the current skill, else the one named, else (no units) all skills.
  const currentUnit = units
    ? (units.find((unit) => input.currentNodeId && unit.nodeIds.includes(input.currentNodeId)) ??
      units.find((unit) => unit.id === input.currentUnitId) ??
      null)
    : null;
  const inCurrent = currentUnit ? currentUnit.nodeIds : units ? [] : skills.map((skill) => skill.id);

  // 2. Any other available skill in the current unit, in map order.
  const sameUnit = inCurrent.find(isAvailable);
  if (sameUnit) return skillStep(sameUnit, "unit");

  const unitTestOpen = (unit: UnitRailItem) =>
    input.unitTestsRequired === true &&
    unit.built &&
    unit.nodeIds.length > 0 &&
    unit.proved >= unit.nodeIds.length &&
    !passedTests.has(unit.id);
  const testStep = (unit: UnitRailItem): NextStep => ({ kind: "unit-test", unitId: unit.id, unitTitle: unit.title });

  // 3. The unit test, when the unit is fully proved and its test is not passed.
  if (currentUnit && unitTestOpen(currentUnit)) return testStep(currentUnit);

  // 4. Starting or opening the next unit, when it can open.
  if (units) {
    const after = currentUnit ? units.filter((unit) => unit.number > currentUnit.number) : units;
    const startable = after.find((unit) => !unit.built && unit.status === "ready") ?? units.find((unit) => !unit.built && unit.status === "ready");
    if (startable) return { kind: "unit", unitId: startable.id, unitTitle: startable.title, unitNumber: startable.number };
  }

  // 5. Any available skill in another built unit (or anywhere, on a map that has no current unit), then
  //    any other unit that is fully proved and still owes its test.
  const anywhere = skills.map((skill) => skill.id).find(isAvailable);
  if (anywhere) return skillStep(anywhere, "other-unit");
  const owingTest = units?.find(unitTestOpen);
  if (owingTest) return testStep(owingTest);

  // 6. The course final, when it is open and not passed. It opens when every planned topic is proved.
  const plannedTotal = units ? units.reduce((sum, unit) => sum + unit.plannedTopics, 0) : skills.length;
  const provenCount = skills.filter((skill) => states[skill.id] === "proven").length;
  const everythingProven = skills.length > 0 && provenCount >= plannedTotal && input.planning !== true;
  if (everythingProven && input.finalPassed !== true) return { kind: "final" };

  // 7. Finished: the next course of the program, or the dashboard.
  if (everythingProven) {
    if (program) {
      const hasNext = program.courseNumber < program.courseCount;
      return {
        kind: "program",
        programId: program.id,
        programTitle: program.title,
        href: `/program/${program.id}`,
        nextCourseNumber: hasNext ? program.courseNumber + 1 : null,
      };
    }
    return { kind: "finished", href: DASHBOARD };
  }

  // Only locked work remains: say what would open it.
  return { kind: "waiting", message: waitingMessage(input, titleOf) };
}

function waitingMessage(input: NextStepInput, titleOf: (id: string) => string): string {
  const { skills, states, units } = input;
  if (skills.length === 0) return "This course is still being written. Its first skills will appear here.";
  const lockedUnit = units?.find((unit) => !unit.built && unit.status === "locked" && unit.waitingFor);
  if (lockedUnit?.waitingFor) {
    const { unitNumber, needed, proved } = lockedUnit.waitingFor;
    const more = Math.max(needed - proved, 1);
    return `Prove ${more} more ${more === 1 ? "topic" : "topics"} in Unit ${unitNumber} to open Unit ${lockedUnit.number}.`;
  }
  const locked = skills.find((skill) => states[skill.id] === "locked");
  if (locked) {
    const missing = (locked.prerequisites ?? []).filter((id) => states[id] !== "proven").map(titleOf);
    return missing.length > 0
      ? `${titleOf(locked.id)} opens once ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} proven.`
      : `${titleOf(locked.id)} opens once the skills it builds on are proven.`;
  }
  if (input.planning) return "The next units are still being planned. They will appear here.";
  return "Nothing is open right now. More will appear as you prove skills.";
}

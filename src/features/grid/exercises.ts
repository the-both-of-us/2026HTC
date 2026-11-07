import { capabilityOf, FAMILY_LABELS, mw, outputOf, percent, RENEWABLE_FAMILIES } from "./metrics";
import type { GridSnapshot } from "./types";

/**
 * "Read the Grid" exercises. Code builds every question and answer from one AESO reading, and
 * code checks the learner's reply. No language model is involved, so an answer can't be made up.
 */

export type Figure = { label: string; value: string };
export type Role = "Grid analyst" | "System operator" | "Field technician";

type ExerciseBase = {
  id: string;
  title: string;
  prompt: string;
  /** The real figures the learner works from. */
  figures: Figure[];
  /** How the answer comes out of those figures, line by line. */
  working: string[];
  role: Role;
  /** Why someone in that job cares, in plain words. */
  why: string;
  /** What the number doesn't tell you, when that could mislead. */
  caveat?: string;
};

export type NumberExercise = ExerciseBase & {
  kind: "number";
  unit: "%" | "MW";
  answer: number;
  /** A reply this close to the answer counts as correct. */
  tolerance: number;
  /** A reply this close earns a "nearly". */
  closeBy: number;
};

export type ChoiceExercise = ExerciseBase & {
  kind: "choice";
  choices: string[];
  /** More than one if the live figures tie. */
  correct: string[];
};

export type Exercise = NumberExercise | ChoiceExercise;

export type CheckResult =
  | { outcome: "unreadable" }
  | { outcome: "correct" }
  | { outcome: "close"; direction: "high" | "low" }
  | { outcome: "wrong"; direction?: "high" | "low" };

const round1 = (value: number) => Math.round(value * 10) / 10;

function directionExercise(s: GridSnapshot): ChoiceExercise {
  const correct = s.interchange > 0 ? "Exporting" : s.interchange < 0 ? "Importing" : "Balanced";
  const gap = s.generation - s.load;
  const paths = s.paths.map((path) => `${path.path} ${mw(path.flow)}`).join(", ");
  return {
    id: "direction",
    kind: "choice",
    title: "Importing or exporting?",
    prompt: "Compare what Alberta generates with what it uses. Is it importing power, exporting power, or balanced?",
    figures: [
      { label: "Net generation", value: `${mw(s.generation)} MW` },
      { label: "Alberta load", value: `${mw(s.load)} MW` },
    ],
    choices: ["Importing", "Exporting", "Balanced"],
    correct: [correct],
    working: [
      `Generation minus load: ${mw(s.generation)} − ${mw(s.load)} = ${mw(gap)} MW.`,
      `AESO reports net interchange of ${mw(s.interchange)} MW, where a positive figure flows out of Alberta.`,
      ...(paths ? [`By path, in MW: ${paths}.`] : []),
      `So in this reading Alberta is ${correct.toLowerCase()}.`,
    ],
    role: "System operator",
    why: "Alberta's ties to British Columbia, Montana and Saskatchewan let it sell to its neighbours or lean on them. Operators watch these flows around the clock, and analysts use them to explain what the market is doing.",
  };
}

function windShareExercise(s: GridSnapshot): NumberExercise {
  const wind = outputOf(s, "wind");
  const answer = (wind / s.generation) * 100;
  return {
    id: "wind-share",
    kind: "number",
    title: "Wind's share",
    prompt: "What percentage of Alberta's generation is coming from wind in this reading?",
    figures: [
      { label: "Wind output", value: `${mw(wind)} MW` },
      { label: "Net generation", value: `${mw(s.generation)} MW` },
    ],
    unit: "%",
    answer: round1(answer),
    tolerance: 0.5,
    closeBy: 3,
    working: [`Wind divided by total generation: ${mw(wind)} ÷ ${mw(s.generation)} = ${percent(answer)}.`],
    role: "Grid analyst",
    why: "Wind output follows the weather, not demand. The bigger its share, the more the rest of the fleet has to move when the wind does, so analysts track it in every forecast and report.",
  };
}

function closestToMaxExercise(s: GridSnapshot): ChoiceExercise | null {
  const usable = s.groups.filter((group) => group.capability > 0);
  if (usable.length < 2) return null;

  const usage = (group: (typeof usable)[number]) => group.output / group.capability;
  const highest = Math.max(...usable.map(usage));
  const tied = usable.filter((group) => usage(group) === highest);

  // The four largest groups, always including the true answer. Alphabetical, so that a
  // choice's position gives nothing away.
  const largest = [...usable].sort((a, b) => b.capability - a.capability);
  const picks = [...new Set([tied[0], ...largest])].slice(0, 4);
  const choices = picks.sort((a, b) => a.name.localeCompare(b.name));

  return {
    id: "closest-to-max",
    kind: "choice",
    title: "Closest to its limit",
    prompt: "Of these fuel groups, which is running closest to its maximum capability?",
    figures: choices.map((group) => ({
      label: group.name,
      value: `${mw(group.output)} of ${mw(group.capability)} MW`,
    })),
    choices: choices.map((group) => group.name),
    correct: tied.map((group) => group.name),
    working: choices.map(
      (group) =>
        `${group.name}: ${mw(group.output)} ÷ ${mw(group.capability)} = ${percent(usage(group) * 100)}.`,
    ),
    role: "System operator",
    why: "A group near its maximum has little left to give if load climbs or another unit trips. Reading this at a glance tells an operator where the remaining room is.",
    caveat: "Assets marked as net-to-grid report gross capability but net output, so some industrial sites look less busy than they are.",
  };
}

function capacityFactorExercise(s: GridSnapshot): NumberExercise | null {
  const output = RENEWABLE_FAMILIES.reduce((sum, family) => sum + outputOf(s, family), 0);
  const capability = RENEWABLE_FAMILIES.reduce((sum, family) => sum + capabilityOf(s, family), 0);
  if (capability <= 0) return null;
  const answer = (output / capability) * 100;
  const parts = (read: typeof outputOf) =>
    RENEWABLE_FAMILIES.map((family) => mw(read(s, family))).join(" + ");
  const windCapability = capabilityOf(s, "wind");
  const windFigure =
    windCapability > 0 ? ` In this reading, wind alone is at ${percent((outputOf(s, "wind") / windCapability) * 100)}.` : "";
  return {
    id: "capacity-factor",
    kind: "number",
    title: "Renewable capacity factor",
    prompt: "Across wind, solar and hydro together, what percentage of maximum capability is producing in this reading?",
    figures: RENEWABLE_FAMILIES.map((family) => ({
      label: FAMILY_LABELS[family],
      value: `${mw(outputOf(s, family))} of ${mw(capabilityOf(s, family))} MW`,
    })),
    unit: "%",
    answer: round1(answer),
    tolerance: 0.5,
    closeBy: 3,
    working: [
      `Output: ${parts(outputOf)} = ${mw(output)} MW.`,
      `Capability: ${parts(capabilityOf)} = ${mw(capability)} MW.`,
      `${mw(output)} ÷ ${mw(capability)} = ${percent(answer)}.`,
    ],
    role: "Field technician",
    why: `A wind farm at 30% could be healthy on a calm day or faulty on a windy one. To tell which, technicians compare a site with the wind fleet's current figure, not this combined one.${windFigure}`,
    caveat: "This is one moment. A published capacity factor is usually measured over a year.",
  };
}

function netLoadExercise(s: GridSnapshot): NumberExercise {
  const wind = outputOf(s, "wind");
  const solar = outputOf(s, "solar");
  const answer = s.load - wind - solar;
  return {
    id: "net-load",
    kind: "number",
    title: "Net load",
    prompt: "Net load is demand minus wind and solar. It is what every other source has to cover. What is it in this reading?",
    figures: [
      { label: "Alberta load", value: `${mw(s.load)} MW` },
      { label: "Wind output", value: `${mw(wind)} MW` },
      { label: "Solar output", value: `${mw(solar)} MW` },
    ],
    unit: "MW",
    answer,
    tolerance: 5,
    closeBy: Math.max(50, Math.abs(answer) * 0.05),
    working: [`Load minus wind minus solar: ${mw(s.load)} − ${mw(wind)} − ${mw(solar)} = ${mw(answer)} MW.`],
    role: "Grid analyst",
    why: "Plants that can be dispatched serve net load, not total load. Its steepest moves, such as when solar fades at sunset, are what planners prepare for.",
  };
}

function gasHeadroomExercise(s: GridSnapshot): NumberExercise | null {
  const gas = s.groups.filter((group) => group.family === "gas");
  if (gas.length === 0) return null;
  const answer = gas.reduce((sum, group) => sum + group.capability - group.output, 0);
  return {
    id: "gas-headroom",
    kind: "number",
    title: "Gas headroom",
    prompt: "Headroom is maximum capability minus current output. Across all the gas groups, how many MW of headroom are there on paper?",
    figures: gas.map((group) => ({
      label: group.name,
      value: `${mw(group.output)} of ${mw(group.capability)} MW`,
    })),
    unit: "MW",
    answer,
    tolerance: 5,
    closeBy: Math.max(50, Math.abs(answer) * 0.05),
    working: [
      ...gas.map(
        (group) =>
          `${group.name}: ${mw(group.capability)} − ${mw(group.output)} = ${mw(group.capability - group.output)} MW.`,
      ),
      `Added together: ${mw(answer)} MW.`,
    ],
    role: "System operator",
    why: "Gas is usually what gets ramped up when the wind drops or load climbs, so its headroom is the first number to check when supply gets tight.",
    caveat: "This is on paper only. The report doesn't show outages or start-up times, and cogeneration usually follows an industrial site's needs.",
  };
}

function reserveExercise(s: GridSnapshot): NumberExercise | null {
  if (s.reserveRequired === null || s.reserveDispatched === null) return null;
  const answer = s.reserveDispatched - s.reserveRequired;
  return {
    id: "reserve-margin",
    kind: "number",
    title: "Reserve margin",
    prompt: "Contingency reserve is capacity held ready in case a generator or line suddenly fails. How many MW is the dispatched reserve above the requirement? Use a negative number if it is below.",
    figures: [
      { label: "Dispatched reserve", value: `${mw(s.reserveDispatched)} MW` },
      { label: "Reserve required", value: `${mw(s.reserveRequired)} MW` },
    ],
    unit: "MW",
    answer,
    tolerance: 0,
    closeBy: 10,
    working: [`Dispatched minus required: ${mw(s.reserveDispatched)} − ${mw(s.reserveRequired)} = ${mw(answer)} MW.`],
    role: "System operator",
    why: "When a large unit trips, this reserve is what replaces it within minutes. Operators keep it at or above the requirement so that one failure doesn't become a wider one.",
  };
}

/** Builds the set from one reading. A question whose figures are missing is simply left out. */
export function buildExercises(snapshot: GridSnapshot): Exercise[] {
  return [
    directionExercise(snapshot),
    windShareExercise(snapshot),
    closestToMaxExercise(snapshot),
    capacityFactorExercise(snapshot),
    netLoadExercise(snapshot),
    gasHeadroomExercise(snapshot),
    reserveExercise(snapshot),
  ].filter((exercise) => exercise !== null);
}

/** Reads what someone typed: "24.6", "24.6%", "2,681 MW" and "−31" all work. */
export function readNumber(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/−/g, "-")
    .replace(/,/g, "")
    .replace(/\s*(%|mw)\s*$/i, "");
  return /^-?\d+(\.\d+)?$|^-?\.\d+$/.test(cleaned) ? Number(cleaned) : null;
}

export function checkNumber(exercise: NumberExercise, raw: string): CheckResult {
  const value = readNumber(raw);
  if (value === null) return { outcome: "unreadable" };
  const off = value - exercise.answer;
  if (Math.abs(off) <= exercise.tolerance) return { outcome: "correct" };
  const direction = off > 0 ? "high" : "low";
  return Math.abs(off) <= exercise.closeBy
    ? { outcome: "close", direction }
    : { outcome: "wrong", direction };
}

export function checkChoice(exercise: ChoiceExercise, choice: string): CheckResult {
  return exercise.correct.includes(choice) ? { outcome: "correct" } : { outcome: "wrong" };
}

/** The answer in words, for after the working is shown. */
export function answerText(exercise: Exercise): string {
  if (exercise.kind === "choice") return exercise.correct.join(" or ");
  return exercise.unit === "%" ? `${exercise.answer}%` : `${mw(exercise.answer)} MW`;
}

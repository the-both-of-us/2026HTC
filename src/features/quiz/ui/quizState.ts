/**
 * The quiz's progress as plain data, so scoring and key handling can be tested
 * without a browser. Every function returns a new state and never changes its input.
 */

/** Only what scoring needs, so this file works with any question shape. */
export type Answerable = { answerIndex: number; options: readonly string[] };

export type QuizRun = {
  /** Indices into the saved questions, in the order this run asks them. */
  order: number[];
  /** Index into `order` of the question on screen. */
  position: number;
  /** The option chosen for each position in `order`, or null while unanswered. */
  choices: (number | null)[];
  finished: boolean;
};

/** The first run asks the questions in their saved order. */
export function startRun(count: number): QuizRun {
  const order = Array.from({ length: count }, (_, index) => index);
  return { order, position: 0, choices: order.map(() => null), finished: false };
}

/**
 * "Try again": the same questions in a new order. With two or more questions the order
 * always differs from the last run, so the learner cannot answer by position.
 */
export function restartRun(previous: QuizRun, random: () => number = Math.random): QuizRun {
  const count = previous.order.length;
  let order = shuffleIndices(count, random);
  for (let tries = 0; count > 1 && sameOrder(order, previous.order) && tries < 10; tries++) {
    order = shuffleIndices(count, random);
  }
  if (count > 1 && sameOrder(order, previous.order)) order = [...previous.order.slice(1), previous.order[0]];
  return { order, position: 0, choices: order.map(() => null), finished: false };
}

function shuffleIndices(count: number, random: () => number): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function sameOrder(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** The index of the saved question on screen. */
export function currentQuestionIndex(run: QuizRun): number {
  return run.order[run.position];
}

export function currentChoice(run: QuizRun): number | null {
  return run.choices[run.position] ?? null;
}

export function isAnswered(run: QuizRun): boolean {
  return currentChoice(run) !== null;
}

/** Records a choice. Ignored once the question is answered, or for an option that doesn't exist. */
export function choose(run: QuizRun, questions: readonly Answerable[], optionIndex: number): QuizRun {
  if (run.finished || isAnswered(run)) return run;
  const question = questions[currentQuestionIndex(run)];
  if (!question || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= question.options.length) {
    return run;
  }
  const choices = [...run.choices];
  choices[run.position] = optionIndex;
  return { ...run, choices };
}

/**
 * True when `after` is the same question as `before`, newly answered. The quiz then moves focus
 * to "Next question", so Enter or Space moves on wherever the answer was given from.
 */
export function answeredNow(before: QuizRun, after: QuizRun): boolean {
  return !before.finished && !isAnswered(before) && before.position === after.position && isAnswered(after);
}

/** Moves on after an answer. After the last question, the run is finished. */
export function next(run: QuizRun): QuizRun {
  if (run.finished || !isAnswered(run)) return run;
  if (run.position >= run.order.length - 1) return { ...run, finished: true };
  return { ...run, position: run.position + 1 };
}

export type Score = {
  correct: number;
  total: number;
  /** 1-based question numbers in this run's order. */
  missed: number[];
};

export function score(run: QuizRun, questions: readonly Answerable[]): Score {
  const missed: number[] = [];
  let correct = 0;
  run.order.forEach((questionIndex, position) => {
    if (run.choices[position] === questions[questionIndex]?.answerIndex) correct++;
    else missed.push(position + 1);
  });
  return { correct, total: run.order.length, missed };
}

/** "2", "2 and 4", "1, 3 and 5". */
export function listNumbers(numbers: number[]): string {
  if (numbers.length <= 1) return numbers.join("");
  return `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/** The parts of a keyboard event the quiz looks at. */
export type KeyInput = {
  key: string;
  /** The focused element's tag name, such as "BUTTON" or "TEXTAREA". */
  targetTag: string;
  targetIsEditable: boolean;
  hasModifier: boolean;
};

export type KeyAction = { type: "choose"; optionIndex: number } | { type: "next" } | null;

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * What a key press inside the quiz region means. Keys typed into a text field are never
 * taken. Enter on a button is left to the button, so it is never handled twice: after an
 * answer, focus is on "Next question", so Enter there moves on.
 */
export function keyAction(input: KeyInput, run: QuizRun, optionCount: number): KeyAction {
  if (run.finished || input.hasModifier) return null;
  if (input.targetIsEditable || TYPING_TAGS.has(input.targetTag.toUpperCase())) return null;

  if (/^[1-9]$/.test(input.key)) {
    const optionIndex = Number(input.key) - 1;
    if (isAnswered(run) || optionIndex >= optionCount) return null;
    return { type: "choose", optionIndex };
  }

  if (input.key === "Enter") {
    const onControl = ["BUTTON", "A"].includes(input.targetTag.toUpperCase());
    if (onControl || !isAnswered(run)) return null;
    return { type: "next" };
  }

  return null;
}

/** What the quiz panel is showing while it loads or makes a quiz. */
export type PanelKind = "loading" | "none" | "generating" | "ready" | "error";

/** Where focus goes when the panel changes because the learner pressed a button. */
export type PanelFocus = "status" | "make" | "retry" | "quiz";

/**
 * The control that replaced the one the learner pressed, so focus never drops to the page:
 * the loading line, the "Make a quiz" button, the error's retry button, or the first question.
 */
export function focusAfterPanelChange(kind: PanelKind): PanelFocus {
  switch (kind) {
    case "loading":
      return "status";
    case "none":
    case "generating":
      return "make";
    case "error":
      return "retry";
    case "ready":
      return "quiz";
  }
}

/** The panel has settled, so later changes no longer come from the learner's last press. */
export function isPanelSettled(kind: PanelKind): boolean {
  return kind === "none" || kind === "ready" || kind === "error";
}

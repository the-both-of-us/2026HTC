import { describe, expect, it } from "vitest";
import {
  answeredNow,
  choose,
  currentQuestionIndex,
  focusAfterPanelChange,
  isAnswered,
  isPanelSettled,
  keyAction,
  listNumbers,
  next,
  restartRun,
  score,
  startRun,
  type KeyInput,
  type QuizRun,
} from "./quizState";

const questions = [
  { answerIndex: 0, options: ["a", "b", "c", "d"] },
  { answerIndex: 2, options: ["a", "b", "c", "d"] },
  { answerIndex: 3, options: ["a", "b", "c", "d"] },
];

/** Answers every question in order with the given choices. */
function play(choices: number[], run: QuizRun = startRun(questions.length)): QuizRun {
  for (const choice of choices) run = next(choose(run, questions, choice));
  return run;
}

describe("quiz progress", () => {
  it("starts at the first question in saved order", () => {
    const run = startRun(3);
    expect(run.order).toEqual([0, 1, 2]);
    expect(currentQuestionIndex(run)).toBe(0);
    expect(isAnswered(run)).toBe(false);
  });

  it("records one choice and then locks it", () => {
    const run = choose(startRun(3), questions, 1);
    expect(run.choices[0]).toBe(1);
    expect(choose(run, questions, 2)).toBe(run);
  });

  it("ignores options that do not exist", () => {
    const run = startRun(3);
    expect(choose(run, questions, 4)).toBe(run);
    expect(choose(run, questions, -1)).toBe(run);
  });

  it("does not move on before an answer", () => {
    const run = startRun(3);
    expect(next(run)).toBe(run);
  });

  it("finishes after the last question and scores it", () => {
    const run = play([0, 1, 3]);
    expect(run.finished).toBe(true);
    expect(score(run, questions)).toEqual({ correct: 2, total: 3, missed: [2] });
  });

  it("numbers missed questions in the order they were asked", () => {
    const shuffled: QuizRun = { order: [2, 0, 1], position: 0, choices: [null, null, null], finished: false };
    // Asked: q2 (answer 3), q0 (answer 0), q1 (answer 2). Miss the first and third asked.
    const run = play([0, 0, 0], shuffled);
    expect(score(run, questions)).toEqual({ correct: 1, total: 3, missed: [1, 3] });
  });

  it("restarts with every choice cleared and a new question order", () => {
    const done = play([0, 2, 3]);
    for (let seed = 0; seed < 20; seed++) {
      const random = () => 0.999; // a shuffle that would keep the order, so the fallback kicks in
      const again = restartRun(done, seed % 2 ? random : Math.random);
      expect(again.finished).toBe(false);
      expect(again.position).toBe(0);
      expect(again.choices).toEqual([null, null, null]);
      expect([...again.order].sort()).toEqual([0, 1, 2]);
      expect(again.order).not.toEqual(done.order);
    }
  });

  it("restarts a one-question quiz", () => {
    const run = restartRun(next(choose(startRun(1), questions, 0)));
    expect(run.order).toEqual([0]);
    expect(run.finished).toBe(false);
  });

  it("lists numbers in words", () => {
    expect(listNumbers([2])).toBe("2");
    expect(listNumbers([2, 4])).toBe("2 and 4");
    expect(listNumbers([1, 3, 5])).toBe("1, 3 and 5");
  });
});

describe("keyAction", () => {
  const key = (k: string, overrides: Partial<KeyInput> = {}): KeyInput => ({
    key: k,
    targetTag: "DIV",
    targetIsEditable: false,
    hasModifier: false,
    ...overrides,
  });

  it("maps 1 to 4 to options before answering", () => {
    const run = startRun(3);
    expect(keyAction(key("1"), run, 4)).toEqual({ type: "choose", optionIndex: 0 });
    expect(keyAction(key("4"), run, 4)).toEqual({ type: "choose", optionIndex: 3 });
    expect(keyAction(key("5"), run, 4)).toBeNull();
  });

  it("number keys also work while an option button has focus", () => {
    expect(keyAction(key("2", { targetTag: "BUTTON" }), startRun(3), 4)).toEqual({ type: "choose", optionIndex: 1 });
  });

  it("ignores number keys after answering", () => {
    const run = choose(startRun(3), questions, 0);
    expect(keyAction(key("2"), run, 4)).toBeNull();
  });

  it("Enter moves on only after answering", () => {
    expect(keyAction(key("Enter"), startRun(3), 4)).toBeNull();
    expect(keyAction(key("Enter"), choose(startRun(3), questions, 0), 4)).toEqual({ type: "next" });
  });

  it("leaves Enter on a button to the button (focus is moved to Next question after an answer)", () => {
    const run = choose(startRun(3), questions, 0);
    expect(keyAction(key("Enter", { targetTag: "BUTTON" }), run, 4)).toBeNull();
    expect(keyAction(key("Enter", { targetTag: "a" }), run, 4)).toBeNull();
  });

  it("never takes keys typed into a text field", () => {
    const run = startRun(3);
    expect(keyAction(key("1", { targetTag: "TEXTAREA" }), run, 4)).toBeNull();
    expect(keyAction(key("1", { targetTag: "INPUT" }), run, 4)).toBeNull();
    expect(keyAction(key("1", { targetIsEditable: true }), run, 4)).toBeNull();
  });

  it("ignores keys with modifiers and keys after the quiz ends", () => {
    expect(keyAction(key("1", { hasModifier: true }), startRun(3), 4)).toBeNull();
    expect(keyAction(key("1"), play([0, 0, 0]), 4)).toBeNull();
  });
});

describe("answeredNow", () => {
  it("is true only when the question on screen has just been answered", () => {
    const fresh = startRun(3);
    const answered = choose(fresh, questions, 1);
    expect(answeredNow(fresh, answered)).toBe(true);
    // Choosing again is ignored, so focus is not moved a second time.
    expect(answeredNow(answered, choose(answered, questions, 2))).toBe(false);
    // An option that does not exist changes nothing.
    expect(answeredNow(fresh, choose(fresh, questions, 7))).toBe(false);
    // Moving on is not answering.
    expect(answeredNow(answered, next(answered))).toBe(false);
  });
});

describe("focusAfterPanelChange", () => {
  it("hands focus to the control that replaced the one pressed", () => {
    expect(focusAfterPanelChange("loading")).toBe("status");
    expect(focusAfterPanelChange("generating")).toBe("make");
    expect(focusAfterPanelChange("none")).toBe("make");
    expect(focusAfterPanelChange("error")).toBe("retry");
    expect(focusAfterPanelChange("ready")).toBe("quiz");
  });

  it("settles once the panel stops loading or making", () => {
    expect(isPanelSettled("loading")).toBe(false);
    expect(isPanelSettled("generating")).toBe(false);
    expect(isPanelSettled("none")).toBe(true);
    expect(isPanelSettled("error")).toBe(true);
    expect(isPanelSettled("ready")).toBe(true);
  });
});

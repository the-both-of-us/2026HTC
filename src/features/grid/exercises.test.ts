import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  answerText,
  buildExercises,
  checkChoice,
  checkNumber,
  readNumber,
  type ChoiceExercise,
  type NumberExercise,
} from "./exercises";
import { familyTotals, signed } from "./metrics";
import { parseCurrentSupplyDemand } from "./parse";
import type { GridSnapshot } from "./types";

const real = parseCurrentSupplyDemand(
  readFileSync(fileURLToPath(new URL("./fixtures/csd-2026-11-07-1316.html", import.meta.url)), "utf8"),
);

function find<T>(snapshot: GridSnapshot, id: string) {
  const exercise = buildExercises(snapshot).find((item) => item.id === id);
  if (!exercise) throw new Error(`no exercise ${id}`);
  return exercise as T;
}

describe("buildExercises on the real report", () => {
  it("computes wind's share from the live figures", () => {
    const exercise = find<NumberExercise>(real, "wind-share");
    expect(exercise.answer).toBe(24.6); // 2,681 / 10,900
    expect(exercise.working[0]).toContain("2,681");
    expect(exercise.working[0]).toContain("10,900");
    expect(answerText(exercise)).toBe("24.6%");
  });

  it("adds gas headroom across all four gas groups", () => {
    const exercise = find<NumberExercise>(real, "gas-headroom");
    // (6125-4542) + (3974-2066) + (3078-242) + (1014-14)
    expect(exercise.answer).toBe(7327);
    expect(exercise.figures).toHaveLength(4);
    expect(exercise.caveat).toMatch(/on paper/);
  });

  it("calls a positive interchange exporting", () => {
    const exercise = find<ChoiceExercise>(real, "direction");
    expect(exercise.correct).toEqual(["Exporting"]);
    expect(exercise.working.join(" ")).toContain("British Columbia 140");
  });

  it("computes the renewable capacity factor", () => {
    const exercise = find<NumberExercise>(real, "capacity-factor");
    expect(exercise.answer).toBe(45.1); // (2681+1040+97) / (5684+1892+896)
  });

  it("computes net load", () => {
    expect(find<NumberExercise>(real, "net-load").answer).toBe(6997); // 10718-2681-1040
  });

  it("computes the reserve margin", () => {
    expect(find<NumberExercise>(real, "reserve-margin").answer).toBe(31); // 510-479
  });

  it("finds the group closest to its maximum, among four alphabetical choices", () => {
    const exercise = find<ChoiceExercise>(real, "closest-to-max");
    expect(exercise.correct).toEqual(["Cogeneration"]); // 4542 / 6125 = 74%
    expect(exercise.choices).toHaveLength(4);
    expect(exercise.choices).toEqual([...exercise.choices].sort());
    expect(exercise.choices).toContain("Cogeneration");
  });

  it("says who cares, in every exercise", () => {
    for (const exercise of buildExercises(real)) {
      expect(exercise.role).toBeTruthy();
      expect(exercise.why.length).toBeGreaterThan(30);
      expect(exercise.working.length).toBeGreaterThan(0);
    }
  });
});

describe("buildExercises follows the numbers", () => {
  const importing: GridSnapshot = {
    ...real,
    generation: 9000,
    load: 9300,
    interchange: -300,
    paths: [{ path: "British Columbia", flow: -300 }],
  };

  it("calls a negative interchange importing", () => {
    expect(find<ChoiceExercise>(importing, "direction").correct).toEqual(["Importing"]);
  });

  it("calls zero interchange balanced", () => {
    const balanced = { ...real, generation: 9000, load: 9000, interchange: 0 };
    expect(find<ChoiceExercise>(balanced, "direction").correct).toEqual(["Balanced"]);
  });

  it("recomputes shares when the reading changes", () => {
    expect(find<NumberExercise>(importing, "wind-share").answer).toBe(29.8); // 2681 / 9000
  });

  it("leaves out the reserve question when AESO's figure is missing", () => {
    const missing = { ...real, reserveRequired: null };
    expect(buildExercises(missing).some((item) => item.id === "reserve-margin")).toBe(false);
  });

  it("includes a small group that is closest to its limit", () => {
    const groups = real.groups.map((group) =>
      group.name === "Other" ? { ...group, output: group.capability } : group,
    );
    const exercise = find<ChoiceExercise>({ ...real, groups }, "closest-to-max");
    expect(exercise.correct).toEqual(["Other"]);
    expect(exercise.choices).toContain("Other");
    expect(exercise.choices).toHaveLength(4);
  });

  it("accepts either group on a tie", () => {
    const groups = real.groups.map((group) =>
      group.name === "Wind" || group.name === "Hydro" ? { ...group, output: group.capability } : group,
    );
    const exercise = find<ChoiceExercise>({ ...real, groups }, "closest-to-max");
    expect(exercise.correct.sort()).toEqual(["Hydro", "Wind"]);
    expect(checkChoice(exercise, "Hydro").outcome).toBe("correct");
    expect(checkChoice(exercise, "Wind").outcome).toBe("correct");
  });

  it("copes with storage charging, which is negative output", () => {
    const groups = real.groups.map((group) =>
      group.family === "storage" ? { ...group, output: -40 } : group,
    );
    const storage = familyTotals({ ...real, groups }).find((item) => item.family === "storage");
    expect(storage?.output).toBe(-40);
    expect(storage?.share).toBe(0);
  });
});

describe("checking an answer", () => {
  const wind = find<NumberExercise>(real, "wind-share");

  it("accepts the answer and sensible rounding", () => {
    expect(checkNumber(wind, "24.6").outcome).toBe("correct");
    expect(checkNumber(wind, "25").outcome).toBe("correct");
    expect(checkNumber(wind, "24.6%").outcome).toBe("correct");
  });

  it("says when an answer is near, and which way it is off", () => {
    expect(checkNumber(wind, "27")).toEqual({ outcome: "close", direction: "high" });
    expect(checkNumber(wind, "22")).toEqual({ outcome: "close", direction: "low" });
  });

  it("rejects a wrong answer", () => {
    expect(checkNumber(wind, "60")).toEqual({ outcome: "wrong", direction: "high" });
  });

  it("does not grade something it can't read", () => {
    expect(checkNumber(wind, "a lot").outcome).toBe("unreadable");
    expect(checkNumber(wind, "").outcome).toBe("unreadable");
  });

  it("needs the exact reserve margin", () => {
    const reserve = find<NumberExercise>(real, "reserve-margin");
    expect(checkNumber(reserve, "31").outcome).toBe("correct");
    expect(checkNumber(reserve, "32").outcome).toBe("close");
  });

  it("checks a choice", () => {
    const direction = find<ChoiceExercise>(real, "direction");
    expect(checkChoice(direction, "Exporting").outcome).toBe("correct");
    expect(checkChoice(direction, "Importing").outcome).toBe("wrong");
  });
});

describe("readNumber", () => {
  it.each([
    ["2,681", 2681],
    ["2681 MW", 2681],
    ["24.6%", 24.6],
    ["−31", -31],
    ["-31", -31],
    [" 7 ", 7],
  ])("reads %s", (raw, value) => {
    expect(readNumber(raw)).toBe(value);
  });

  it.each(["", "abc", "1.2.3", "12 34"])("refuses %j", (raw) => {
    expect(readNumber(raw)).toBeNull();
  });
});

describe("signed", () => {
  it("uses a true minus sign", () => {
    expect(signed(-1200)).toBe("−1,200");
    expect(signed(12)).toBe("+12");
    expect(signed(0)).toBe("0");
  });
});

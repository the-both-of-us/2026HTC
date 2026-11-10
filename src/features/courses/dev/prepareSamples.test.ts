import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import type { SkillMap } from "@/shared/types";
import {
  buildPlan,
  DEFAULT_GAP_MS,
  describeError,
  estimateMinutes,
  isRunDirectly,
  parseArgs,
  safeConsoleLine,
  storeDriverName,
  storeRefusal,
  UsageError,
  waitBeforeNextMs,
  type Kind,
  type PlanMap,
} from "./plan";

// Set up before the imports below run, to see whether importing the script prints anything.
const beforeImport = vi.hoisted(() => ({
  log: vi.spyOn(console, "log").mockImplementation(() => {}),
  exitCode: process.exitCode,
}));

// The real feature calls must never run here: no store writes, no model.
vi.mock("@/features/flashcards", () => ({ getOrCreateFlashcards: vi.fn(), getSavedFlashcards: vi.fn() }));
vi.mock("@/features/quiz", () => ({ getOrCreateQuiz: vi.fn(), getSavedQuiz: vi.fn() }));
vi.mock("@/features/ai", () => ({ chatJSON: vi.fn(), chatText: vi.fn() }));

import { getOrCreateFlashcards } from "@/features/flashcards";
import { getOrCreateQuiz } from "@/features/quiz";
import { run, type Deps } from "./prepareSamples";

beforeEach(() => {
  vi.stubEnv("S3_BUCKET", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("AUTH0_DOMAIN", "");
  vi.stubEnv("AUTH0_CLIENT_ID", "");
  vi.stubEnv("AUTH0_CLIENT_SECRET", "");
  vi.stubEnv("AUTH0_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseArgs", () => {
  it("defaults to a real run of both kinds, 13 s apart", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, only: null, gapMs: DEFAULT_GAP_MS });
    expect(DEFAULT_GAP_MS).toBe(13_000);
  });

  it("reads every option", () => {
    expect(parseArgs(["--dry-run", "--only=quiz", "--gap-ms=500"])).toEqual({ dryRun: true, only: "quiz", gapMs: 500 });
    expect(parseArgs(["--only=flashcards"]).only).toBe("flashcards");
    expect(parseArgs(["--gap-ms=0"]).gapMs).toBe(0);
  });

  it("refuses what it does not know, with a sentence", () => {
    expect(() => parseArgs(["--only=cards"])).toThrow(UsageError);
    expect(() => parseArgs(["--gap-ms=-1"])).toThrow(/whole number/);
    expect(() => parseArgs(["--gap-ms=1.5"])).toThrow(/whole number/);
    expect(() => parseArgs(["--gap-ms="])).toThrow(/whole number/);
    expect(() => parseArgs(["--force"])).toThrow(/not an option/);
  });
});

describe("the store check", () => {
  it("names the driver from env names, in the store's order", () => {
    expect(storeDriverName({})).toBeNull();
    expect(storeDriverName({ S3_BUCKET: "", BLOB_READ_WRITE_TOKEN: "" })).toBeNull();
    expect(storeDriverName({ BLOB_READ_WRITE_TOKEN: "x" })).toBe("Vercel Blob");
    expect(storeDriverName({ S3_BUCKET: "b", BLOB_READ_WRITE_TOKEN: "x" })).toBe("S3");
  });

  it("refuses the in-memory store with a sentence, unless it is a dry run", () => {
    expect(storeRefusal({}, false)).toMatch(/would be made in memory and lost/);
    expect(storeRefusal({}, true)).toBeNull();
    expect(storeRefusal({ S3_BUCKET: "b" }, false)).toBeNull();
    expect(storeRefusal({ BLOB_READ_WRITE_TOKEN: "x" }, false)).toBeNull();
  });
});

const twoNodeMaps: PlanMap[] = [
  { sampleId: "a", label: "Sample A", mapId: "map-a", nodes: [{ id: "n1", title: "One" }, { id: "n2", title: "Two" }] },
  { sampleId: "b", label: "Sample B", mapId: "map-b", nodes: [{ id: "n3", title: "Three" }] },
];

describe("buildPlan", () => {
  it("lists map by map, skill by skill, flashcards before the quiz, and marks saved items", async () => {
    const saved = new Set(["flashcards:map-a:n2", "quiz:map-b:n3"]);
    const plan = await buildPlan(twoNodeMaps, ["flashcards", "quiz"], async (kind, mapId, nodeId) =>
      saved.has(`${kind}:${mapId}:${nodeId}`),
    );
    expect(plan.map((item) => `${item.kind}:${item.nodeId}:${item.saved ? "saved" : "make"}`)).toEqual([
      "flashcards:n1:make",
      "quiz:n1:make",
      "flashcards:n2:saved",
      "quiz:n2:make",
      "flashcards:n3:make",
      "quiz:n3:saved",
    ]);
    expect(plan[0]).toMatchObject({ label: "Sample A", mapId: "map-a", nodeTitle: "One", sampleId: "a" });
  });

  it("plans one kind with --only", async () => {
    const plan = await buildPlan(twoNodeMaps, ["quiz"], async () => false);
    expect(plan.map((item) => item.kind)).toEqual(["quiz", "quiz", "quiz"]);
  });

  it("counts a failed store read as not saved", async () => {
    const plan = await buildPlan(twoNodeMaps.slice(1), ["flashcards"], async () => {
      throw new Error("blob 503");
    });
    expect(plan[0].saved).toBe(false);
  });
});

describe("pacing", () => {
  it("lets the first call go at once and spaces the rest by the gap", () => {
    expect(waitBeforeNextMs(null, 1_000, 13_000)).toBe(0);
    expect(waitBeforeNextMs(1_000, 5_000, 13_000)).toBe(9_000);
    expect(waitBeforeNextMs(1_000, 14_000, 13_000)).toBe(0);
    expect(waitBeforeNextMs(1_000, 40_000, 13_000)).toBe(0);
  });

  it("estimates 84 calls at 13 s as about 18 minutes", () => {
    expect(estimateMinutes(84, 13_000)).toBe(18);
    expect(estimateMinutes(0, 13_000)).toBe(0);
    expect(estimateMinutes(1, 13_000)).toBe(1);
  });
});

describe("describeError", () => {
  it("prints our own sentences, and only the name of anything else", () => {
    const http = Object.assign(new Error("Making the quiz took too long this time."), { name: "QuizError", status: 503 });
    expect(describeError(http)).toBe("QuizError: Making the quiz took too long this time.");
    const ai = Object.assign(new Error("Our AI helpers are busy."), { name: "AiUnavailableError" });
    expect(describeError(ai)).toBe("AiUnavailableError: Our AI helpers are busy.");
    const raw = new TypeError("provider said: secret-ish details");
    expect(describeError(raw)).toBe("TypeError (details left out, as they can hold provider text)");
    expect(describeError("nope")).toBe("an unknown error");
  });
});

function fakeMap(sampleId: string, nodeCount: number): SkillMap {
  return {
    id: `map-${sampleId}`,
    ownerId: "oryxlearn-sample-courses",
    title: sampleId,
    subtitle: "",
    sourceKind: "posting",
    sourceText: "",
    createdAt: "2026-11-07T00:00:00.000Z",
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `${sampleId}-n${index}`,
      title: `Skill ${index}`,
      why: "",
      prerequisites: [],
      fromSource: false,
      citation: null,
      checkpoints: [],
    })),
  };
}

/** Fake deps over the real sample ids, with one skill each, and a fake clock that sleep moves. */
function fakeDeps(overrides: Partial<Deps> = {}) {
  const lines: string[] = [];
  let clock = 0;
  const sleeps: number[] = [];
  const deps: Deps = {
    env: { S3_BUCKET: "bucket" },
    ensureSampleCourses: vi.fn(async () => []),
    readSeedMapId: vi.fn(async (sampleId: string) => `map-${sampleId}`),
    getMap: vi.fn(async (mapId: string) => fakeMap(mapId.slice("map-".length), 1)),
    getSaved: vi.fn(async () => null),
    create: vi.fn(async (kind: Kind) => (kind === "flashcards" ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5])),
    now: () => clock,
    sleep: vi.fn(async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    }),
    log: (line) => lines.push(line),
    ...overrides,
  };
  return { deps, lines, sleeps };
}

describe("the run-directly guard", () => {
  it("is true only for node started on prepareSamples.ts", () => {
    expect(isRunDirectly("/Users/abdu/2026HTC/src/features/courses/dev/prepareSamples.ts")).toBe(true);
    expect(isRunDirectly("src\\features\\courses\\dev\\prepareSamples.ts")).toBe(true);
    expect(isRunDirectly("prepareSamples.ts")).toBe(true);
    expect(isRunDirectly("/repo/node_modules/vitest/vitest.mjs")).toBe(false);
    expect(isRunDirectly("/repo/src/features/courses/dev/prepareSamples.test.ts")).toBe(false);
    expect(isRunDirectly("/repo/notprepareSamples.ts")).toBe(false);
    expect(isRunDirectly(undefined)).toBe(false);
  });

  it("does not run main when imported", async () => {
    // main would print its first line before any await: a usage error or the store refusal.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(beforeImport.log).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(beforeImport.exitCode);
    expect(getOrCreateFlashcards).not.toHaveBeenCalled();
    expect(getOrCreateQuiz).not.toHaveBeenCalled();
    beforeImport.log.mockRestore();
  });
});

describe("safeConsoleLine", () => {
  it("keeps the app's strings, describes errors safely and leaves out objects", () => {
    const sdk = Object.assign(new Error("The AWS Access Key Id you provided does not exist"), {
      name: "InvalidAccessKeyId",
      AWSAccessKeyId: "AKIAFAKEVALUE",
    });
    const line = safeConsoleLine(['[courses] could not seed the sample course "x"', sdk, { AWSAccessKeyId: "AKIAFAKEVALUE" }]);
    expect(line).toBe(
      '[courses] could not seed the sample course "x" InvalidAccessKeyId (details left out, as they can hold provider text) (details left out)',
    );
  });
});

describe("run", () => {

  it("refuses the in-memory store and calls nothing", async () => {
    const { deps, lines } = fakeDeps({ env: {} });
    expect(await run([], deps)).toBe(1);
    expect(lines.join("\n")).toMatch(/would be made in memory/);
    expect(deps.ensureSampleCourses).not.toHaveBeenCalled();
    expect(deps.create).not.toHaveBeenCalled();
  });

  it("refuses an unknown option with the usage line", async () => {
    const { deps, lines } = fakeDeps();
    expect(await run(["--nope"], deps)).toBe(1);
    expect(lines[1]).toMatch(/^Usage: npx tsx/);
  });

  it("dry-runs without a store and makes nothing", async () => {
    const { deps, lines } = fakeDeps({ env: {} });
    expect(await run(["--dry-run"], deps)).toBe(0);
    expect(deps.create).not.toHaveBeenCalled();
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(lines[0]).toBe("Store: memory (dry run only: nothing is kept).");
    const total = SAMPLE_POSTINGS.length * 2;
    expect(lines).toContain(`[1/${total}] flashcards · ${SAMPLE_POSTINGS[0].label} · Skill 0 … would make`);
    expect(lines.at(-1)).toBe(`Dry run done: ${total} to make, 0 already saved, 0 failed.`);
  });

  it("skips saved items, paces the rest, prints progress and a summary", async () => {
    const { deps, lines, sleeps } = fakeDeps({
      env: { BLOB_READ_WRITE_TOKEN: "token-value", GEMINI_API_KEY: "gemini-value" },
      // The first sample's flashcards are saved already.
      getSaved: vi.fn(async (kind: Kind, mapId: string) =>
        kind === "flashcards" && mapId === `map-${SAMPLE_POSTINGS[0].id}` ? [{}] : null,
      ),
    });
    expect(await run(["--gap-ms=13000"], deps)).toBe(0);

    const made = SAMPLE_POSTINGS.length * 2 - 1;
    expect(deps.create).toHaveBeenCalledTimes(made);
    // The first call goes at once; every later one waits out the gap on the fake clock.
    expect(sleeps).toEqual(Array.from({ length: made - 1 }, () => 13_000));
    // Any UUID will do as the viewer, since seeded courses are published.
    const viewerId = vi.mocked(deps.create).mock.calls[0][3];
    expect(viewerId).toMatch(/^[0-9a-f-]{36}$/);

    expect(lines[0]).toBe("Store: Vercel Blob.");
    expect(lines).toContain(`[1/${made + 1}] flashcards · ${SAMPLE_POSTINGS[0].label} · Skill 0 … already saved`);
    expect(lines).toContain(`[2/${made + 1}] quiz · ${SAMPLE_POSTINGS[0].label} · Skill 0 … saved 5 questions`);
    expect(lines).toContain(`[3/${made + 1}] flashcards · ${SAMPLE_POSTINGS[1].label} · Skill 0 … saved 7 cards`);
    expect(lines.at(-1)).toBe(`Done: made ${made}, already there 1, failed 0.`);
    // Env values never reach the output.
    expect(lines.join("\n")).not.toMatch(/token-value|gemini-value/);
  });

  it("logs a failure as a safe sentence, goes on, and exits 1", async () => {
    const create = vi
      .fn<Deps["create"]>()
      .mockRejectedValueOnce(new Error("provider leaked text"))
      .mockResolvedValue([1]);
    const { deps, lines } = fakeDeps({ create });
    expect(await run(["--only=quiz", "--gap-ms=0"], deps)).toBe(1);
    expect(create).toHaveBeenCalledTimes(SAMPLE_POSTINGS.length);
    expect(lines.join("\n")).not.toContain("provider leaked text");
    expect(lines).toContain(
      `[1/${SAMPLE_POSTINGS.length}] quiz · ${SAMPLE_POSTINGS[0].label} · Skill 0 … failed: Error (details left out, as they can hold provider text)`,
    );
    expect(lines.at(-1)).toBe(`Done: made ${SAMPLE_POSTINGS.length - 1}, already there 0, failed 1.`);
  });

  it("keeps env values out of what app code logs while seeding, and restores the console", async () => {
    const realError = console.error;
    const { deps, lines } = fakeDeps({
      env: { S3_BUCKET: "bucket", AWS_ACCESS_KEY_ID: "AKIAFAKEVALUE" },
      ensureSampleCourses: vi.fn(async () => {
        // What seed.ts does when the store refuses the key.
        const sdk = Object.assign(new Error("The AWS Access Key Id you provided does not exist"), {
          name: "InvalidAccessKeyId",
          AWSAccessKeyId: "AKIAFAKEVALUE",
        });
        console.error('[courses] could not seed the sample course "x"', sdk);
        console.warn("raw", { AWSAccessKeyId: "AKIAFAKEVALUE" });
        throw sdk;
      }),
    });
    expect(await run(["--gap-ms=0"], deps)).toBe(1);
    const output = lines.join("\n");
    expect(output).not.toContain("AKIAFAKEVALUE");
    expect(output).toContain('[courses] could not seed the sample course "x" InvalidAccessKeyId (details left out');
    expect(output).toContain("Could not check the sample courses: InvalidAccessKeyId (details left out");
    expect(console.error).toBe(realError);
  });

  it("counts a missing sample course as a failure and does the others", async () => {
    const { deps, lines } = fakeDeps({
      readSeedMapId: vi.fn(async (sampleId: string) => (sampleId === SAMPLE_POSTINGS[0].id ? null : `map-${sampleId}`)),
    });
    expect(await run(["--gap-ms=0"], deps)).toBe(1);
    expect(deps.create).toHaveBeenCalledTimes((SAMPLE_POSTINGS.length - 1) * 2);
    expect(lines.join("\n")).toMatch(/Could not find the sample course/);
  });
});

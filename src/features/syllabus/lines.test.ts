import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamLines, type StreamLinesOptions, type StreamLinesResult } from "@/features/ai";
import { HttpError } from "@/shared/http";
import { streamSyllabus, SyllabusBuilder, syllabusLine, type SyllabusContext } from "./index";

vi.mock("server-only", () => ({}));
vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  streamLines: vi.fn(),
}));
const mockStream = vi.mocked(streamLines);

type ScriptedLines = Record<string, unknown>[];

/** A full syllabus as lines, topic ids prefixed so courses never share one. */
function syllabusLines(prefix: string, units = 8): ScriptedLines {
  const lines: ScriptedLines = [{ kind: "head", outcomes: [1, 2, 3, 4].map((n) => ({ id: `o${n}`, text: `Explain part ${n} of ${prefix}.` })) }];
  const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
  for (let u = 1; u <= units; u++) {
    lines.push({
      kind: "unit",
      id: `u${u}`,
      title: `Unit ${u} of ${prefix}`,
      outcomeIds: [`o${((u - 1) % 4) + 1}`],
      topics: [1, 2, 3, 4, 5].map((t) => ({
        id: `${prefix}-u${u}-t${t}`,
        title: `${prefix} ${words[u - 1]} ${["one", "two", "three", "four", "five"][t - 1]}`,
        objectives: ["Explain it.", "Use it."],
        keyTerms: ["term a", "term b", "term c"],
        inScope: "What it covers.",
        outOfScope: "What it leaves out.",
        buildsOn: t > 1 ? [`${prefix}-u${u}-t${t - 1}`] : [],
      })),
    });
  }
  return lines;
}

/** streamLines replaying scripted lines through the real line validator and onLine. */
function fakeStreamLines(script: (options: StreamLinesOptions<unknown>) => ScriptedLines | null) {
  return async <L>(options: StreamLinesOptions<L>): Promise<StreamLinesResult<L>> => {
    const raw = script(options as StreamLinesOptions<unknown>);
    if (!raw) throw Object.assign(new Error("The AI is unavailable right now."), { name: "AiUnavailableError" });
    const lines: L[] = [];
    for (const [index, value] of raw.entries()) {
      const parsed = options.line.safeParse(value);
      if (!parsed.success) continue;
      lines.push(parsed.data);
      await options.onLine(parsed.data, index);
    }
    return { lines, rejected: [], truncated: false };
  };
}

const COURSE = { slug: "social-psychology", title: "Social psychology", summary: "Explain how others shape us.", requires: ["intro-psychology"], level: 200 as const };
const INTRO_SYLLABUS = {
  version: 1 as const,
  depth: "degree" as const,
  courseSlug: "intro-psychology",
  outcomes: [{ id: "o1", text: "Explain." }],
  units: [{ id: "u1", title: "Basics", outcomeIds: ["o1"], built: false, topics: [{ id: "what-is-psychology", title: "What psychology studies", objectives: ["a"], keyTerms: ["b"], inScope: "", outOfScope: "", buildsOn: [] }] }],
  assessment: { unitTests: true, finalQuestions: 6 },
};

function context(over: Partial<SyllabusContext> = {}): SyllabusContext {
  return {
    courseId: "11111111-1111-4111-8111-111111111111",
    programTitle: "Psychology",
    course: COURSE,
    frame: [{ slug: "intro-psychology", title: "Introduction to psychology", summary: "", requires: [] }, COURSE],
    required: [INTRO_SYLLABUS],
    siblings: [{ slug: "intro-psychology", topics: ["What psychology studies", "Conformity and obedience"] }],
    ...over,
  };
}

const parse = (value: unknown) => syllabusLine.parse(value);
const topic = (id: string, title: string, buildsOn: string[] = []) => ({ id, title, objectives: ["a", "b", "c", "d"], keyTerms: ["1", "2", "3", "4", "5", "6", "7"], inScope: "x", outOfScope: "y", buildsOn });

describe("SyllabusBuilder: per-line fixes", () => {
  it("needs 4 to 6 outcomes in the head, and cuts extra ones", () => {
    const builder = new SyllabusBuilder(context());
    const short = parse({ kind: "head", outcomes: [{ id: "o1", text: "a" }] });
    expect(builder.head(short as never)).toMatchObject({ ok: false });
    const long = parse({ kind: "head", outcomes: Array.from({ length: 8 }, (_, i) => ({ id: `o${i + 1}`, text: `t${i}` })) });
    expect(builder.head(long as never)).toMatchObject({ ok: true, outcomes: { length: 6 } });
  });

  it("trims topics, objectives and key terms, keeps only real buildsOn, drops unknown outcomes and sibling repeats", () => {
    const builder = new SyllabusBuilder(context());
    builder.head(parse({ kind: "head", outcomes: [1, 2, 3, 4].map((n) => ({ id: `o${n}`, text: `t${n}` })) }) as never);
    const result = builder.unit(
      parse({
        kind: "unit",
        id: "u1",
        title: "Influence",
        outcomeIds: ["o1", "o9"],
        topics: [
          topic("conformity", "Conformity and obedience"), // repeats a sibling course's topic: dropped
          topic("norms", "Social norms", ["intro-psychology:what-is-psychology", "intro-psychology:nope", "later-topic"]),
          topic("persuasion", "Persuasion", ["norms", "persuasion"]),
          topic("norms", "Norms again"), // duplicate id: dropped
          topic("attitudes", "Attitudes"),
          topic("groups", "Group behaviour"),
          topic("prejudice", "Prejudice"),
          topic("helping", "Helping others"),
          topic("love", "Attraction"),
        ],
      }) as never,
    );
    expect(result.ok).toBe(true);
    const unit = (result as { unit: { id: string; outcomeIds: string[]; topics: { id: string; objectives: string[]; keyTerms: string[]; buildsOn: string[] }[] } }).unit;
    expect(unit.id).toBe("u1");
    expect(unit.outcomeIds).toEqual(["o1"]);
    expect(unit.topics.map((t) => t.id)).toEqual(["norms", "persuasion", "attitudes", "groups", "prejudice", "helping"]);
    expect(unit.topics[0].objectives).toHaveLength(3);
    expect(unit.topics[0].keyTerms).toHaveLength(6);
    expect(unit.topics[0].buildsOn).toEqual(["intro-psychology:what-is-psychology"]);
    expect(unit.topics[1].buildsOn).toEqual(["norms"]);
  });

  it("rejects a unit before the head, a repeated unit id, and a unit with fewer than 4 usable topics", () => {
    const builder = new SyllabusBuilder(context());
    const words = ["memory", "emotion", "language", "learning"];
    const unit = (id: string, prefix: string, count = 4) =>
      parse({ kind: "unit", id, title: `Unit ${prefix}`, outcomeIds: ["o1"], topics: Array.from({ length: count }, (_, i) => topic(`${prefix}-${i}`, `${prefix}x ${words[i]}`)) }) as never;
    expect(builder.unit(unit("u1", "a"))).toMatchObject({ ok: false });
    builder.head(parse({ kind: "head", outcomes: [1, 2, 3, 4].map((n) => ({ id: `o${n}`, text: `t${n}` })) }) as never);
    expect(builder.unit(unit("u1", "a"))).toMatchObject({ ok: true });
    expect(builder.unit(unit("u1", "b"))).toMatchObject({ ok: false });
    expect(builder.unit(unit("u2", "c", 3))).toMatchObject({ ok: false });
    // A unit committed after a rejected one takes the next number: ids stay u1, u2, ...
    expect(builder.unit(unit("u7", "d"))).toMatchObject({ ok: true, unit: { id: "u2" } });
  });
});

describe("streamSyllabus", () => {
  const hooks = () => {
    const seen: string[] = [];
    return {
      seen,
      hooks: {
        deadline: Date.now() + 110_000,
        onHead: async () => {
          seen.push("head");
        },
        onUnit: async (unit: { id: string }, soFar: { planning?: boolean; units: unknown[] }) => {
          expect(soFar.planning).toBe(true);
          seen.push(`${unit.id}:${soFar.units.length}`);
        },
        onRestart: async () => {
          seen.push("restart");
        },
      },
    };
  };

  beforeEach(() => {
    mockStream.mockReset();
  });

  it("commits each unit as it arrives and returns a final degree syllabus keyed by the courseId", async () => {
    mockStream.mockImplementation(fakeStreamLines((options) => (options.label === "syllabus" ? syllabusLines("soc") : null)));
    const { seen, hooks: h } = hooks();
    const syllabus = await streamSyllabus(context(), h);
    expect(seen).toEqual(["head", "u1:1", "u2:2", "u3:3", "u4:4", "u5:5", "u6:6", "u7:7", "u8:8"]);
    expect(syllabus).toMatchObject({ depth: "degree", rootMapId: context().courseId, courseSlug: "social-psychology", level: 200 });
    expect(syllabus.planning).toBeUndefined();
    expect(syllabus.units).toHaveLength(8);
    expect(mockStream.mock.calls[0][0]).toMatchObject({ profile: "plan", label: "syllabus", effort: "medium" });
  });

  it("asks once for the missing units, listing what is committed", async () => {
    let repairPrompt = "";
    mockStream.mockImplementation(
      fakeStreamLines((options) => {
        if (options.label === "syllabus") return syllabusLines("soc", 5);
        repairPrompt = options.prompt;
        return (syllabusLines("fix", 8) as ScriptedLines).slice(6).map((line, i) => ({ ...line, id: `u${6 + i}` }));
      }),
    );
    const syllabus = await streamSyllabus(context(), hooks().hooks);
    expect(mockStream).toHaveBeenCalledTimes(2);
    expect(repairPrompt).toContain("u6, u7, u8");
    expect(repairPrompt).toContain("soc-u1-t1");
    expect(syllabus.units.map((u) => u.id)).toEqual(["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8"]);
  });

  it("starts over once after a bad head, then gives a 422 when too few units come back", async () => {
    let calls = 0;
    mockStream.mockImplementation(
      fakeStreamLines(() => {
        calls += 1;
        if (calls === 1) return [{ kind: "head", outcomes: [] }];
        if (calls === 2) return syllabusLines("soc", 3);
        return [];
      }),
    );
    const { seen, hooks: h } = hooks();
    await expect(streamSyllabus(context(), h)).rejects.toBeInstanceOf(HttpError);
    expect(seen[0]).toBe("restart");
    expect(calls).toBe(3);
  });
});

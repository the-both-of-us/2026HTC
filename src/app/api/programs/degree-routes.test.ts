/**
 * The program routes for a degree, with a fake identity, the in-memory store, after() queued and
 * the AI scripted: status codes and body shapes while planning streams and once it is done, and
 * that no response carries an owner's id.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON, streamLines, type StreamLinesOptions, type StreamLinesResult } from "@/features/ai";
import { getUserId, readUserId } from "@/shared/identity";
import { GET as comparisonRoute } from "./[id]/comparison/route";
import { POST as courseRoute } from "./[id]/courses/[slug]/route";
import { GET as syllabusRoute } from "./[id]/courses/[slug]/syllabus/route";
import { POST as planRoute } from "./[id]/plan/route";
import { GET as programRoute } from "./[id]/route";
import { POST as createRoute } from "./route";

const { afters } = vi.hoisted(() => {
  const queue: (() => unknown)[] = [];
  return {
    afters: {
      queue,
      async drain() {
        while (queue.length > 0) await queue.shift()!();
      },
    },
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    afters.queue.push(task);
  },
}));
vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  streamLines: vi.fn(),
  chatJSON: vi.fn(),
}));
vi.mock("@/features/lessons", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/lessons")>()),
  writeFirstLessonSoon: vi.fn(),
  ensureLesson: vi.fn(async () => "ready"),
}));
// Unit nodes belong to skill-map: here they are written straight to the unit cache.
vi.mock("@/features/skill-map", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/skill-map")>();
  const { putDoc } = await import("@/shared/store");
  return {
    ...actual,
    ensureUnitNodes: vi.fn(async (input: { contentId: string; unitId: string; syllabus: { units: { id: string; topics: { id: string }[] }[] } }) => {
      const unit = input.syllabus.units.find((u) => u.id === input.unitId)!;
      const nodes = unit.topics.map((t) => ({ id: t.id, title: t.id, why: "Needed.", prerequisites: [], fromSource: false, citation: null, checkpoints: ["a", "b", "c"] }));
      await putDoc(`unit-nodes/${input.contentId}/${input.unitId}`, { rootMapId: input.contentId, unitId: input.unitId, nodes, builtAt: new Date().toISOString() });
      return { status: "ready", nodes };
    }),
    syncCourseMap: vi.fn(async (map: unknown) => ({ map, build: null })),
  };
});
vi.mock("@/shared/identity", () => ({ getUserId: vi.fn(), readUserId: vi.fn() }));

type Lines = Record<string, unknown>[];
const WORDS = ["Perception", "Memory", "Emotion", "Learning", "Language", "Motivation", "Personality", "Development"];
const AREAS = ["Foundations", "Methods", "Biological", "Social", "Cognitive"];

/** A 40-course degree frame as lines: 4 years x 2 terms x 5 courses; course-k requires course-(k-5). */
function degreeFrameLines(): Lines {
  const lines: Lines = [{ kind: "head", title: "Psychology", summary: "Four years of psychology." }];
  for (let n = 0; n < 40; n++) {
    const year = Math.floor(n / 10) + 1;
    lines.push({
      kind: "course",
      slug: `course-${n + 1}`,
      title: `${WORDS[n % 8]} ${AREAS[n % 5]} ${["I", "II", "III", "IV"][year - 1]} t${(Math.floor(n / 5) % 2) + 1}`,
      summary: `Course ${n + 1}.`,
      requires: n >= 5 ? [`course-${n - 4}`] : [],
      year,
      term: (Math.floor(n / 5) % 2) + 1,
      level: year * 100,
      area: AREAS[n % 5],
    });
  }
  return lines;
}

/** An 8-unit syllabus as lines, topic ids prefixed by the course slug. */
function syllabusLines(prefix: string): Lines {
  const lines: Lines = [{ kind: "head", outcomes: [1, 2, 3, 4].map((n) => ({ id: `o${n}`, text: `Explain part ${n}.` })) }];
  for (let u = 1; u <= 8; u++) {
    lines.push({
      kind: "unit",
      id: `u${u}`,
      title: `Unit ${u}`,
      outcomeIds: [`o${((u - 1) % 4) + 1}`],
      topics: [1, 2, 3, 4, 5].map((t) => ({
        id: `${prefix}-u${u}-t${t}`,
        title: `${prefix} ${WORDS[u - 1]} ${["one", "two", "three", "four", "five"][t - 1]}`,
        objectives: ["Explain it.", "Use it."],
        keyTerms: ["a", "b", "c"],
        inScope: "What it covers.",
        outOfScope: "What it leaves out.",
        buildsOn: [],
      })),
    });
  }
  return lines;
}

/** streamLines replaying scripted lines through the real line validator and onLine. */
function fakeStreamLines(script: (options: StreamLinesOptions<unknown>) => Lines | null) {
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

const OWNER = randomUUID();
const STRANGER = randomUUID();
const asUser = (id: string) => {
  vi.mocked(getUserId).mockResolvedValue(id);
  vi.mocked(readUserId).mockResolvedValue(id);
};
const post = (body?: unknown) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
const get = (url = "http://localhost/api") => new Request(url);

async function json(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  expect(text).not.toContain(OWNER);
  expect(text).not.toContain("ownerId");
  return JSON.parse(text);
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
  afters.queue.length = 0;
  vi.mocked(streamLines).mockReset();
  vi.mocked(streamLines).mockImplementation(
    fakeStreamLines((options: StreamLinesOptions<unknown>) => {
      if (options.label === "degree-frame") return degreeFrameLines();
      if (options.label === "syllabus") return syllabusLines(/slug: ([a-z0-9-]+)/.exec(options.prompt)![1]);
      return null;
    }),
  );
  vi.mocked(chatJSON).mockReset();
  vi.mocked(chatJSON).mockImplementation((async (options: { label: string; prompt: string }) => {
    if (options.label !== "catalog-resolve") throw new Error(`unexpected call ${options.label}`);
    if (options.prompt.includes("<lines>")) return { picks: [] };
    return { pick: 0, title: "Psychology", summary: "Understand people." };
  }) as never);
});

describe("degree routes", () => {
  it("create, poll while planning, open a course at once, read its syllabus and the comparison", async () => {
    asUser(OWNER);
    const created = await createRoute(post({ text: "psychology", kind: "topic", shape: "program" }));
    expect(created.status).toBe(201);
    const { programId } = (await json(created)) as { programId: string };
    const id = { params: Promise.resolve({ id: programId }) };
    const params = (slug: string) => ({ params: Promise.resolve({ id: programId, slug }) });

    // Planning runs after the response; the poll shows it until the frame is final.
    expect(afters.queue.length).toBeGreaterThan(0);
    await afters.drain();
    const polled = await programRoute(get(), id);
    expect(polled.headers.get("cache-control")).toBe("no-store");
    const { program } = (await json(polled)) as { program: { planning: unknown; courses: { slug: string; startable: boolean }[] } };
    expect(program).toMatchObject({ planning: { state: "ready", planned: 40, expected: 40 } });
    expect(program.courses).toHaveLength(40);
    expect(program.courses.every((c) => c.startable)).toBe(true);

    // Opening is one step and makes no model call; a second click gets the same map.
    const calls = vi.mocked(streamLines).mock.calls.length + vi.mocked(chatJSON).mock.calls.length;
    const opened = await courseRoute(post(), params("course-1"));
    expect(opened.status).toBe(200);
    const ready = (await json(opened)) as { status: string; mapId: string };
    expect(ready.status).toBe("ready");
    expect(vi.mocked(streamLines).mock.calls.length + vi.mocked(chatJSON).mock.calls.length).toBe(calls);
    expect(await json(await courseRoute(post(), params("course-1")))).toEqual(ready);
    // course-6 needs course-2, which is not started: locked.
    expect((await courseRoute(post(), params("course-6"))).status).toBe(409);

    const syllabus = await syllabusRoute(get(), params("course-2"));
    expect(syllabus.status).toBe(200);
    expect(await json(syllabus)).toMatchObject({ course: { slug: "course-2" } });

    const comparison = await comparisonRoute(get("http://localhost/api?course=course-1"), id);
    expect(await json(comparison)).toMatchObject({ course: { slug: "course-1" } });

    // Try again on a program whose plan is final says so.
    const plan = await planRoute(post(), id);
    expect(plan.status).toBe(200);
    expect(await json(plan)).toEqual({ status: "ready" });

    asUser(STRANGER);
    expect((await programRoute(get(), id)).status).toBe(404);
    expect((await planRoute(post(), id)).status).toBe(404);
    expect((await syllabusRoute(get(), params("course-1"))).status).toBe(404);
    expect((await comparisonRoute(get(), id)).status).toBe(404);
    expect((await courseRoute(post(), params("course-1"))).status).toBe(404);
  });

  it("answers an empty topic with a sentence", async () => {
    asUser(OWNER);
    const empty = await createRoute(post({ text: "", kind: "topic" }));
    expect(empty.status).toBe(400);
    expect(typeof (await json(empty)).error).toBe("string");
  });
});

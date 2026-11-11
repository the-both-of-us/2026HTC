import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiUnavailableError, chatJSON } from "@/features/ai";
import { getDoc, listKeys, putDoc } from "@/shared/store";
import {
  aliasHash,
  audKey,
  catalogKeys,
  claimCourse,
  claimProgram,
  getCatalogCourse,
  MAX_CANDIDATES,
  readCatalogProgram,
  readCatalogSyllabus,
  resolveAuto,
  resolveCourse,
  resolveCourses,
  resolveProgram,
  titleKey,
} from "./index";

vi.mock("server-only", () => ({}));
vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));

const mockChat = vi.mocked(chatJSON);
const later = () => Date.now() + 100_000;
const GRADE_1 = "Grade 1 students (about 6 years old)";

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
  mockChat.mockReset();
  mockChat.mockRejectedValue(new Error("unexpected AI call"));
});

/** A course already in the catalog, as a program line or an earlier learner made it. */
async function existing(title: string, audience = "") {
  return (await claimCourse({ text: title, audience, title, summary: `All about ${title.toLowerCase()}.` })).id;
}

describe("catalog keys", () => {
  it("files a general learner under 'general' and an audience under its key", () => {
    expect(audKey("")).toBe("general");
    expect(audKey(undefined)).toBe("general");
    expect(audKey(GRADE_1)).toBe("grade-1-students-about-6-years-old");
  });

  it("puts audience and depth in every name and alias key", () => {
    expect(catalogKeys.courseName("general", "psychology")).toBe("catalog/names/course/general/psychology");
    expect(catalogKeys.programAlias("general", "degree", "abc")).toBe("catalog/alias/program/general/degree/abc");
    expect(catalogKeys.syllabus("c1")).toBe("catalog/syllabi/c1");
  });
});

describe("identity", () => {
  it("normalises titles: case, accents, &, punctuation and small words", () => {
    expect(titleKey("Introduction to Psychology")).toBe("introduction-psychology");
    expect(titleKey("  The Psychology of Learning & Memory!  ")).toBe("psychology-learning-memory");
    expect(titleKey("Café Économie")).toBe("cafe-economie");
    expect(titleKey("x".repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it("hashes the normalised text, so rewordings with the same words share an alias and raw text is never a key", () => {
    expect(aliasHash("Intro to Psychology")).toBe(aliasHash("intro  psychology"));
    expect(aliasHash("Intro to Psychology")).toMatch(/^[0-9a-f]{16}$/);
    expect(aliasHash("Intro to Psychology")).not.toBe(aliasHash("Social psychology"));
  });
});

describe("resolveCourse", () => {
  it("finds an exact name with no call, and remembers the phrasing as an alias", async () => {
    const id = await existing("Introduction to psychology");
    expect(await resolveCourse({ text: "introduction to PSYCHOLOGY", audience: "", deadline: later() })).toEqual({ status: "found", courseId: id });
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("matches 'Foundations of psychology' to the intro course with one check call", async () => {
    const intro = await existing("Introduction to psychology");
    await existing("Social psychology");
    await existing("Organic chemistry");
    mockChat.mockImplementation(async (options) => {
      expect(options.profile).toBe("check");
      expect(options.label).toBe("catalog-resolve");
      // The chemistry course shares no subject word, so it is never a candidate.
      expect(options.prompt).not.toContain("Organic chemistry");
      const lines = options.prompt.split("\n").filter((line) => /^\d+\. /.test(line));
      const pick = lines.findIndex((line) => line.includes("Introduction to psychology")) + 1;
      return { pick, title: "", summary: "" } as never;
    });
    const result = await resolveCourse({ text: "Foundations of psychology", audience: "", deadline: later() });
    expect(result).toEqual({ status: "found", courseId: intro });
    expect(mockChat).toHaveBeenCalledTimes(1);
    // Next time the same words are an alias hit: no call.
    mockChat.mockClear();
    expect(await resolveCourse({ text: "Foundations of Psychology", audience: "", deadline: later() })).toEqual({ status: "found", courseId: intro });
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("sends at most 12 candidates", async () => {
    for (let n = 0; n < 20; n++) await existing(`Psychology topic ${n}`);
    let listed = 0;
    mockChat.mockImplementation(async (options) => {
      listed = options.prompt.split("\n").filter((line) => /^\d+\. /.test(line)).length;
      return { pick: 0, title: "Psychology of sport", summary: "Use psychology in sport." } as never;
    });
    await resolveCourse({ text: "psychology of sport", audience: "", deadline: later() });
    expect(listed).toBe(MAX_CANDIDATES);
  });

  it("treats an out-of-range or fractional pick as none", async () => {
    await existing("Introduction to psychology");
    for (const pick of [7, -1, 1.5]) {
      mockChat.mockResolvedValueOnce({ pick, title: "Psychology basics", summary: "Know the basics." } as never);
      const result = await resolveCourse({ text: `psychology foundations ${pick}`, audience: "", deadline: later() });
      expect(result).toEqual({ status: "new", title: "Psychology basics", summary: "Know the basics." });
    }
  });

  it("never matches across audiences: a Grade 1 course is not a candidate for a general learner", async () => {
    await existing("Introduction to psychology", GRADE_1);
    mockChat.mockImplementation(async (options) => {
      expect(options.prompt).toContain("(none)");
      return { pick: 1, title: "Psychology", summary: "Know the field." } as never;
    });
    const result = await resolveCourse({ text: "Introduction to psychology", audience: "", deadline: later() });
    expect(result).toEqual({ status: "new", title: "Psychology", summary: "Know the field." });
  });

  it("never names a course from the learner's words: no time for the naming call is the usual try-again error", async () => {
    await expect(resolveCourse({ text: "sql window functions", audience: "", deadline: Date.now() + 1_000 })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(mockChat).not.toHaveBeenCalled();
    expect(await listKeys("catalog/")).toEqual([]);
  });

  it("a failed naming call with nothing to match is the usual try-again error, and nothing is written", async () => {
    mockChat.mockRejectedValue(new AiUnavailableError());
    await expect(resolveCourse({ text: "My cousin Zed's sql window functions", audience: "", deadline: later() })).rejects.toThrow(
      "The AI is unavailable right now. Please try again in a moment.",
    );
    await expect(resolveProgram({ text: "My cousin Zed's psychology", audience: "", depth: "degree", deadline: later() })).rejects.toBeInstanceOf(AiUnavailableError);
    await expect(resolveAuto({ text: "My cousin Zed's psychology", audience: "", depth: "quick", deadline: later() })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(await listKeys("catalog/")).toEqual([]);
  });

  it("an empty title from the naming call is the try-again error too, never the learner's words", async () => {
    mockChat.mockResolvedValue({ pick: 0, title: "  ", summary: "Something." } as never);
    await expect(resolveCourse({ text: "sql window functions", audience: "", deadline: later() })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(await listKeys("catalog/")).toEqual([]);
  });
});

describe("claims", () => {
  it("gives two identical concurrent requests one course", async () => {
    const claims = await Promise.all(
      [1, 2, 3].map(() => claimCourse({ text: "Foundations of psychology", audience: "", title: "Introduction to psychology", summary: "s" })),
    );
    expect(new Set(claims.map((claim) => claim.id)).size).toBe(1);
    expect(claims.filter((claim) => claim.created)).toHaveLength(1);
    expect(await listKeys("catalog/courses/")).toHaveLength(1);
  });

  it("merges two phrasings that name the same title at the same moment", async () => {
    const [a, b] = await Promise.all([
      claimCourse({ text: "Foundations of psychology", audience: "", title: "Introduction to psychology", summary: "s" }),
      claimCourse({ text: "Psych 101", audience: "", title: "Introduction to psychology", summary: "s" }),
    ]);
    expect(a.id).toBe(b.id);
    // Both phrasings now lead to it.
    expect(await resolveCourse({ text: "Psych 101", audience: "", deadline: later() })).toEqual({ status: "found", courseId: a.id });
  });

  it("stores no learner words in a canonical doc or key", async () => {
    const secret = "my name is Zed and I want psychology";
    await claimCourse({ text: secret, audience: "", title: "Psychology", summary: "Know the field." });
    await claimProgram({ text: secret, audience: "", depth: "quick", title: "Psychology", summary: "A path." });
    const keys = await listKeys("catalog/");
    for (const key of keys) {
      expect(key).not.toContain("zed");
      expect(JSON.stringify(await getDoc(key))).not.toContain("Zed");
    }
  });

  it("reads a claimed program as planning while its planner starts, then stalled until its frame is planned", async () => {
    const { id } = await claimProgram({ text: "psychology", audience: "", depth: "degree", title: "Psychology", summary: "A degree." });
    expect(await readCatalogProgram(id)).toMatchObject({ state: "planning", program: { title: "Psychology", depth: "degree", courses: [] } });
    const seed = (await getDoc<Record<string, unknown>>(catalogKeys.programSeed(id)))!;
    await putDoc(catalogKeys.programSeed(id), { ...seed, createdAt: new Date(Date.now() - 60_000).toISOString() });
    expect(await readCatalogProgram(id)).toMatchObject({ state: "stalled", program: { courses: [] } });
    expect(await resolveProgram({ text: "Psychology", audience: "", depth: "degree", deadline: later() })).toEqual({ status: "found", programId: id });
    // A quick program is a different entry.
    mockChat.mockResolvedValueOnce({ pick: 0, title: "Psychology", summary: "A path." } as never);
    expect(await resolveProgram({ text: "Psychology", audience: "", depth: "quick", deadline: later() })).toMatchObject({ status: "new" });
  });
});

describe("resolveCourses (a batch of program lines)", () => {
  it("matches exact names with no call, skips the model for lines with no candidates, and asks once for the rest", async () => {
    const intro = await existing("Introduction to psychology");
    const social = await existing("Social psychology");
    mockChat.mockImplementation(async (options) => {
      expect(options.prompt).toContain("Line 1: Psychology foundations");
      expect(options.prompt).not.toContain("Underwater basket weaving");
      return { picks: [{ i: 1, pick: 1 }, { i: 9, pick: 1 }] } as never;
    });
    const results = await resolveCourses(
      [
        { title: "Social psychology", summary: "" },
        { title: "Underwater basket weaving", summary: "Weave." },
        { title: "Psychology foundations", summary: "Basics." },
      ],
      { audience: "", deadline: later() },
    );
    expect(mockChat).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual({ status: "found", courseId: social });
    expect(results[1]).toEqual({ status: "new", title: "Underwater basket weaving", summary: "Weave." });
    // Candidates for "Psychology foundations": the two psychology courses, closest first.
    expect(results[2].status).toBe("found");
    expect([intro, social]).toContain((results[2] as { courseId: string }).courseId);
  });

  it("counts every pending line as new when the call fails", async () => {
    await existing("Introduction to psychology");
    mockChat.mockRejectedValue(new Error("down"));
    const results = await resolveCourses([{ title: "Psychology basics", summary: "s" }], { audience: "", deadline: later() });
    expect(results).toEqual([{ status: "new", title: "Psychology basics", summary: "s" }]);
  });
});

describe("readCatalogSyllabus", () => {
  it("is idle with nothing, planning from the partial doc, and ready once final", async () => {
    const id = await existing("Introduction to psychology");
    expect(await readCatalogSyllabus(id)).toEqual({ state: "idle" });

    const now = new Date().toISOString();
    await putDoc(`claims/${catalogKeys.syllabus(id)}`, { startedAt: now, heartbeatAt: now, attempt: 1 });
    await putDoc(`partial/${catalogKeys.syllabus(id)}`, {
      attempt: 1,
      updatedAt: now,
      parts: [
        { kind: "head", outcomes: [{ id: "o1", text: "Explain." }], courseSlug: "intro-psychology", level: 100, assessment: { unitTests: true, finalQuestions: 6 } },
        { kind: "unit", unit: { id: "u1", title: "Unit one", outcomeIds: ["o1"], built: false, topics: [] } },
      ],
    });
    const planning = await readCatalogSyllabus(id);
    expect(planning).toMatchObject({ state: "planning", syllabus: { planning: true, rootMapId: id, courseSlug: "intro-psychology", units: [{ id: "u1" }] } });

    await putDoc(catalogKeys.syllabus(id), { version: 1, depth: "degree", courseSlug: "intro-psychology", outcomes: [], units: [], assessment: { unitTests: true, finalQuestions: 6 } });
    expect((await readCatalogSyllabus(id)).state).toBe("ready");
    expect(await getCatalogCourse(id)).toMatchObject({ title: "Introduction to psychology" });
  });
});

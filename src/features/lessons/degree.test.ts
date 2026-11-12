import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON, streamLines } from "@/features/ai";
import { skillBlock } from "@/features/skill-map";
import { getDoc, putDoc } from "@/shared/store";
import type { CourseSyllabus, SkillMap, SkillNode } from "@/shared/types";
import { checkPracticeAnswer, getOrCreateLesson } from "./lessons";
import { lessonIn, replyWith } from "./testing";
import {
  buildLessonPrompt,
  DEGREE_TARGET_WORDS,
  lessonSystemPrompt,
  lessonLinesSystemPrompt,
  LESSON_SYSTEM_PROMPT,
  TARGET_WORDS,
  targetWords,
  wantsPractice,
  type RawLesson,
} from "./prompt";
import { lessonProblem, lessonText, practiceAnswersOf, toLesson, wordLimits } from "./validate";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
  streamLines: vi.fn(),
}));
vi.mock("@/shared/store/once", async () => await import("@/shared/store/onceFake"));
// WP2 builds the real skillBlock. Here it only has to be called for syllabus nodes and left alone for legacy ones.
vi.mock("@/features/skill-map", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/skill-map")>()),
  skillBlock: vi.fn(() => ["Objectives: explain X", "Key terms: alpha, beta"]),
}));
const mockChatJSON = vi.mocked(chatJSON);
const mockStream = vi.mocked(streamLines);

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const OWNER = randomUUID();

const LEGACY_NODE: SkillNode = {
  id: "n",
  title: "Counting to 100",
  why: "w",
  prerequisites: [],
  fromSource: false,
  citation: null,
  checkpoints: ["a b", "c d"],
};
const SYLLABUS_NODE: SkillNode = {
  ...LEGACY_NODE,
  id: "attention",
  title: "Attention",
  unitId: "u1",
  topicId: "attention",
  objectives: ["Explain selective attention"],
  keyTerms: ["alpha", "beta", "gamma"],
  inScope: "What attention is.",
  outOfScope: "Memory.",
  checkpoints: ["Selective attention filters what reaches awareness, so unattended input is mostly lost."],
};

function syllabus(): CourseSyllabus {
  return {
    version: 1,
    courseSlug: "intro-psych",
    outcomes: [{ id: "o1", text: "Describe attention" }],
    units: [{ id: "u1", title: "Mind", outcomeIds: ["o1"], built: true, topics: [] }],
    assessment: { unitTests: true, finalQuestions: 6 },
  };
}

const SENTENCE = "Picture a busy train station where you can follow one announcement while the others fade into a blur of background noise. "; // 22 words
const ANSWER_ONE = "Because the listener filters the stream, the unattended speaker is processed shallowly and mostly forgotten afterwards.";
const ANSWER_TWO = "The widened spotlight explains why a surprising name can still break through the filter from a second conversation.";

function degreeLesson(words = 1200): RawLesson {
  const part = (n: number) => SENTENCE.repeat(Math.max(1, Math.round(n / 22)));
  return {
    idea: [part(words * 0.3), part(words * 0.3)],
    example: { intro: part(words * 0.08), code: null, after: part(words * 0.08) },
    mistakes: [
      { mistake: "Thinking attention is a switch.", fix: part(words * 0.04) },
      { mistake: "Confusing it with memory.", fix: part(words * 0.04) },
      { mistake: "Thinking filtering is total.", fix: part(words * 0.04) },
    ],
    checks: [
      { question: "What does the filter do?", answer: "It limits what is processed." },
      { question: "Is the unattended input gone?", answer: "No, some of it is still processed." },
    ],
    practice: [
      { scenario: "Two people talk at a party and you listen to only one of them.", question: "What do you remember of the other talker?", modelAnswer: ANSWER_ONE },
      { scenario: "Someone says your name across the room while you talk.", question: "Why do you notice it?", modelAnswer: ANSWER_TWO },
    ],
  };
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockChatJSON.mockReset();
  mockStream.mockReset();
  vi.mocked(skillBlock).mockClear();
});

describe("legacy lesson prompts are untouched", () => {
  it("system prompt and node prompt are byte for byte the old text", () => {
    expect(hash(LESSON_SYSTEM_PROMPT)).toBe("bd96d3eb0e8ccefc");
    expect(lessonSystemPrompt(undefined, undefined)).toBe(LESSON_SYSTEM_PROMPT);
    expect(lessonSystemPrompt(undefined, false)).toBe(LESSON_SYSTEM_PROMPT);
    expect(hash(buildLessonPrompt({ title: "T" }, { ...LEGACY_NODE, title: "Counting to 100", why: "w", id: "n" }))).toBe("3e7b6406c2c81dfb");
    // A course with a syllabus has the old node prompt too: only a node's syllabus lines differ.
    expect(hash(buildLessonPrompt({ title: "T", syllabus: syllabus() }, LEGACY_NODE))).toBe("3e7b6406c2c81dfb");
    expect(skillBlock).not.toHaveBeenCalled();
  });

  it("a node built from a syllabus gets its lines inside the block, before the checkpoints", () => {
    const prompt = buildLessonPrompt({ title: "Psych", syllabus: syllabus() }, SYLLABUS_NODE);
    expect(skillBlock).toHaveBeenCalledTimes(1);
    expect(prompt).toContain("Why it matters: w\nObjectives: explain X\nKey terms: alpha, beta\nCheckpoints:");
    expect(prompt.match(/<skill>/g)).toHaveLength(1);
  });
});

describe("the degree lesson target", () => {
  it("is 1,000 to 1,400 words, from the shared shape", () => {
    expect(DEGREE_TARGET_WORDS).toEqual({ min: 1000, max: 1400 });
    expect(targetWords(undefined, true)).toBe(DEGREE_TARGET_WORDS);
    expect(targetWords(undefined, undefined)).toBe(TARGET_WORDS);
    // Children keep their own length, even in a syllabus course.
    expect(targetWords("Grade 1 students (about 6 years old)", true).max).toBe(350);
  });

  it("the prompt asks for it and for two practice cases", () => {
    const prompt = lessonSystemPrompt(undefined, true);
    expect(prompt).toContain("1000 to 1400 words in total, so it takes 5 to 7 minutes");
    expect(prompt).not.toContain("600 to 900");
    expect(prompt).toContain("PRACTICE");
    expect(prompt).toContain("exactly 2 practice cases");
    expect(lessonSystemPrompt("Grade 1 students (about 6 years old)", true)).not.toContain("PRACTICE");
  });

  it("accepts about 1,200 words and rejects a thin or a bloated lesson", () => {
    expect(wordLimits(DEGREE_TARGET_WORDS)).toEqual({ min: 750, max: 1550 });
    expect(lessonProblem(degreeLesson(1200), SYLLABUS_NODE.checkpoints, undefined, true)).toBeNull();
    expect(lessonProblem(degreeLesson(700), SYLLABUS_NODE.checkpoints, undefined, true)).toMatch(/Write 1000 to 1400/);
    expect(lessonProblem(degreeLesson(1900), SYLLABUS_NODE.checkpoints, undefined, true)).toMatch(/too long/);
    // The same 700 words are fine for a posting map's lesson.
    expect(lessonProblem(degreeLesson(700), SYLLABUS_NODE.checkpoints)).toBeNull();
  });

  it("needs exactly two practice cases, each complete", () => {
    const one = { ...degreeLesson(), practice: degreeLesson().practice!.slice(0, 1) };
    expect(lessonProblem(one, SYLLABUS_NODE.checkpoints, undefined, true)).toMatch(/exactly 2 cases/);
    const blank = degreeLesson();
    blank.practice![1].modelAnswer = " ";
    expect(lessonProblem(blank, SYLLABUS_NODE.checkpoints, undefined, true)).toMatch(/exactly 2 cases/);
    expect(wantsPractice(undefined, true)).toBe(true);
    expect(wantsPractice(undefined, false)).toBe(false);
  });

  it("counts a practice scenario and question as reading, never the model answer", () => {
    const text = lessonText(degreeLesson());
    expect(text).toContain("Two people talk at a party");
    expect(text).not.toContain(ANSWER_ONE);
  });
});

describe("practice answers stay on the server", () => {
  let mapId: string;

  beforeEach(async () => {
    mapId = randomUUID();
    const map: SkillMap = {
      id: mapId,
      ownerId: OWNER,
      title: "Introduction to Psychology",
      subtitle: "",
      sourceKind: "topic",
      sourceText: "",
      nodes: [SYLLABUS_NODE],
      createdAt: new Date().toISOString(),
      syllabus: syllabus(),
    };
    await putDoc(`maps/${mapId}`, map);
  });

  it("a degree lesson is written with the degree prompt and shows the cases without their answers", async () => {
    mockStream.mockImplementationOnce(replyWith(degreeLesson()));
    const lesson = lessonIn(await getOrCreateLesson(mapId, "attention", OWNER));

    expect(mockStream.mock.calls[0][0].system).toBe(lessonLinesSystemPrompt(undefined, true));
    expect(lessonLinesSystemPrompt(undefined, true)).toContain(lessonSystemPrompt(undefined, true));
    expect(lessonLinesSystemPrompt(undefined, true)).toContain('{"part":"practice"');
    expect(mockStream.mock.calls[0][0].prompt).toContain("Objectives: explain X");
    expect(lesson.practice).toEqual([
      { scenario: "Two people talk at a party and you listen to only one of them.", question: "What do you remember of the other talker?" },
      { scenario: "Someone says your name across the room while you talk.", question: "Why do you notice it?" },
    ]);
    // What the route sends is the lesson: no model answer anywhere in it.
    const sent = JSON.stringify({ lesson });
    expect(sent).not.toContain(ANSWER_ONE);
    expect(sent).not.toContain(ANSWER_TWO);
    expect(sent).not.toContain("modelAnswer");
    // Reading it again from the store returns the same safe shape.
    expect(JSON.stringify(await getOrCreateLesson(mapId, "attention", OWNER))).not.toContain(ANSWER_ONE);
    // The answers are kept apart, beside the lesson, for the check.
    const saved = await getDoc<{ practiceAnswers?: string[] }>(`lessons/${mapId}/attention`);
    expect(saved?.practiceAnswers).toEqual([ANSWER_ONE, ANSWER_TWO]);
    expect(practiceAnswersOf(degreeLesson())).toEqual([ANSWER_ONE, ANSWER_TWO]);
    expect(toLesson(degreeLesson()).practice?.[0]).not.toHaveProperty("modelAnswer");
  });

  it("a lesson on a map with no syllabus (a posting or PDF map) has no practice", async () => {
    const { syllabus: _dropped, ...plain } = (await getDoc<SkillMap>(`maps/${mapId}`))!;
    void _dropped;
    await putDoc(`maps/${mapId}`, plain);
    const short = degreeLesson(700);
    delete short.practice;
    mockStream.mockImplementationOnce(replyWith(short));
    const lesson = lessonIn(await getOrCreateLesson(mapId, "attention", OWNER));
    expect(lesson.practice).toBeUndefined();
    expect(mockStream.mock.calls[0][0].system).toBe(lessonLinesSystemPrompt(undefined, false));
    expect(mockStream.mock.calls[0][0].system).not.toContain('"part":"practice"');
  });

  it("checking an answer returns a verdict and a note, never the model answer", async () => {
    mockStream.mockImplementationOnce(replyWith(degreeLesson()));
    await getOrCreateLesson(mapId, "attention", OWNER);

    mockChatJSON.mockResolvedValueOnce({ verdict: "partly", feedback: "Think about what the filter lets through." });
    const result = await checkPracticeAnswer(mapId, "attention", OWNER, 0, "I would remember almost nothing from the other talker.");
    expect(result).toEqual({ verdict: "partly", feedback: "Think about what the filter lets through." });
    // The model answer goes to the grader, and only there.
    expect(mockChatJSON.mock.calls[0][0]).toMatchObject({ profile: "check", label: "lesson-practice-check" });
    expect(mockChatJSON.mock.calls[0][0].prompt).toContain(ANSWER_ONE);
    expect(JSON.stringify(result)).not.toContain(ANSWER_ONE);
  });

  it("replaces a note that repeats the model answer", async () => {
    mockStream.mockImplementationOnce(replyWith(degreeLesson()));
    await getOrCreateLesson(mapId, "attention", OWNER);

    mockChatJSON.mockResolvedValueOnce({ verdict: "off", feedback: `The answer was: ${ANSWER_ONE}` });
    const result = await checkPracticeAnswer(mapId, "attention", OWNER, 0, "I have no idea what happens here at all.");
    expect(result.verdict).toBe("off");
    expect(result.feedback).not.toContain("shallowly");
  });

  it("refuses a missing case, a stranger and an answer that is too short or too long", async () => {
    mockStream.mockImplementationOnce(replyWith(degreeLesson()));
    await getOrCreateLesson(mapId, "attention", OWNER);
    const words = "I would remember very little of what the other talker said";

    await expect(checkPracticeAnswer(mapId, "attention", OWNER, 5, words)).rejects.toMatchObject({ status: 404 });
    await expect(checkPracticeAnswer(mapId, "attention", randomUUID(), 0, words)).rejects.toMatchObject({ status: 404 });
    await expect(checkPracticeAnswer(mapId, "attention", OWNER, 0, "no")).rejects.toMatchObject({ status: 400 });
    await expect(checkPracticeAnswer(mapId, "attention", OWNER, 0, "word ".repeat(1000))).rejects.toMatchObject({ status: 400 });
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("a lesson with no practice has nothing to check", async () => {
    mockStream.mockImplementationOnce(replyWith(degreeLesson()));
    await getOrCreateLesson(mapId, "attention", OWNER);
    await putDoc(`lessons/${mapId}/attention`, { lesson: toLesson({ ...degreeLesson(), practice: undefined }), createdAt: "x" });
    await expect(checkPracticeAnswer(mapId, "attention", OWNER, 0, "I would remember very little of it")).rejects.toMatchObject({ status: 404 });
  });
});

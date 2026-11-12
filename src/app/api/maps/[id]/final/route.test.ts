import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { getUserId } from "@/shared/identity";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { GET, POST } from "./route";
import { POST as SUBMIT } from "./submit/route";

vi.mock("@/shared/identity", () => ({ getUserId: vi.fn() }));
vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
const mockUser = vi.mocked(getUserId);
const mockChatJSON = vi.mocked(chatJSON);

const OWNER = "secret-owner-id";
const KEY_TEXT = "Explained because";

async function readyMap(): Promise<SkillMap> {
  const map: SkillMap = {
    id: crypto.randomUUID(),
    ownerId: OWNER,
    title: "Data analyst",
    subtitle: "",
    sourceKind: "posting",
    sourceText: "",
    nodes: ["a", "b"].map((id) => ({ id, title: `Skill ${id}`, why: "", prerequisites: [], fromSource: false, citation: null, checkpoints: ["A fact"] })),
    createdAt: "2026-11-12T10:00:00.000Z",
  };
  await putDoc(`maps/${map.id}`, map);
  for (const nodeId of ["a", "b"]) await putDoc(`progress/${map.id}/${OWNER}/${nodeId}`, { nodeId, attemptId: "x", provenAt: map.createdAt });
  return map;
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });
const url = (id: string, path = "") => `http://test/api/maps/${id}/final${path}`;

function submit(id: string, body: unknown) {
  return SUBMIT(new Request(url(id, "/submit"), { method: "POST", body: JSON.stringify(body) }), context(id));
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockUser.mockReset().mockResolvedValue(OWNER);
  mockChatJSON.mockReset().mockResolvedValueOnce({
    questions: Array.from({ length: 5 }, (_, i) => ({
      question: `Question ${i + 1} about both skills?`,
      options: [`Right ${i}`, `Wrong a ${i}`, `Wrong b ${i}`, `Wrong c ${i}`],
      explanation: `${KEY_TEXT} ${i}.`,
      topics: [1, 2],
    })),
  });
});

describe("the final test routes", () => {
  it("start without the key, submit once with the review, and refuse a second submit", async () => {
    const map = await readyMap();
    const started = await POST(new Request(url(map.id), { method: "POST" }), context(map.id));
    expect(started.status).toBe(200);
    const text = await started.text();
    expect(text).not.toContain("correctIndex");
    expect(text).not.toContain(KEY_TEXT);
    expect(text).not.toContain(OWNER);
    const view = JSON.parse(text);
    expect(view).toMatchObject({ state: "in-progress", format: "multiple-choice", questionCount: 5 });

    // A partial submission is refused, and its error says nothing about the answers.
    const partial = await submit(map.id, { testId: view.testId, answers: [0] });
    expect(partial.status).toBe(400);
    expect(await partial.text()).not.toContain(KEY_TEXT);

    const record = (await getDoc<{ questions: { correctIndex: number }[] }>(`final/${map.id}`))!;
    const answers = record.questions.map((question) => question.correctIndex);
    const graded = await submit(map.id, { testId: view.testId, answers });
    expect(graded.status).toBe(200);
    const result = await graded.json();
    expect(result).toMatchObject({ state: "passed", result: { passedCount: 5, questionCount: 5, format: "multiple-choice" } });
    expect(result.review[0].explanation).toContain(KEY_TEXT);
    expect(mockChatJSON).toHaveBeenCalledTimes(1);

    const again = await submit(map.id, { testId: view.testId, answers });
    expect(again.status).toBe(409);

    const read = await GET(new Request(url(map.id)), context(map.id));
    expect((await read.json()).review).toHaveLength(5);
  });

  it("give a stranger a 404 and read nothing of the test", async () => {
    const map = await readyMap();
    await POST(new Request(url(map.id), { method: "POST" }), context(map.id));
    mockUser.mockResolvedValue("someone-else");
    const read = await GET(new Request(url(map.id)), context(map.id));
    expect(read.status).toBe(404);
    const text = await read.text();
    expect(text).not.toContain("Question 1");
    expect((await submit(map.id, { testId: "x", answers: [0, 0, 0, 0, 0] })).status).toBe(404);
    expect((await POST(new Request(url(map.id), { method: "POST" }), context(map.id))).status).toBe(404);
  });

  it("refuse a body that is not a submission", async () => {
    const map = await readyMap();
    expect((await submit(map.id, { answers: "all of them" })).status).toBe(400);
  });
});

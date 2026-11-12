import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { answersFor, fakeChat, KEY_MARK, seedCourse, seedPostingMap, seedSets } from "./test-fixtures";
import { getUserId, readUserId } from "@/shared/identity";
import { POST as answers } from "@/app/api/pretest/[mapId]/answers/route";
import { POST as dismiss } from "@/app/api/pretest/[mapId]/dismiss/route";
import { GET } from "@/app/api/pretest/[mapId]/route";
import { POST as start } from "@/app/api/pretest/[mapId]/start/route";
import { POST as stop } from "@/app/api/pretest/[mapId]/stop/route";

vi.mock("@/shared/identity", () => ({ getUserId: vi.fn(), readUserId: vi.fn() }));
vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
vi.mock("@/shared/store/once", async () => await import("@/shared/store/onceFake"));
const mockChat = vi.mocked(chatJSON);

const params = (mapId: string) => ({ params: Promise.resolve({ mapId }) });
const post = (body: unknown) => new Request("http://test/api/pretest", { method: "POST", body: JSON.stringify(body) });

async function as(ownerId: string) {
  vi.mocked(getUserId).mockResolvedValue(ownerId);
  vi.mocked(readUserId).mockResolvedValue(ownerId);
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  mockChat.mockReset();
  mockChat.mockImplementation(async (options) => fakeChat(options) as never);
});

describe("/api/pretest/[mapId]", () => {
  it("never sends an answer key, in any reply or status", async () => {
    const { courseId, syllabus, map } = await seedCourse();
    await seedSets(courseId, syllabus);
    await as(map.ownerId);
    const replies: Response[] = [];

    replies.push(await GET(new Request("http://test"), params(map.id)));
    replies.push(await start(new Request("http://test", { method: "POST" }), params(map.id)));
    replies.push(await answers(post({ unitId: "u3", answers: [] }), params(map.id)));
    replies.push(await answers(post({ unitId: "u1", answers: "nope" }), params(map.id)));
    replies.push(await answers(post({ unitId: "u1", answers: [{ topicId: "u1-t1", choice: 4 }] }), params(map.id)));
    const unitOne = await answersFor(map, "u1", { "u1-t1": "right" });
    // Before the unit is submitted no reply, error or not, holds the key.
    const bodiesBefore = await Promise.all(replies.map((reply) => reply.text()));
    for (const body of bodiesBefore) expect(body).not.toMatch(/ANSWERKEY|correctIndex|explanation/);

    const submitted = await answers(post(unitOne), params(map.id));
    const replay = await answers(post(unitOne), params(map.id));
    const stopped = await stop(new Request("http://test", { method: "POST" }), params(map.id));
    const restarted = await start(new Request("http://test", { method: "POST" }), params(map.id));

    expect(replies.map((reply) => reply.status)).toEqual([200, 200, 409, 400, 400]);
    expect([submitted.status, replay.status, stopped.status, restarted.status]).toEqual([200, 409, 200, 409]);
    const answering = JSON.parse(bodiesBefore[1]);
    expect(answering.state).toBe("answering");
    expect(Object.keys(answering.current.questions[0]).sort()).toEqual(["options", "question", "topicId", "topicTitle"]);
    expect(answering.current.questions[0].options).toHaveLength(4);

    const review = JSON.parse(await submitted.text());
    expect(review.results.map((result: { topicId: string; outcome: string }) => [result.topicId, result.outcome])).toEqual([
      ["u1-t1", "known"],
      ["u1-t2", "skipped"],
      ["u1-t3", "skipped"],
      ["u1-t4", "skipped"],
    ]);
    // The unit is submitted, so its key is shown; the next unit's is not.
    expect(JSON.stringify(review.results)).toContain(KEY_MARK);
    expect(JSON.stringify(review.current)).not.toContain(KEY_MARK);
    expect(await replay.text()).not.toContain(KEY_MARK);
  });

  it("refuses a posting map and answers strangers like a missing map", async () => {
    const { map } = await seedCourse();
    const posting = await seedPostingMap(map.ownerId);
    await as(map.ownerId);
    expect((await start(new Request("http://test", { method: "POST" }), params(posting.id))).status).toBe(400);
    expect((await dismiss(new Request("http://test", { method: "POST" }), params(posting.id))).status).toBe(400);
    expect(await (await GET(new Request("http://test"), params(posting.id))).json()).toMatchObject({ offer: "none", reason: "not-a-course" });

    await as("someone-else");
    expect((await GET(new Request("http://test"), params(map.id))).status).toBe(404);
    expect((await start(new Request("http://test", { method: "POST" }), params(map.id))).status).toBe(404);
  });
});

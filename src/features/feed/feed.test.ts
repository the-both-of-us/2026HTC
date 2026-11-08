import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { generateSkillMap } from "@/features/skill-map";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import type { SkillMap } from "@/shared/types";
import { getFeedPage } from "./feed";
import { cardsSystemPrompt } from "./prompt";
import { orderCards, planPage } from "./rank";
import { listReactions, setReaction } from "./reactions";
import { findShort, looksEducational } from "./shorts";
import { getOrCreateTopiclets } from "./topiclets";
import type { Topiclet } from "./types";
import { cardProblem } from "./validate";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
const mockChatJSON = vi.mocked(chatJSON);

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
  vi.stubEnv("YOUTUBE_API_KEY", "");
  mockChatJSON.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const MAP: Pick<SkillMap, "nodes"> = {
  nodes: [
    {
      id: "sql-joins",
      title: "SQL joins",
      why: "Reports combine tables.",
      prerequisites: [],
      fromSource: true,
      citation: null,
      checkpoints: ["A LEFT JOIN keeps every row from the left table even when the right table has no match."],
    },
  ],
};

describe("card checks", () => {
  const body = "Think of two guest lists. A left join keeps everyone on the first list and leaves blanks where the second has nobody.";
  it("accepts a good card and rejects unknown topics, links and copied checkpoints", () => {
    expect(cardProblem({ nodeId: "sql-joins", title: "Left joins keep everyone", body }, MAP)).toBeNull();
    expect(cardProblem({ nodeId: "nope", title: "Left joins keep everyone", body }, MAP)).toMatch(/not one of/);
    expect(cardProblem({ nodeId: "sql-joins", title: "Left joins keep everyone", body: `${body} See https://x.com.` }, MAP)).toMatch(/link/);
    const copied = "A LEFT JOIN keeps every row from the left table even when the right table has no match. That is all.";
    expect(cardProblem({ nodeId: "sql-joins", title: "Left joins keep everyone", body: copied }, MAP)).toMatch(/word for word/);
  });

  it("pitches the prompt at children only when the map has an audience", () => {
    expect(cardsSystemPrompt()).not.toContain("AUDIENCE");
    expect(cardsSystemPrompt("Grade 1 students (about 6 years old)")).toContain("toys, fruit");
  });
});

describe("ranking", () => {
  const card = (mapId: string, nodeId: string, n: number): Topiclet => ({ id: `${mapId}.${n}`, mapId, nodeId, title: "t", body: "b" });

  it("puts open topics first and takes maps in turns", () => {
    const ordered = orderCards([
      { mapId: "a", cards: [card("a", "done", 0), card("a", "open", 1)], states: { done: "proven", open: "available" }, dim: {} },
      { mapId: "b", cards: [card("b", "x", 0)], states: { x: "available" }, dim: {} },
    ]);
    expect(ordered.map((c) => c.id)).toEqual(["a.1", "b.0", "a.0"]);
  });

  it("puts a fading proved topic before a fresh one", () => {
    const ordered = orderCards([
      { mapId: "a", cards: [card("a", "fresh", 0), card("a", "faded", 1)], states: { fresh: "proven", faded: "proven" }, dim: { faded: 2 } },
    ]);
    expect(ordered[0].nodeId).toBe("faded");
  });

  it("plans a Short after every third card, never the same topic twice on a page", () => {
    const cards = Array.from({ length: 12 }, (_, n) => card("a", n < 6 ? "same" : `t${n}`, n));
    const page = planPage(cards, 0);
    expect(page.cards).toHaveLength(9);
    expect(page.shortAfter).toEqual([2, 8]);
    expect(page.next).toBe(9);
    expect(planPage(cards, 9).next).toBeNull();
  });
});

describe("Shorts", () => {
  it("filters entertainment, but lets songs through for young children", () => {
    expect(looksEducational("How SQL joins work")).toBe(true);
    expect(looksEducational("SQL prank on my boss")).toBe(false);
    expect(looksEducational("The counting song")).toBe(false);
    expect(looksEducational("The counting song", "Grade 1 students (about 6 years old)")).toBe(true);
  });

  it("searches once per topic, caches the answer, and is silent with no key", async () => {
    const map = { ...MAP, id: randomUUID(), title: "Data", audience: undefined } as SkillMap;
    const node = map.nodes[0];
    expect(await findShort(map, node)).toBeNull();

    vi.stubEnv("YOUTUBE_API_KEY", "test-key");
    const fetchMock = vi.fn(async () =>
      Response.json({
        items: [
          { id: { videoId: "prank123456" }, snippet: { title: "Join prank", channelTitle: "X" } },
          { id: { videoId: "good1234567" }, snippet: { title: "Joins &amp; keys explained", channelTitle: "Teach" } },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await findShort(map, node)).toEqual({ videoId: "good1234567", title: "Joins & keys explained", channel: "Teach" });
    expect(await findShort(map, node)).toEqual({ videoId: "good1234567", title: "Joins & keys explained", channel: "Teach" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get("safeSearch")).toBe("strict");
    expect(url.searchParams.get("videoDuration")).toBe("short");
  });
});

describe("likes and saves", () => {
  it("are idempotent per viewer", async () => {
    const viewer = randomUUID();
    const cardId = `${randomUUID()}.3`;
    await setReaction(viewer, "like", cardId, true);
    await setReaction(viewer, "like", cardId, true);
    expect([...(await listReactions(viewer, "like"))]).toEqual([cardId]);
    expect((await listReactions(randomUUID(), "like")).size).toBe(0);
    await setReaction(viewer, "like", cardId, false);
    await setReaction(viewer, "like", cardId, false);
    expect((await listReactions(viewer, "like")).size).toBe(0);
    await expect(setReaction(viewer, "save", "not-a-card", true)).rejects.toThrow();
  });
});

describe("the feed", () => {
  // If a sample map changes, this fails: run `npm run cache-feed -- --force`.
  it.each(SAMPLE_POSTINGS)("has saved cards for the sample $id that pass the checks", async (sample) => {
    const map = await generateSkillMap({ text: sample.text, kind: "posting", ownerId: randomUUID() });
    const cards = await getOrCreateTopiclets(map);
    expect(cards.length).toBeGreaterThanOrEqual(8);
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("writes one map's cards with one AI call and serves the viewer's own maps", async () => {
    const owner = randomUUID();
    const map = await generateSkillMap({ text: SAMPLE_POSTINGS[0].text, kind: "posting", ownerId: owner });
    // A map not built from a sample has no saved cards, so pretend it is a new topic map.
    const { saveSkillMap } = await import("@/features/skill-map");
    const own = { ...map, id: randomUUID(), sourceKind: "topic" as const, sourceText: "data analysis" };
    await saveSkillMap(own);
    const body = "A short and true idea about this topic, said in plain words for a learner. It has a second sentence too.";
    mockChatJSON.mockResolvedValue({ cards: own.nodes.slice(0, 6).map((node) => ({ nodeId: node.id, title: `All about ${node.title}`, body })) });

    const page = await getFeedPage(owner);
    expect(page.fromSamples).toBe(false);
    expect(page.items.every((item) => item.mapId === own.id || item.mapId === map.id)).toBe(true);
    expect(page.items.some((item) => item.mapId === own.id)).toBe(true);
    expect(mockChatJSON).toHaveBeenCalledTimes(1);

    await getFeedPage(owner);
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
  });
});

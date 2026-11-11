import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishCourse } from "@/features/courses";
import { copySkillMap } from "@/features/skill-map";
import { getDoc, putDoc } from "@/shared/store";
import type { SkillMap, SkillNode } from "@/shared/types";
import { topicKey } from "./key";
import { EMPTY_RETRY_DAYS, FRESH_DAYS, getSkillReels, MAX_SHOWN, SEARCH_VERSION, voteOnReel } from "./reels";
import type { SavedReels } from "./types";
import { deleteReelVotes } from "./votes";
import { keywords, MAX_SAVED, parseDuration, reelQuery, relevance, searchReels } from "./youtube";

const DAY = 86_400_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A search result and its details: portrait 58 s unless told otherwise. */
type Fake = { id: string; title: string; description?: string; seconds?: number; width?: number; height?: number };
const id = (n: number) => `vid${String(n).padStart(8, "0")}`;

function mockYouTube(results: Fake[], { searchStatus = 200 } = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/youtube/v3/search")) {
        if (searchStatus !== 200) return json({ error: { message: "quotaExceeded" } }, searchStatus);
        return json({
          items: results.map((r) => ({ id: { videoId: r.id }, snippet: { title: r.title, description: r.description ?? "", channelTitle: "Teacher" } })),
        });
      }
      if (url.includes("/youtube/v3/videos")) {
        const asked = new URL(url).searchParams.get("id")!.split(",");
        return json({
          items: results
            .filter((r) => asked.includes(r.id))
            .map((r) => ({
              id: r.id,
              contentDetails: { duration: `PT${r.seconds ?? 58}S` },
              player: { embedWidth: r.width ?? 360, embedHeight: r.height ?? 640 },
            })),
        });
      }
      throw new Error("unexpected " + url);
    }),
  );
  return {
    calls,
    searches: () => calls.filter((url) => url.includes("/search")).length,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("topicKey", () => {
  const map = { title: "Data analyst", audience: undefined };
  const node = { id: "sql-joins", title: "SQL joins" };

  it("is the same for a course and a learner's copy, whatever the map id or owner", () => {
    expect(topicKey({ ...map }, node)).toBe(topicKey({ title: "  data   ANALYST ", audience: "" }, { ...node }));
  });

  it("differs when the map, the skill or the audience differs", () => {
    const base = topicKey(map, node);
    expect(topicKey({ ...map, title: "Biology" }, node)).not.toBe(base);
    expect(topicKey(map, { ...node, title: "SQL window functions" })).not.toBe(base);
    expect(topicKey({ ...map, audience: "Grade 1 students (about 6 years old)" }, node)).not.toBe(base);
  });
});

describe("the search words and filters", () => {
  it("adds the map title, 'for kids' for a child, and leans toward teaching Shorts", () => {
    expect(reelQuery("SQL joins", "Data analyst", undefined)).toBe("SQL joins Data analyst explained #shorts");
    expect(reelQuery("SQL basics", "SQL", "")).toBe("SQL basics explained #shorts");
    expect(reelQuery("Counting to 100", "Grade 1 math", "Grade 1 students (about 6 years old)")).toBe("Counting to 100 Grade 1 math for kids explained #shorts");
  });

  it("reads YouTube's durations", () => {
    expect(parseDuration("PT58S")).toBe(58);
    expect(parseDuration("PT1M5S")).toBe(65);
    expect(parseDuration("PT1H")).toBe(3600);
    expect(parseDuration("P0D")).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
  });

  it("scores skill words above map words, matches word forms, and ignores filler", () => {
    expect(keywords("How to use the SQL JOIN, explained!")).toEqual(["sql", "join"]);
    expect(relevance("SQL joins in 60 seconds", "SQL joins", "Data analyst")).toBe(4);
    expect(relevance("Joining tables for a data analyst", "SQL joins", "Data analyst")).toBe(4);
    expect(relevance("Funny cat compilation", "SQL joins", "Data analyst")).toBe(0);
  });

  it("drops a video that only shares the map's words, or names the skill only in a hashtag", () => {
    expect(relevance("A day in the life of an analyst", "SQL joins", "Data analyst")).toBe(0);
    expect(relevance("Junior vs Senior Backend developer #programming #java", "Programming basics", "Junior Backend Developer")).toBe(0);
    expect(relevance("Programming basics in 60 seconds #shorts", "Programming basics", "")).toBe(2);
  });

  it("lets the map's words decide when the skill title is only filler", () => {
    expect(relevance("Fractions for kids", "The basics", "Fractions")).toBe(1);
  });
});

describe("searchReels", () => {
  it("keeps short portrait teaching videos about the skill, most relevant first", async () => {
    const yt = mockYouTube([
      { id: id(1), title: "A day in the life of a data analyst" },
      { id: id(2), title: "SQL joins explained in 60 seconds" },
      { id: id(3), title: "SQL joins, the long version", seconds: 600 },
      { id: id(4), title: "SQL joins on a wide screen", width: 640, height: 360 },
      { id: id(5), title: "SQL joins prank gone wrong" },
      { id: id(6), title: "Cooking pasta" },
      { id: "bad", title: "SQL joins" },
      { id: id(7), title: "Left join vs inner join", description: "SQL in a minute" },
      { id: id(8), title: "SQL joins again" },
      { id: id(9), title: "SQL joins one more" },
      { id: id(10), title: "SQL joins &amp; keys" },
    ]);
    const reels = await searchReels("SQL joins", "Data analyst", undefined, "key");

    expect(reels.map((reel) => reel.videoId)).toEqual([id(2), id(7), id(8), id(9), id(10)]);
    expect(reels[0]).toEqual({ videoId: id(2), title: "SQL joins explained in 60 seconds", channel: "Teacher", seconds: 58 });
    const search = new URL(yt.calls[0]).searchParams;
    expect(search.get("safeSearch")).toBe("strict");
    expect(search.get("videoEmbeddable")).toBe("true");
    expect(search.get("videoDuration")).toBe("short");
    // One search and one details call, which skips the ones already dropped.
    expect(yt.calls).toHaveLength(2);
    expect(new URL(yt.calls[1]).searchParams.get("id")!.split(",")).not.toContain(id(6));
  });

  it("spends no details call when nothing in the search is about the skill", async () => {
    const yt = mockYouTube([{ id: id(1), title: "Cooking pasta" }]);
    expect(await searchReels("SQL joins", "Data analyst", undefined, "key")).toEqual([]);
    expect(yt.calls).toHaveLength(1);
  });

  it("throws when YouTube fails, so nothing is saved", async () => {
    mockYouTube([], { searchStatus: 403 });
    await expect(searchReels("SQL joins", "Data analyst", undefined, "key")).rejects.toThrow(/403/);
  });

  it("keeps at most 8, and leaves out videos voted off the skill", async () => {
    mockYouTube(Array.from({ length: 12 }, (_, n) => ({ id: id(n + 1), title: `SQL joins clip ${n + 1}` })));
    const reels = await searchReels("SQL joins", "", undefined, "key", new Set([id(1), id(2)]));
    expect(reels).toHaveLength(MAX_SAVED);
    expect(reels[0].videoId).toBe(id(3));
  });
});

const OWNER = randomUUID();
const STRANGER = randomUUID();
const node = (nodeId: string, title: string, prerequisites: string[] = []): SkillNode => ({
  id: nodeId,
  title,
  why: "Reports need it.",
  prerequisites,
  fromSource: true,
  citation: null,
  checkpoints: ["One.", "Two.", "Three."],
});

let map: SkillMap;

beforeEach(async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  map = {
    id: randomUUID(),
    ownerId: OWNER,
    // A unique title, so each test has its own shared list.
    title: `Data analyst ${randomUUID().slice(0, 8)}`,
    subtitle: "",
    sourceKind: "posting",
    sourceText: "Write SQL joins.",
    nodes: [node("sql-joins", "SQL joins"), node("window-functions", "Window functions", ["sql-joins"])],
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${map.id}`, map);
});

describe("getSkillReels", () => {
  const ONE = [{ id: id(1), title: "SQL joins in 60 seconds" }];

  it("searches once, then serves the saved list to the course and every learner's copy", async () => {
    const yt = mockYouTube(ONE);
    const first = await getSkillReels(map.id, "sql-joins", OWNER, { apiKey: "key" });
    expect(first.map((reel) => reel.videoId)).toEqual([id(1)]);

    await publishCourse(map.id, OWNER, "Ada");
    const copy = await copySkillMap(map.id, STRANGER);
    expect(await getSkillReels(copy.id, "sql-joins", STRANGER, { apiKey: "key" })).toEqual(first);
    expect(await getSkillReels(map.id, "sql-joins", STRANGER, { apiKey: "key" })).toEqual(first);
    expect(yt.searches()).toBe(1);

    const saved = await getDoc<SavedReels>(`skill-reels/${topicKey(map, map.nodes[0])}`);
    // A job posting's title is a role, so only the skill is searched.
    expect(saved?.query).toBe("SQL joins explained #shorts");
  });

  it("searches with the map title for a topic map", async () => {
    await putDoc(`maps/${map.id}`, { ...map, sourceKind: "topic" });
    const yt = mockYouTube(ONE);
    await getSkillReels(map.id, "sql-joins", OWNER, { apiKey: "key" });
    expect(new URL(yt.calls[0]).searchParams.get("q")).toBe(`SQL joins ${map.title} explained #shorts`);
  });

  it("searches the skill alone too when the map title leaves too few videos, but only then", async () => {
    await putDoc(`maps/${map.id}`, { ...map, sourceKind: "topic" });
    const queries: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/search")) {
          const q = url.searchParams.get("q")!;
          queries.push(q);
          // With the map title: one off-topic lecture. Alone: two real Shorts.
          const items = q.includes(map.title)
            ? [{ id: { videoId: id(1) }, snippet: { title: "Bitmask DP full lecture", description: "", channelTitle: "Uni" } }]
            : [id(2), id(3)].map((videoId) => ({ id: { videoId }, snippet: { title: "SQL joins in 60 seconds", description: "", channelTitle: "Teacher" } }));
          return json({ items });
        }
        const asked = url.searchParams.get("id")!.split(",");
        return json({ items: asked.map((videoId) => ({ id: videoId, contentDetails: { duration: "PT40S" }, player: { embedWidth: 360, embedHeight: 640 } })) });
      }),
    );
    const reels = await getSkillReels(map.id, "sql-joins", OWNER, { apiKey: "key" });
    expect(reels.map((reel) => reel.videoId)).toEqual([id(2), id(3)]);
    expect(queries).toEqual([`SQL joins ${map.title} explained #shorts`, "SQL joins explained #shorts"]);
    expect((await getDoc<SavedReels>(`skill-reels/${topicKey(map, map.nodes[0])}`))?.query).toContain(" | SQL joins explained #shorts");

    // A search that finds enough the first time pays for no second one.
    const other = { ...map, id: randomUUID(), title: `Another ${randomUUID().slice(0, 8)}`, sourceKind: "topic" as const };
    await putDoc(`maps/${other.id}`, other);
    const yt = mockYouTube([{ id: id(4), title: "SQL joins quickly" }, { id: id(5), title: "SQL joins again" }]);
    await getSkillReels(other.id, "sql-joins", OWNER, { apiKey: "key" });
    expect(yt.searches()).toBe(1);
  });

  it("looks again at a list saved by an older search, however new it is", async () => {
    const key = `skill-reels/${topicKey(map, map.nodes[0])}`;
    const old = { videoId: id(9), title: "Junior vs senior", channel: "Meme", seconds: 13 };
    await putDoc(key, { reels: [old], query: "q", searchedAt: new Date().toISOString() } satisfies SavedReels);
    const yt = mockYouTube(ONE);
    const reels = await getSkillReels(map.id, "sql-joins", OWNER, { apiKey: "key" });
    expect(reels.map((reel) => reel.videoId)).toEqual([id(1)]);
    expect(yt.searches()).toBe(1);
    expect((await getDoc<SavedReels>(key))?.version).toBe(SEARCH_VERSION);
  });

  it("hides a private map from strangers and refuses a locked skill, before any search", async () => {
    const yt = mockYouTube(ONE);
    await expect(getSkillReels(map.id, "sql-joins", STRANGER, { apiKey: "key" })).rejects.toMatchObject({ status: 404 });
    await expect(getSkillReels(map.id, "nope", OWNER, { apiKey: "key" })).rejects.toMatchObject({ status: 404 });
    await expect(getSkillReels(map.id, "window-functions", OWNER, { apiKey: "key" })).rejects.toMatchObject({ status: 403 });
    expect(yt.calls).toHaveLength(0);
  });

  it("searches nothing without an API key", async () => {
    const yt = mockYouTube(ONE);
    expect(await getSkillReels(map.id, "sql-joins", OWNER, { apiKey: "" })).toEqual([]);
    expect(yt.calls).toHaveLength(0);
  });

  it("saves nothing when YouTube fails, and tries at most once an hour", async () => {
    // Early in an hour, so now and now + 1 minute share the hourly claim (it failed in the last minute of each hour).
    const now = Math.floor(Date.now() / 3_600_000) * 3_600_000 + 60_000;
    const failing = mockYouTube(ONE, { searchStatus: 403 });
    expect(await getSkillReels(map.id, "sql-joins", OWNER, { apiKey: "key", now })).toEqual([]);
    expect(await getSkillReels(map.id, "sql-joins", OWNER, { apiKey: "key", now: now + 60_000 })).toEqual([]);
    expect(failing.searches()).toBe(1);
    expect(await getDoc(`skill-reels/${topicKey(map, map.nodes[0])}`)).toBeNull();

    const working = mockYouTube(ONE);
    const later = await getSkillReels(map.id, "sql-joins", OWNER, { apiKey: "key", now: now + 2 * 3_600_000 });
    expect(later).toHaveLength(1);
    expect(working.searches()).toBe(1);
  });

  it("looks a full list up again after 30 days and an empty one after 3, keeping the old list if that fails", async () => {
    const key = `skill-reels/${topicKey(map, map.nodes[0])}`;
    const now = Date.now();
    const reel = { videoId: id(1), title: "SQL joins in 60 seconds", channel: "Teacher", seconds: 58 };
    await putDoc(key, { reels: [reel], query: "q", searchedAt: new Date(now - (FRESH_DAYS - 1) * DAY).toISOString(), version: SEARCH_VERSION } satisfies SavedReels);
    const yt = mockYouTube([], { searchStatus: 500 });
    expect(await getSkillReels(map.id, "sql-joins", OWNER, { apiKey: "key", now })).toEqual([{ ...reel, likes: 0, myVote: 0 }]);
    expect(yt.calls).toHaveLength(0);

    // Stale: a failed refresh still serves the old list.
    expect(await getSkillReels(map.id, "sql-joins", OWNER, { apiKey: "key", now: now + 2 * DAY })).toEqual([{ ...reel, likes: 0, myVote: 0 }]);
    expect(yt.searches()).toBe(1);

    await putDoc(key, { reels: [], query: "q", searchedAt: new Date(now - (EMPTY_RETRY_DAYS + 1) * DAY).toISOString(), version: SEARCH_VERSION } satisfies SavedReels);
    mockYouTube(ONE);
    expect(await getSkillReels(map.id, "sql-joins", OWNER, { apiKey: "key", now: now + 5 * DAY })).toHaveLength(1);
  });
});

describe("likes and dislikes", () => {
  const SIX = Array.from({ length: 6 }, (_, n) => ({ id: id(n + 1), title: `SQL joins clip ${n + 1}` }));
  const shown = async (viewer: string) => (await getSkillReels(map.id, "sql-joins", viewer, { apiKey: "key" })).map((reel) => reel.videoId);
  let VOTERS: string[];

  beforeEach(async () => {
    VOTERS = [randomUUID(), randomUUID(), randomUUID()];
    mockYouTube(SIX);
    await publishCourse(map.id, OWNER, "Ada");
  });

  it("shows 4 of the saved videos, each with its likes and your own vote", async () => {
    expect(await shown(OWNER)).toEqual([id(1), id(2), id(3), id(4)]);
    expect(MAX_SHOWN).toBe(4);
    expect(await voteOnReel(map.id, "sql-joins", id(1), VOTERS[0], 1)).toEqual({ likes: 1, myVote: 1, removed: false });
    const [first] = await getSkillReels(map.id, "sql-joins", VOTERS[0], { apiKey: "key" });
    expect(first).toMatchObject({ videoId: id(1), likes: 1, myVote: 1 });
    const [forOwner] = await getSkillReels(map.id, "sql-joins", OWNER, { apiKey: "key" });
    expect(forOwner).toMatchObject({ likes: 1, myVote: 0 });
  });

  it("hides a video from the person who disliked it, and gives it back when they take that back", async () => {
    await shown(OWNER);
    expect(await voteOnReel(map.id, "sql-joins", id(2), VOTERS[0], -1)).toEqual({ likes: 0, myVote: -1, removed: false });
    expect(await shown(VOTERS[0])).toEqual([id(1), id(3), id(4), id(5)]);
    // One dislike removes it for nobody else.
    expect(await shown(OWNER)).toEqual([id(1), id(2), id(3), id(4)]);

    await voteOnReel(map.id, "sql-joins", id(2), VOTERS[0], 0);
    expect(await shown(VOTERS[0])).toEqual([id(1), id(2), id(3), id(4)]);
  });

  it("removes a video for everyone at 2 dislikes outnumbering the likes, and the next saved one takes its place", async () => {
    await shown(OWNER);
    await voteOnReel(map.id, "sql-joins", id(1), VOTERS[0], 1);
    await voteOnReel(map.id, "sql-joins", id(1), VOTERS[1], -1);
    expect((await voteOnReel(map.id, "sql-joins", id(1), VOTERS[2], -1)).removed).toBe(true);
    expect(await shown(OWNER)).toEqual([id(2), id(3), id(4), id(5)]);
  });

  it("keeps a video whose likes keep up with its dislikes", async () => {
    await shown(OWNER);
    await voteOnReel(map.id, "sql-joins", id(1), VOTERS[0], 1);
    await voteOnReel(map.id, "sql-joins", id(1), VOTERS[1], 1);
    await voteOnReel(map.id, "sql-joins", id(1), VOTERS[2], -1);
    expect((await voteOnReel(map.id, "sql-joins", id(1), OWNER, -1)).removed).toBe(false);
    expect(await shown(STRANGER)).toContain(id(1));
  });

  it("changing a vote replaces it rather than adding to it", async () => {
    await shown(OWNER);
    await voteOnReel(map.id, "sql-joins", id(1), VOTERS[0], 1);
    await voteOnReel(map.id, "sql-joins", id(1), VOTERS[0], 1);
    expect(await voteOnReel(map.id, "sql-joins", id(1), VOTERS[0], -1)).toEqual({ likes: 0, myVote: -1, removed: false });
  });

  it("refuses a video that is not on the skill, and a private map", async () => {
    await shown(OWNER);
    await expect(voteOnReel(map.id, "sql-joins", id(99), VOTERS[0], 1)).rejects.toMatchObject({ status: 404 });
    const privateMap = { ...map, id: randomUUID() };
    await putDoc(`maps/${privateMap.id}`, privateMap);
    await expect(voteOnReel(privateMap.id, "sql-joins", id(1), STRANGER, -1)).rejects.toMatchObject({ status: 404 });
  });

  it("searches again when votes leave fewer than 2, skipping the removed videos", async () => {
    const yt = mockYouTube(SIX.slice(0, 2));
    await shown(OWNER);
    for (const video of [id(1), id(2)]) {
      await voteOnReel(map.id, "sql-joins", video, VOTERS[0], -1);
      await voteOnReel(map.id, "sql-joins", video, VOTERS[1], -1);
    }
    const again = mockYouTube(SIX);
    const later = await getSkillReels(map.id, "sql-joins", OWNER, { apiKey: "key", now: Date.now() + 2 * 3_600_000 });
    expect(later.map((reel) => reel.videoId)).toEqual([id(3), id(4), id(5), id(6)]);
    expect(yt.searches() + again.searches()).toBe(2);
  });

  it("forgets someone's votes when they delete their data, and nobody else's", async () => {
    await shown(OWNER);
    await voteOnReel(map.id, "sql-joins", id(1), VOTERS[0], -1);
    await voteOnReel(map.id, "sql-joins", id(1), VOTERS[1], -1);
    expect(await deleteReelVotes(VOTERS[0])).toBe(1);
    expect(await shown(OWNER)).toContain(id(1));
    expect(await shown(VOTERS[1])).not.toContain(id(1));
  });
});

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { getDoc, listKeys } from "@/shared/store";
import { recordView } from "./events";
import { getFeedPage } from "./feed";
import { checkInterest, getInterests, saveInterests } from "./interests";
import {
  EMPTY_STATS,
  engagement,
  exploreBoost,
  interestWeight,
  interleave,
  isRetiredShort,
  itemScore,
  rotatePool,
  type ItemStats,
  type ViewerMarks,
} from "./rank";
import { deleteFeedData, setReaction } from "./reactions";
import { looksEducational } from "./shorts";
import { interestNameProblem, slugify, SUGGESTED_INTERESTS } from "./suggestions";
import { cardProblem, slugOfItem, toPoolCards } from "./validate";

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

const stats = (partial: Partial<ItemStats>): ItemStats => ({ ...EMPTY_STATS, ...partial });
const marks = (partial: Partial<ViewerMarks> = {}): ViewerMarks => ({ seen: false, liked: false, saved: false, long: false, skipped: false, ...partial });

describe("interest checks", () => {
  it("slugs names and has 24 distinct suggestions", () => {
    expect(slugify("  Habits and Motivation! ")).toBe("habits-and-motivation");
    expect(slugify("Café culture")).toBe("cafe-culture");
    expect(new Set(SUGGESTED_INTERESTS.map((interest) => interest.slug)).size).toBe(24);
  });

  it("rejects short, long, link, symbol-only and blocked input", () => {
    expect(interestNameProblem("Volcanoes")).toBeNull();
    expect(interestNameProblem("C++ templates")).toBeNull();
    expect(interestNameProblem("a")).toMatch(/2 letters/);
    expect(interestNameProblem("x".repeat(61))).toMatch(/60/);
    expect(interestNameProblem("https://evil.com")).toMatch(/link/);
    expect(interestNameProblem("1234")).toMatch(/words/);
    expect(interestNameProblem("<script>")).toMatch(/letters/);
    expect(interestNameProblem("porn")).toMatch(/isn't one/);
  });

  it("asks the model once for a typed interest and keeps the verdict", async () => {
    mockChatJSON.mockResolvedValueOnce({ ok: true, name: "Volcanoes" });
    expect(await checkInterest("volcanoes")).toEqual({ slug: "volcanoes", name: "Volcanoes" });
    expect(await checkInterest("Volcanoes")).toEqual({ slug: "volcanoes", name: "Volcanoes" });
    expect(mockChatJSON).toHaveBeenCalledTimes(1);

    mockChatJSON.mockResolvedValueOnce({ ok: false, name: "" });
    await expect(checkInterest("asdf qwer")).rejects.toThrow(/doesn't look like a topic/);
    // A suggestion needs no model call.
    expect(await checkInterest("game theory")).toEqual({ slug: "game-theory", name: "Game theory" });
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
  });

  it("saves only known interests, at least 3", async () => {
    const user = randomUUID();
    await expect(saveInterests(user, ["game-theory", "made-up-thing", "stoicism"])).rejects.toThrow(/at least 3/);
    const saved = await saveInterests(user, ["game-theory", "stoicism", "black-holes"]);
    expect(saved.map((interest) => interest.slug)).toEqual(["game-theory", "stoicism", "black-holes"]);
    expect(await getInterests(user)).toEqual(saved);
  });
});

describe("cards", () => {
  const body = "Two prisoners who cannot talk both do better by staying silent. Each one alone does better by talking, so both usually talk.";
  it("checks length, links and duplicate titles", () => {
    expect(cardProblem({ title: "Why both prisoners talk", body, subtopic: "The prisoner's dilemma" })).toBeNull();
    expect(cardProblem({ title: "Talk", body, subtopic: "x" })).toMatch(/3 to 7 words/);
    expect(cardProblem({ title: "Why both prisoners talk", body: `${body} See www.x.com.`, subtopic: "Dilemmas" })).toMatch(/link/);
    const cards = toPoolCards(
      {
        cards: [
          { title: "Why both prisoners talk", body, subtopic: "The prisoner's dilemma" },
          { title: "Why Both Prisoners Talk!", body, subtopic: "The prisoner's dilemma" },
          { title: "An old idea returns", body, subtopic: "Repeated games" },
        ],
      },
      "game-theory",
      { usedTitles: ["An old idea returns"], startAt: 8 },
    );
    expect(cards.map((card) => card.id)).toEqual(["game-theory.c8"]);
  });

  it("reads the interest from an item id", () => {
    expect(slugOfItem("game-theory.c3")).toBe("game-theory");
    expect(slugOfItem("black-holes.vdQw4w9WgXcQ")).toBe("black-holes");
    expect(slugOfItem("../x.c1")).toBeNull();
    expect(slugOfItem("game-theory.c3/like")).toBeNull();
  });

  it("drops entertainment titles from Shorts", () => {
    expect(looksEducational("How black holes bend light")).toBe(true);
    expect(looksEducational("Funny moments prank")).toBe(false);
    expect(looksEducational("This chord progression is in every song", "Music theory")).toBe(true);
  });
});

describe("ranking", () => {
  it("scores engagement per view, with skips costing and long looks helping", () => {
    expect(engagement(stats({ views: 10, likes: 4 }))).toBeGreaterThan(engagement(stats({ views: 10, likes: 1 })));
    expect(engagement(stats({ views: 10, deeper: 1 }))).toBeGreaterThan(engagement(stats({ views: 10, likes: 1 })));
    expect(engagement(stats({ views: 10, exposures: 10, skips: 8 }))).toBeLessThan(engagement(stats({ views: 10, exposures: 10 })));
    expect(engagement(stats({ views: 10, long: 6 }))).toBeGreaterThan(engagement(stats({ views: 10 })));
    // One like on one view is not a hit yet.
    expect(engagement(stats({ views: 1, likes: 1 }))).toBeLessThan(engagement(stats({ views: 20, likes: 12 })));
  });

  it("boosts items few have seen, and drops what this viewer saw unless saved", () => {
    expect(exploreBoost(0, 100)).toBeGreaterThan(exploreBoost(50, 100));
    const s = stats({ views: 5, exposures: 5, likes: 2 });
    expect(itemScore(s, marks({ seen: true }), 50)).toBeLessThan(itemScore(stats({}), marks(), 50));
    expect(itemScore(s, marks({ seen: true, saved: true }), 50)).toBe(itemScore(s, marks(), 50));
  });

  it("gives liked interests more room, within limits", () => {
    expect(interestWeight([marks({ liked: true }), marks({ saved: true })])).toBeGreaterThan(interestWeight([]));
    expect(interestWeight(Array.from({ length: 20 }, () => marks({ liked: true, saved: true })))).toBe(2.5);
    expect(interestWeight(Array.from({ length: 20 }, () => marks({ skipped: true })))).toBe(0.6);
  });

  it("interleaves by weight, never more than 2 in a row while others have items", () => {
    const out = interleave([
      { key: "a", weight: 2.5, items: [1, 2, 3, 4, 5, 6, 7, 8] },
      { key: "b", weight: 1, items: [1, 2, 3, 4] },
      { key: "c", weight: 1, items: [1, 2, 3, 4] },
    ]).map((entry) => entry.key);
    const firstNine = out.slice(0, 9);
    expect(firstNine.filter((key) => key === "a").length).toBeGreaterThan(firstNine.filter((key) => key === "b").length);
    for (let i = 2; i < 9; i++) expect(firstNine[i] === firstNine[i - 1] && firstNine[i] === firstNine[i - 2]).toBe(false);
    expect(out).toHaveLength(16);
  });

  it("retires Shorts that are mostly skipped and never liked", () => {
    expect(isRetiredShort(stats({ views: 10, exposures: 12, skips: 10 }))).toBe(true);
    expect(isRetiredShort(stats({ views: 10, exposures: 12, skips: 10, likes: 1 }))).toBe(false);
    expect(isRetiredShort(stats({ views: 5, exposures: 6, skips: 6 }))).toBe(false);
  });

  it("rotates out the weakest judged items, never saved or barely seen ones", () => {
    const items = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
    const s = new Map<string, ItemStats>([
      ["a", stats({ views: 20, exposures: 20, likes: 8 })],
      ["b", stats({ views: 20, exposures: 20, likes: 0 })],
      ["c", stats({ views: 20, exposures: 20, likes: 0, saves: 1 })],
      ["d", stats({ views: 3, exposures: 3 })],
      ["e", stats({ views: 20, exposures: 20, skips: 18 })],
    ]);
    const { keep, removed } = rotatePool(items, s, 3);
    expect(removed.map((item) => item.id).sort()).toEqual(["b", "e"]);
    expect(keep.map((item) => item.id)).toEqual(["a", "c", "d"]);
    // Under the cap only duds go; with no judged items nothing goes.
    expect(rotatePool(items, s, 10).removed.map((item) => item.id)).toEqual(["e"]);
    expect(rotatePool(items, new Map(), 1).removed).toEqual([]);
  });
});

describe("feed page", () => {
  it("asks for interests first, then mixes them and follows likes", async () => {
    const viewer = randomUUID();
    expect((await getFeedPage(viewer)).needsInterests).toBe(true);
    await saveInterests(viewer, ["game-theory", "stoicism", "black-holes"]);

    const first = await getFeedPage(viewer, { schedule: () => {} });
    const cards = first.items.filter((item) => item.kind === "card");
    expect(cards.length).toBe(9);
    expect(new Set(cards.map((card) => card.interest.slug)).size).toBe(3);
    expect(mockChatJSON).not.toHaveBeenCalled();

    // Another viewer likes and dwells on a stoic card nobody else has seen first.
    const other = randomUUID();
    expect(cards.some((card) => card.id === "stoicism.c7")).toBe(false);
    const target = { id: "stoicism.c7" };
    for (const fan of [other, randomUUID(), randomUUID()]) {
      await recordView(fan, target.id, 9_000);
      await setReaction(fan, "like", target.id, true);
    }
    const after = await getFeedPage(viewer, { schedule: () => {} });
    const stoicIds = after.items.filter((item) => item.interest.slug === "stoicism").map((item) => item.id);
    expect(stoicIds[0]).toBe(target.id);

    // Seen items drop, and ?exclude= leaves out what is already on screen.
    const next = await getFeedPage(viewer, { exclude: after.items.map((item) => item.id), schedule: () => {} });
    expect(next.items.some((item) => after.items.some((old) => old.id === item.id))).toBe(false);
  });

  it("deletes interests, reactions and events", async () => {
    const viewer = randomUUID();
    await saveInterests(viewer, ["game-theory", "stoicism", "black-holes"]);
    await setReaction(viewer, "save", "game-theory.c0", true);
    await recordView(viewer, "game-theory.c1", 2_000);
    const saved = await getFeedPage(viewer, { savedOnly: true });
    expect(saved.items.map((item) => item.id)).toEqual(["game-theory.c0"]);
    await deleteFeedData(viewer);
    expect(await getDoc(`feed-interests/${viewer}`)).toBeNull();
    expect((await listKeys("feed-")).filter((key) => key.includes(viewer))).toEqual([]);
  });
});

import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { listKeys } from "@/shared/store";
import { commentProblem } from "./commentRules";
import { deleteComment, guestName, listComments, postComment } from "./comments";
import { demoLikeSeed } from "./demo";
import { getFeedPage } from "./feed";
import { inFormat, parseFormat } from "./format";
import { saveInterests } from "./interests";
import { deleteFeedData, setReaction } from "./reactions";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
const mockChatJSON = vi.mocked(chatJSON);

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("YOUTUBE_API_KEY", "");
  mockChatJSON.mockReset();
  mockChatJSON.mockResolvedValue({ ok: true, problem: "none" });
});

const INTERESTS = ["game-theory", "stoicism", "black-holes"];

describe("demo like seed", () => {
  it("is stable and between 3 and 20", () => {
    const ids = Array.from({ length: 500 }, (_, n) => `topic-${n}.c${n % 40}`);
    for (const id of ids) {
      const seed = demoLikeSeed(id);
      expect(seed).toBe(demoLikeSeed(id));
      expect(seed).toBeGreaterThanOrEqual(3);
      expect(seed).toBeLessThanOrEqual(20);
    }
    expect(new Set(ids.map(demoLikeSeed)).size).toBe(18);
  });

  it("is added to the shown count only, and a real like adds one", async () => {
    const viewer = randomUUID();
    await saveInterests(viewer, INTERESTS);
    const before = (await getFeedPage(viewer, { schedule: () => {} })).items[0];
    expect(before.likes).toBe(demoLikeSeed(before.id));
    await setReaction(viewer, "like", before.id, true);
    const after = (await getFeedPage(viewer, { schedule: () => {} })).items.find((item) => item.id === before.id);
    expect(after?.likes).toBe(demoLikeSeed(before.id) + 1);
    expect(after?.liked).toBe(true);
  });
});

describe("format", () => {
  it("parses ?format= and filters kinds", () => {
    expect(parseFormat("videos")).toBe("videos");
    expect(parseFormat("nonsense")).toBe("both");
    expect(parseFormat(null)).toBe("both");
    expect(inFormat("short", "text")).toBe(false);
    expect(inFormat("card", "videos")).toBe(false);
    expect(inFormat("card", "both") && inFormat("short", "both")).toBe(true);
  });

  it("returns only Shorts for videos, only cards for text, and pages each", async () => {
    const viewer = randomUUID();
    await saveInterests(viewer, INTERESTS);
    const both = await getFeedPage(viewer, { schedule: () => {} });
    expect(new Set(both.items.map((item) => item.kind))).toEqual(new Set(["card", "short"]));

    const text = await getFeedPage(viewer, { format: "text", schedule: () => {} });
    expect(text.items.length).toBe(9);
    expect(text.items.every((item) => item.kind === "card")).toBe(true);

    const videos = await getFeedPage(viewer, { format: "videos", schedule: () => {} });
    expect(videos.items.length).toBe(6);
    expect(videos.items.every((item) => item.kind === "short")).toBe(true);
    expect(new Set(videos.items.map((item) => item.interest.slug)).size).toBe(3);
    expect(videos.more).toBe(true);
    const next = await getFeedPage(viewer, { format: "videos", exclude: videos.items.map((item) => item.id), schedule: () => {} });
    expect(next.items.length).toBeGreaterThan(0);
    expect(next.items.some((item) => videos.items.some((old) => old.id === item.id))).toBe(false);
    expect(mockChatJSON).not.toHaveBeenCalled();
  });

  it("shows saved Shorts in Saved, filtered by format", async () => {
    const viewer = randomUUID();
    await saveInterests(viewer, INTERESTS);
    const short = (await getFeedPage(viewer, { format: "videos", schedule: () => {} })).items[0];
    await setReaction(viewer, "save", short.id, true);
    await setReaction(viewer, "save", "stoicism.c0", true);
    expect((await getFeedPage(viewer, { savedOnly: true })).items.map((item) => item.id).sort()).toEqual([short.id, "stoicism.c0"].sort());
    expect((await getFeedPage(viewer, { savedOnly: true, format: "videos" })).items.map((item) => item.id)).toEqual([short.id]);
  });
});

describe("comment rules", () => {
  it("refuses empty, long, links, contact details and abuse", () => {
    expect(commentProblem("   ")).toMatch(/Write something/);
    expect(commentProblem("a".repeat(281))).toMatch(/280/);
    expect(commentProblem("see https://x.y")).toMatch(/links/);
    expect(commentProblem("visit example.com now")).toMatch(/links/);
    expect(commentProblem("mail me at kid@school.ca")).toMatch(/email/);
    expect(commentProblem("call 403 555 1234")).toMatch(/phone/);
    expect(commentProblem("add me on snapchat")).toMatch(/contact/);
    expect(commentProblem("you are a f u c k i n g idiot")).toBeNull(); // spaced out: left to the AI check
    expect(commentProblem("this is shit")).toMatch(/kind/);
    expect(commentProblem("!!!")).toMatch(/words/);
  });

  it("lets ordinary comments through, years and numbers included", () => {
    expect(commentProblem("  Wow,   I never knew  that!  ")).toBeNull();
    expect(commentProblem("The war ran 1914-1918, right?")).toBeNull();
    expect(commentProblem("Is 3.14 close enough for pi?")).toBeNull();
  });
});

describe("comments", () => {
  it("posts, lists newest first, hides ids, deletes only your own", async () => {
    const alice = randomUUID();
    const bob = randomUUID();
    const first = await postComment(alice, null, "stoicism.c0", "Love this idea", 1_700_000_000_000);
    await postComment(bob, "Bob Builder", "stoicism.c0", "Same here, thanks", 1_700_000_001_000);
    expect(first.name).toBe(guestName(alice));
    expect(first.name).toMatch(/^Guest [0-9A-F]{4}$/);

    const listed = await listComments("stoicism.c0", alice);
    expect(listed.map((comment) => comment.name)).toEqual(["Bob Builder", guestName(alice)]);
    expect(listed.map((comment) => comment.mine)).toEqual([false, true]);
    expect(JSON.stringify(listed)).not.toContain(alice);

    await expect(deleteComment(bob, "stoicism.c0", first.id)).rejects.toThrow(/could not find/);
    await deleteComment(alice, "stoicism.c0", first.id);
    expect((await listComments("stoicism.c0", alice)).length).toBe(1);
  });

  it("refuses what the AI flags, posts when the AI fails, and limits 5 a minute", async () => {
    const viewer = randomUUID();
    mockChatJSON.mockResolvedValueOnce({ ok: false, problem: "abusive" });
    await expect(postComment(viewer, null, "game-theory.c1", "you are dumb")).rejects.toThrow(/unkind/);
    mockChatJSON.mockRejectedValueOnce(new Error("timeout"));
    await expect(postComment(viewer, null, "game-theory.c1", "Nice one")).resolves.toMatchObject({ text: "Nice one" });
    await expect(postComment(viewer, null, "game-theory.c999", "Nice one")).rejects.toThrow(/could not find/);
    const now = Date.parse("2026-11-08T12:00:10Z");
    for (let n = 0; n < 5; n++) await postComment(viewer, null, "game-theory.c2", `Comment number ${n}`, now + n);
    await expect(postComment(viewer, null, "game-theory.c2", "One more", now + 10)).rejects.toThrow(/Wait a minute/);
  });

  it("counts real comments on items and goes with Delete my data", async () => {
    const viewer = randomUUID();
    await saveInterests(viewer, INTERESTS);
    const item = (await getFeedPage(viewer, { schedule: () => {} })).items[0];
    await postComment(viewer, null, item.id, "Great card");
    const again = (await getFeedPage(viewer, { schedule: () => {} })).items.find((entry) => entry.id === item.id);
    expect(again?.comments).toBe(item.comments + 1);
    await deleteFeedData(viewer);
    expect((await listComments(item.id, viewer)).some((comment) => comment.mine)).toBe(false);
    expect((await listKeys("feed-")).filter((key) => key.includes(viewer))).toEqual([]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { planResources } from "./query";
import { gatherResources } from "./resources";

afterEach(() => vi.unstubAllGlobals());

describe("planResources", () => {
  it("adds the map title, and 'for kids' with no news or podcasts for a young audience", () => {
    const plan = planResources("Counting to 100", "Grade 1 math", "Grade 1 students (about 6 years old)");
    expect(plan.query).toBe("Counting to 100 Grade 1 math for kids");
    expect(plan.adultSources).toBe(false);
  });
  it("keeps adult queries plain and skips a map title the skill already holds", () => {
    expect(planResources("SQL joins", "Data analyst", undefined)).toMatchObject({ query: "SQL joins Data analyst", adultSources: true });
    expect(planResources("SQL basics", "SQL", "").query).toBe("SQL basics");
  });
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ENV = { YOUTUBE_API_KEY: "k", GNEWS_API_KEY: "k", TADDY_API_KEY: "k", TADDY_USER_ID: "u" };

function mockFetch(handlers: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      const match = Object.keys(handlers).find((host) => url.includes(host));
      if (!match) throw new Error("unexpected " + url);
      return handlers[match]();
    }),
  );
  return calls;
}

describe("gatherResources", () => {
  it("drops a failing source only, filters bad entries, and uses strict safe search", async () => {
    const calls = mockFetch({
      "googleapis.com/youtube": () =>
        json({ items: [{ id: { videoId: "abcdefghijk" }, snippet: { title: "Joins", channelTitle: "Ch" } }, { id: {}, snippet: { title: "x" } }] }),
      "wikipedia.org": () => json({ type: "disambiguation", title: "Join", extract: "x", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Join" } } }),
      "googleapis.com/books": () =>
        json({ items: [{ id: "b1", volumeInfo: { title: "Book", infoLink: "javascript:alert(1)" } }, { id: "b2", volumeInfo: { title: "Good", infoLink: "http://books.google.com/b2" } }] }),
      "gnews.io": () => json({}, 500),
      "taddy.org": () => json({ data: { searchForTerm: { podcastEpisodes: [{ uuid: "p", name: "Ep", audioUrl: "https://a.example/e.mp3" }] } } }),
    });
    const { items, failed } = await gatherResources("SQL joins", "Data analyst", undefined, ENV);
    expect(items.map((item) => item.id)).toEqual(["yt-abcdefghijk", "book-b2", "pod-p"]);
    expect(items[1].url).toBe("https://books.google.com/b2");
    expect(failed).toBe(true);
    expect(calls.find((url) => url.includes("youtube"))).toContain("safeSearch=strict");
  });

  it("asks no news or podcast source for a child", async () => {
    const calls = mockFetch({
      "googleapis.com/youtube": () => json({ items: [] }),
      "wikipedia.org": () => json({}, 404),
      "googleapis.com/books": () => json({}),
    });
    const { items, failed } = await gatherResources("Counting to 100", "Grade 1 math", "Grade 1 students (about 6 years old)", ENV);
    expect(items).toEqual([]);
    expect(failed).toBe(false);
    expect(calls.some((url) => url.includes("gnews") || url.includes("taddy"))).toBe(false);
  });
});

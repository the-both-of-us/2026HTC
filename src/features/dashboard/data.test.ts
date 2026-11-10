import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getReviewSummary, listReviewActivity } from "@/features/review";
import { listProvedNodes } from "@/features/teachback";
import { saveSkillMap } from "@/features/skill-map";
import { putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { assembleDashboard, loadDashboard, type MapFacts } from "./data";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));
vi.mock("@/features/teachback", () => ({ listProvedNodes: vi.fn() }));
vi.mock("@/features/review", () => ({ getReviewSummary: vi.fn(), listReviewActivity: vi.fn() }));

const ME = randomUUID();
const NOW = new Date("2026-11-07T12:00:00.000Z");
const SUMMARY = { dueCount: 2, newCount: 3, moreNew: 0, totalCards: 9, nextDueAt: null };

function map(overrides: Partial<SkillMap> = {}): SkillMap {
  const node = (id: string) => ({ id, title: `Skill ${id}`, why: "", prerequisites: [], fromSource: true, citation: null, checkpoints: [] });
  return {
    id: randomUUID(),
    ownerId: ME,
    title: "Payroll clerk",
    subtitle: "Calgary",
    sourceKind: "posting",
    sourceText: "secret source",
    nodes: [node("a"), node("b"), node("c")],
    createdAt: "2026-11-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("assembleDashboard", () => {
  it("counts proven skills, labels public maps and copies, and finds the last activity", () => {
    const own = map({ title: "Own" });
    const copy = map({ title: "Copy", forkedFrom: randomUUID(), createdAt: "2026-11-02T12:00:00.000Z" });
    const facts: MapFacts[] = [
      {
        map: own,
        isPublic: true,
        proved: [
          { nodeId: "a", provenAt: "2026-11-03T12:00:00.000Z" },
          { nodeId: "b", provenAt: "2026-11-06T12:00:00.000Z" },
          // A skill no longer on the map does not count.
          { nodeId: "gone", provenAt: "2026-11-07T11:00:00.000Z" },
        ],
      },
      { map: copy, isPublic: false, proved: [] },
    ];
    const data = assembleDashboard(facts, SUMMARY, [], NOW);

    expect(data.courses).toEqual([
      {
        mapId: own.id,
        title: "Own",
        subtitle: "Calgary",
        provenCount: 2,
        totalSkills: 3,
        isPublic: true,
        isCopy: false,
        startedFrom: null,
        canDelete: true,
        lastActivityAt: "2026-11-06T12:00:00.000Z",
      },
      {
        mapId: copy.id,
        title: "Copy",
        subtitle: "Calgary",
        provenCount: 0,
        totalSkills: 3,
        isPublic: false,
        isCopy: true,
        startedFrom: copy.forkedFrom,
        canDelete: true,
        lastActivityAt: "2026-11-02T12:00:00.000Z",
      },
    ]);
    expect(data.provenTotal).toBe(2);
    expect(data.recentProven.map((item) => [item.skillTitle, item.mapTitle])).toEqual([
      ["Skill b", "Own"],
      ["Skill a", "Own"],
    ]);
    expect(data.review).toBe(SUMMARY);
    expect(JSON.stringify(data)).not.toContain(ME);
    expect(JSON.stringify(data)).not.toContain("secret source");
  });

  describe("a course held more than once", () => {
    const original = () => map({ title: "Calculus" });
    const copyOf = (source: SkillMap, overrides: Partial<SkillMap> = {}) => map({ title: source.title, forkedFrom: source.id, ...overrides });
    const facts = (entries: [SkillMap, MapFacts["proved"]?][]): MapFacts[] =>
      entries.map(([item, proved]) => ({ map: item, proved: proved ?? [], isPublic: !item.forkedFrom }));
    const ids = (data: ReturnType<typeof assembleDashboard>) => data.courses.map((course) => course.mapId);

    it("shows only your copy, not the public original", () => {
      const source = original();
      const copy = copyOf(source);
      expect(ids(assembleDashboard(facts([[source], [copy]]), null, [], NOW))).toEqual([copy.id]);
    });

    it("matches a copy that came through someone else's map", () => {
      const source = original();
      const copy = copyOf(source, { forkedFrom: randomUUID() });
      expect(ids(assembleDashboard(facts([[source], [copy]]), null, [], NOW))).toEqual([copy.id]);
    });

    it("keeps the copy with more proven when there are two", () => {
      const source = original();
      const idle = copyOf(source, { createdAt: "2026-11-05T12:00:00.000Z" });
      const used = copyOf(source);
      const data = assembleDashboard(facts([[idle], [used, [{ nodeId: "a", provenAt: "2026-11-02T12:00:00.000Z" }]]]), null, [], NOW);
      expect(ids(data)).toEqual([used.id]);
    });

    it("still counts proofs on the hidden original, and leaves it out of courses to start", () => {
      const source = original();
      const copy = copyOf(source);
      const data = assembleDashboard(
        facts([[source, [{ nodeId: "a", provenAt: "2026-11-02T12:00:00.000Z" }]], [copy, [{ nodeId: "b", provenAt: "2026-11-03T12:00:00.000Z" }]]]),
        null,
        [],
        NOW,
      );
      expect(data.provenTotal).toBe(2);
      expect(data.provenCourseCount).toBe(1);
      expect(data.recentProven.map((item) => item.mapId)).toEqual([copy.id, source.id]);
      expect(data.startedIds).toEqual(expect.arrayContaining([source.id, copy.id]));
    });

    it("keeps two maps you built yourself, even with the same title and skills", () => {
      const first = original();
      const second = original();
      expect(ids(assembleDashboard(facts([[first], [second]]), null, [], NOW))).toEqual([first.id, second.id]);
    });

    it("keeps a copy of a different course that shares only the title", () => {
      const source = original();
      const other = copyOf(source, { nodes: [{ ...source.nodes[0], id: "x", title: "Something else" }] });
      expect(ids(assembleDashboard(facts([[source], [other]]), null, [], NOW))).toEqual([source.id, other.id]);
    });
  });

  it("keeps the 8 most recent proofs and sends only the last 60 days of activity, oldest first", () => {
    const big = map({ nodes: Array.from({ length: 10 }, (_, i) => ({ ...map().nodes[0], id: `n${i}`, title: `S${i}` })) });
    const proved = big.nodes.map((node, i) => ({ nodeId: node.id, provenAt: `2026-11-0${(i % 7) + 1}T0${i}:00:00.000Z` }));
    const data = assembleDashboard([{ map: big, isPublic: false, proved }], null, ["2026-11-07T10:00:00.000Z", "2026-08-01T00:00:00.000Z"], NOW);
    expect(data.provenTotal).toBe(10);
    expect(data.recentProven).toHaveLength(8);
    expect(data.recentProven[0].provenAt >= data.recentProven[7].provenAt).toBe(true);
    expect(data.activity).not.toContain("2026-08-01T00:00:00.000Z");
    expect(data.activity).toContain("2026-11-07T10:00:00.000Z");
    expect(data.activity).toEqual([...data.activity].sort());
    expect(data.review).toBeNull();
  });
});

describe("loadDashboard", () => {
  beforeEach(() => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("S3_BUCKET", "");
    (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
    vi.mocked(listProvedNodes).mockReset().mockResolvedValue([]);
    vi.mocked(getReviewSummary).mockReset().mockResolvedValue(SUMMARY);
    vi.mocked(listReviewActivity).mockReset().mockResolvedValue([]);
  });

  it("lists only the viewer's maps, newest first, with publish state", async () => {
    const older = map({ title: "Older" });
    const newer = map({ title: "Newer", createdAt: "2026-11-05T12:00:00.000Z" });
    const theirs = map({ title: "Theirs", ownerId: randomUUID() });
    for (const m of [older, newer, theirs]) await saveSkillMap(m);
    await putDoc(`courses/${older.id}`, { mapId: older.id });
    vi.mocked(listProvedNodes).mockImplementation(async (mapId) =>
      mapId === newer.id ? [{ nodeId: "a", provenAt: "2026-11-06T12:00:00.000Z" }] : [],
    );

    const data = await loadDashboard(ME, NOW);
    expect(data.courses.map((c) => [c.title, c.isPublic, c.provenCount])).toEqual([
      ["Newer", false, 1],
      ["Older", true, 0],
    ]);
    expect(data.activity).toEqual(["2026-11-06T12:00:00.000Z"]);
    expect(vi.mocked(listReviewActivity).mock.calls[0][1]).toEqual(new Date("2026-09-08T12:00:00.000Z"));
  });

  it("still shows the maps when review cannot be read", async () => {
    await saveSkillMap({ ...map(), title: "Mine" });
    vi.mocked(getReviewSummary).mockRejectedValue(new Error("store down"));
    vi.mocked(listReviewActivity).mockRejectedValue(new Error("store down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const data = await loadDashboard(ME, NOW);
    expect(data.review).toBeNull();
    expect(data.courses).toHaveLength(1);
    spy.mockRestore();
  });

  it("is empty for a brand-new guest", async () => {
    expect(await loadDashboard(randomUUID(), NOW)).toMatchObject({ courses: [], provenTotal: 0, recentProven: [], activity: [] });
  });
});

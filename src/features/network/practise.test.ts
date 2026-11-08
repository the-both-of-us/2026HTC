import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findCoursesHref, findPractiseLink } from "./practise";
import { node, prove, resetNetwork, saveMap } from "./testing";

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
  resetNetwork();
});

describe("findPractiseLink", () => {
  it("opens the matching skill on your own map, even when the wording differs a little", async () => {
    const me = randomUUID();
    const map = await saveMap(me, [node("sql", "SQL basics"), node("joins", "SQL joins and unions", ["sql"])]);

    expect(await findPractiseLink(me, "SQL joins")).toBe(`/map/${map.id}?skill=joins`);
  });

  it("prefers a skill you can start now, then one you have not proved", async () => {
    const me = randomUUID();
    const proved = await saveMap(me, [node("joins", "SQL joins")], "Older map");
    await prove(proved.id, me, "joins");
    const locked = await saveMap(me, [node("base", "Basics"), node("joins", "SQL joins", ["base"])], "Locked map");
    const open = await saveMap(me, [node("joins", "SQL joins")], "Open map");

    expect(await findPractiseLink(me, "SQL joins")).toBe(`/map/${open.id}?skill=joins`);
    expect(locked.id).not.toBe(open.id);
  });

  it("never looks at anyone else's maps", async () => {
    await saveMap(randomUUID(), [node("joins", "SQL joins")]);
    expect(await findPractiseLink(randomUUID(), "SQL joins")).toBeNull();
  });

  it("refuses an empty or absurdly long title", async () => {
    const me = randomUUID();
    await saveMap(me, [node("joins", "SQL joins")]);
    expect(await findPractiseLink(me, "   ")).toBeNull();
    expect(await findPractiseLink(me, "x".repeat(500))).toBeNull();
  });
});

describe("findCoursesHref", () => {
  it("searches the courses for the skill, safely encoded", () => {
    expect(findCoursesHref(" SQL joins & unions ")).toBe("/courses?q=SQL%20joins%20%26%20unions");
  });
});

import { describe, expect, it } from "vitest";
import { contentIdOf } from "./canonical";

describe("contentIdOf", () => {
  it("keys a topic map's content by its catalog course", () => {
    expect(contentIdOf({ id: "map-1", courseId: "course-1" })).toBe("course-1");
  });

  it("keys a posting or PDF map's content by the map itself", () => {
    expect(contentIdOf({ id: "map-1" })).toBe("map-1");
  });
});

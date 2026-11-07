import { describe, expect, it } from "vitest";
import { cardsLabel, provenLabel, timeAgo, timeUntil } from "./format";

const now = new Date("2026-11-07T12:00:00.000Z");

describe("dashboard labels", () => {
  it("says how long ago", () => {
    expect(timeAgo("2026-11-07T11:59:50.000Z", now)).toBe("just now");
    expect(timeAgo("2026-11-07T11:55:00.000Z", now)).toBe("5 minutes ago");
    expect(timeAgo("2026-11-07T09:00:00.000Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-11-06T12:00:00.000Z", now)).toBe("1 day ago");
    expect(timeAgo("2026-09-07T12:00:00.000Z", now)).toBe("2 months ago");
    expect(timeAgo("bad", now)).toBe("some time ago");
  });

  it("says how long until", () => {
    expect(timeUntil("2026-11-07T12:10:00.000Z", now)).toBe("in 10 minutes");
    expect(timeUntil("2026-11-13T12:00:00.000Z", now)).toBe("in 6 days");
    expect(timeUntil("2026-11-07T11:00:00.000Z", now)).toBe("now");
  });

  it("counts skills and cards", () => {
    expect(provenLabel(2, 7)).toBe("2 of 7 skills proven");
    expect(provenLabel(0, 1)).toBe("0 of 1 skill proven");
    expect(cardsLabel(1)).toBe("1 card");
    expect(cardsLabel(3)).toBe("3 cards");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { QueueItem, ReviewQueue } from "../types";
import { Done, ReviewSession } from "./ReviewScreen";

const item: QueueItem = {
  cardId: "c1",
  mapId: "m",
  nodeId: "n",
  front: "What does a payroll register list?",
  back: "Every employee's pay for the period.",
  mapTitle: "Payroll clerk",
  skillTitle: "Payroll basics",
  isNew: true,
  intervals: { again: 0, hard: 1, good: 1, easy: 2 },
};
const queue: ReviewQueue = { queue: [item], dueCount: 0, newCount: 1, moreNew: 0, totalCards: 1, nextDueAt: null };
const noop = () => {};

function textOf(html: string, id: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`id="${escaped}"[^>]*>([\\s\\S]*?)</p>`));
  return match ? match[1].replace(/<[^>]+>/g, "").replace(/<!-- -->/g, "") : "";
}

describe("ReviewSession", () => {
  it("names the focusable card by its question, with the keys as its description", () => {
    const html = renderToStaticMarkup(<ReviewSession data={queue} onReload={noop} />);
    const card = html.match(/<div[^>]*aria-roledescription="flashcard"[^>]*>/)?.[0] ?? "";
    expect(card).not.toContain("aria-label=");

    const labelledBy = card.match(/aria-labelledby="([^"]+)"/)?.[1] ?? "";
    const name = labelledBy
      .split(" ")
      .map((id) => textOf(html, id))
      .join(" ");
    expect(name).toContain("Payroll clerk");
    expect(name).toContain(item.front);

    const describedBy = card.match(/aria-describedby="([^"]+)"/)?.[1] ?? "";
    expect(textOf(html, describedBy)).toContain("Press Space to show the answer.");
  });
});

describe("Done", () => {
  const base = { reviewed: true, saving: false, moreNew: 0, nextDueAt: null, announcement: "", onReload: noop };

  it("holds the learner while the last answer is still saving", () => {
    const html = renderToStaticMarkup(<Done {...base} saving />);
    expect(html).toContain("Saving your last answer");
    expect(html).not.toContain('href="/dashboard"');
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*>[\s\S]*Check for more cards/);
  });

  it("offers both ways out once every answer is saved", () => {
    const html = renderToStaticMarkup(<Done {...base} />);
    expect(html).toContain("All caught up");
    expect(html).toContain('href="/dashboard"');
    expect(html).not.toContain('aria-disabled="true"');
  });

  it("says new cards past the cap are ready, instead of the next due time", () => {
    const html = renderToStaticMarkup(<Done {...base} moreNew={10} nextDueAt="2026-11-08T12:00:00.000Z" />);
    expect(html).toContain("10 more new cards are ready now");
    expect(html).not.toContain("All caught up");
    expect(html).not.toContain("Your next card is due");
  });
});

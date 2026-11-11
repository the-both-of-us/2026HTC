import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SharedCatalogView } from "./SharedCatalog";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const course = { courseId: "c1", title: "System design", summary: "Design scalable systems.", audience: "", units: 8, topics: 40 };
const program = { programId: "p1", title: "Backend", summary: "Servers.", audience: "", depth: "degree" as const, courseCount: 40 };

describe("SharedCatalogView", () => {
  it("shows nothing when both lists are empty", () => {
    expect(renderToStaticMarkup(<SharedCatalogView courses={[]} programs={[]} />)).toBe("");
  });

  it("labels courses as AI-written and shows counted facts and a Start button", () => {
    const html = renderToStaticMarkup(<SharedCatalogView courses={[course]} programs={[]} />);
    expect(html).toContain("Shared courses");
    expect(html).toContain("System design");
    expect(html).toContain("8 units · 40 topics planned");
    expect(html).toContain("AI-written");
    expect(html).toContain("Start System design");
    expect(html).not.toContain("Shared programs");
  });

  it("shows shared programs with their depth and course count", () => {
    const html = renderToStaticMarkup(<SharedCatalogView courses={[]} programs={[program]} />);
    expect(html).toContain("Shared programs");
    expect(html).toContain("Full degree · 40 courses");
    expect(html).not.toContain("Shared courses");
  });
});

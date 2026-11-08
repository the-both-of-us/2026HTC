import { describe, expect, it } from "vitest";
import { parseBlocks, plainText, unfence } from "./ui/LessonMarkdown";

describe("lesson Markdown", () => {
  it("keeps a plain paragraph as one paragraph", () => {
    expect(parseBlocks("A **join** links two tables.")).toEqual([{ kind: "p", text: "A **join** links two tables." }]);
  });

  it("groups list lines and tips", () => {
    expect(parseBlocks("Three steps:\n1. Read\n2. Write\n- one\n- two\n> Tip: go slow\n> really")).toEqual([
      { kind: "p", text: "Three steps:" },
      { kind: "ol", items: ["Read", "Write"] },
      { kind: "ul", items: ["one", "two"] },
      { kind: "tip", text: "go slow really" },
    ]);
  });

  it("reads aloud without marks", () => {
    expect(plainText("A **join** and *this* `x`.\n- a\n- b")).toBe("A join and this x. a. b");
  });

  it("drops a code fence", () => {
    expect(unfence("```sql\nSELECT 1;\n```")).toBe("SELECT 1;");
    expect(unfence("SELECT 1;")).toBe("SELECT 1;");
  });
});

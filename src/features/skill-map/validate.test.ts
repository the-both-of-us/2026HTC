import { quoteAppearsIn } from "@/shared/quote";
import { describe, expect, it } from "vitest";
import type { RawNode } from "./prompt";
import {
  breakCycles,
  buildCitation,
  capNodes,
  cleanCheckpoints,
  cleanText,
  dedupeNodes,
  dropBadPrerequisites,
  ensureRoot,
  PAGE_BREAK,
  quoteOnPdfPage,
  toSlug,
  validateNodes,
} from "./validate";

function node(id: string, overrides: Partial<RawNode> = {}): RawNode {
  return {
    id,
    title: `Title of ${id}`,
    why: "Because the job needs it.",
    prerequisites: [],
    fromSource: false,
    quote: null,
    checkpoints: ["Fact one.", "Fact two.", "Fact three."],
    ...overrides,
  };
}

function links(nodes: RawNode[]): Record<string, string[]> {
  return Object.fromEntries(nodes.map((n) => [n.id, n.prerequisites]));
}

describe("toSlug", () => {
  it("makes kebab-case", () => {
    expect(toSlug("Time-Series  Cleaning!")).toBe("time-series-cleaning");
  });
  it("strips accents and edge dashes", () => {
    expect(toSlug("  Sécurité (réseau) ")).toBe("securite-reseau");
  });
  it("returns empty when nothing is usable", () => {
    expect(toSlug("!!!")).toBe("");
  });
  it("limits the length without a trailing dash", () => {
    const slug = toSlug(`${"a".repeat(59)} bbb`);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("dedupeNodes", () => {
  it("slugs ids and prerequisites", () => {
    const result = dedupeNodes([node("SQL Basics"), node("Joins", { prerequisites: ["sql basics"] })]);
    expect(links(result)).toEqual({ "sql-basics": [], joins: ["sql-basics"] });
  });
  it("keeps the first of two nodes with the same id", () => {
    const result = dedupeNodes([node("a", { title: "First" }), node("A", { title: "Second" })]);
    expect(result.map((n) => n.title)).toEqual(["First"]);
  });
  it("treats the same title as a repeat and moves links to the kept node", () => {
    const result = dedupeNodes([
      node("sql-joins", { title: "SQL Joins" }),
      node("joining-tables", { title: "sql joins" }),
      node("reports", { prerequisites: ["joining-tables"] }),
    ]);
    expect(links(result)).toEqual({ "sql-joins": [], reports: ["sql-joins"] });
  });
  it("falls back to the title, then to the position, for an unusable id", () => {
    const result = dedupeNodes([node("!!!", { title: "Good Title" }), node("???", { title: "***" })]);
    expect(result.map((n) => n.id)).toEqual(["good-title", "skill-2"]);
  });
});

describe("cleanCheckpoints", () => {
  it("trims, removes repeats ignoring case, and keeps at most 4", () => {
    const [result] = cleanCheckpoints([
      node("a", { checkpoints: [" One. ", "one.", "Two.", "Three.", "Four.", "Five."] }),
    ]);
    expect(result.checkpoints).toEqual(["One.", "Two.", "Three.", "Four."]);
  });
  it("drops a node left with fewer than 3", () => {
    expect(cleanCheckpoints([node("a", { checkpoints: ["Same.", "same.", "Other."] })])).toEqual([]);
  });
});

describe("capNodes", () => {
  it("leaves a short list alone", () => {
    const nodes = [node("a"), node("b")];
    expect(capNodes(nodes, 2)).toBe(nodes);
  });
  it("keeps what the posting asks for ahead of foundations, in original order", () => {
    const nodes = [
      node("foundation-1"),
      node("foundation-2"),
      node("asked-1", { fromSource: true }),
      node("asked-2", { fromSource: true }),
    ];
    expect(capNodes(nodes, 3).map((n) => n.id)).toEqual(["foundation-1", "asked-1", "asked-2"]);
  });
});

describe("dropBadPrerequisites", () => {
  it("drops dangling links, self links and repeats", () => {
    const result = dropBadPrerequisites([
      node("a"),
      node("b", { prerequisites: ["a", "a", "b", "ghost"] }),
    ]);
    expect(links(result)).toEqual({ a: [], b: ["a"] });
  });
});

describe("breakCycles", () => {
  it("leaves a graph with no loops alone", () => {
    const nodes = [node("a"), node("b", { prerequisites: ["a"] }), node("c", { prerequisites: ["a", "b"] })];
    expect(links(breakCycles(nodes))).toEqual(links(nodes));
  });
  it("removes the link that closes a two-node loop", () => {
    const result = breakCycles([node("a", { prerequisites: ["b"] }), node("b", { prerequisites: ["a"] })]);
    expect(links(result)).toEqual({ a: ["b"], b: [] });
  });
  it("breaks a three-node loop and leaves a root", () => {
    const result = breakCycles([
      node("a", { prerequisites: ["c"] }),
      node("b", { prerequisites: ["a"] }),
      node("c", { prerequisites: ["b"] }),
    ]);
    expect(links(result)).toEqual({ a: ["c"], b: [], c: ["b"] });
  });
  it("gives the same answer every time", () => {
    const nodes = [node("a", { prerequisites: ["b", "c"] }), node("b", { prerequisites: ["c"] }), node("c", { prerequisites: ["a"] })];
    expect(links(breakCycles(nodes))).toEqual(links(breakCycles(nodes)));
  });
  it("keeps a diamond, which is not a loop", () => {
    const nodes = [
      node("top", { prerequisites: ["left", "right"] }),
      node("left", { prerequisites: ["base"] }),
      node("right", { prerequisites: ["base"] }),
      node("base"),
    ];
    expect(links(breakCycles(nodes))).toEqual(links(nodes));
  });
});

describe("ensureRoot", () => {
  it("frees the first node when every node has a prerequisite", () => {
    const result = ensureRoot([node("a", { prerequisites: ["b"] }), node("b", { prerequisites: ["a"] })]);
    expect(links(result)).toEqual({ a: [], b: ["a"] });
  });
  it("changes nothing when a root exists", () => {
    const nodes = [node("a"), node("b", { prerequisites: ["a"] })];
    expect(ensureRoot(nodes)).toBe(nodes);
  });
});

describe("quote checks", () => {
  const source = "What you bring\n- Strong   SQL, and working\nknowledge of Python";

  it("ignores case and whitespace differences, including line breaks", () => {
    expect(quoteAppearsIn("strong sql, and working knowledge", source)).toBe(true);
  });
  it("treats curly quotes and long dashes as their plain versions", () => {
    expect(quoteAppearsIn("the team's full-time role", "The team\u2019s full\u2013time role")).toBe(true);
  });
  it("rejects words that are not there", () => {
    expect(quoteAppearsIn("Strong SQL and working knowledge", source)).toBe(false);
  });
  it("rejects an empty quote, which every string technically contains", () => {
    expect(quoteAppearsIn("   ", source)).toBe(false);
  });

  it("keeps a found quote and marks it verified", () => {
    const citation = buildCitation(node("a", { fromSource: true, quote: "Strong SQL" }), source, "posting");
    expect(citation).toEqual({ kind: "posting", quote: "Strong SQL", verified: true });
  });
  it("blanks a quote that was not found", () => {
    const citation = buildCitation(node("a", { fromSource: true, quote: "Expert in Rust" }), source, "posting");
    expect(citation).toEqual({ kind: "posting", quote: "", verified: false });
  });
  it("marks a source node with no quote as unverified", () => {
    const citation = buildCitation(node("a", { fromSource: true, quote: null }), source, "posting");
    expect(citation).toEqual({ kind: "posting", quote: "", verified: false });
  });
  it("gives foundations no citation, even if the model wrote a quote", () => {
    expect(buildCitation(node("a", { quote: "Strong SQL" }), source, "posting")).toBeNull();
  });

  const pdf = ["Week 1. Tables and keys.", "Week 2. Strong SQL joins, including LEFT JOIN."].join(PAGE_BREAK);
  it("verifies a PDF quote on the page the model named, and keeps that page", () => {
    const citation = buildCitation(node("a", { fromSource: true, quote: "Strong SQL joins", page: 2 }), pdf, "pdf");
    expect(citation).toEqual({ kind: "pdf", quote: "Strong SQL joins", page: 2, verified: true });
  });
  it("verifies a PDF quote that the page broke across lines, even mid-word", () => {
    const page = "We use pandas to convert time zones to local tim\ne.";
    expect(quoteOnPdfPage("convert time zones to local time", page)).toBe(true);
    expect(quoteOnPdfPage("convert time zones to UTC", page)).toBe(false);
    // Too short to trust without its spaces.
    expect(quoteOnPdfPage("time", "a tim\ne")).toBe(false);
  });
  it("cites the page the quote is really on when the model named another one", () => {
    for (const page of [1, null, 0, 3]) {
      const citation = buildCitation(node("a", { fromSource: true, quote: "Strong SQL joins", page }), pdf, "pdf");
      expect(citation).toEqual({ kind: "pdf", quote: "Strong SQL joins", page: 2, verified: true });
    }
  });
  it("does not verify a PDF quote that is on no page", () => {
    const citation = buildCitation(node("a", { fromSource: true, quote: "Weak SQL joins", page: 2 }), pdf, "pdf");
    expect(citation).toEqual({ kind: "pdf", quote: "", verified: false });
  });
  it("gives a topic no citation and no node from the source, whatever the model said", () => {
    const [result] = validateNodes([node("a", { fromSource: true, quote: "Strong SQL" })], "SQL", "topic");
    expect(result.citation).toBeNull();
    expect(result.fromSource).toBe(false);
  });
});

describe("cleanText", () => {
  it("makes special hyphens and spaces plain", () => {
    expect(cleanText(" time\u2011series at 5\u202f% ")).toBe("time-series at 5 %");
  });
});

describe("validateNodes", () => {
  it("fixes a messy reply all at once", () => {
    const source = "Must have strong SQL skills and Python experience for this role.";
    const result = validateNodes(
      [
        node("Basics", { prerequisites: ["SQL"] }), // part of a loop
        node("SQL", { fromSource: true, quote: "STRONG SQL   skills", prerequisites: ["basics", "ghost", "sql"] }),
        node("sql", { title: "Repeat" }), // repeat id
        node("thin", { checkpoints: ["Only.", "Two."] }), // too few checkpoints
        node("python", { fromSource: true, quote: "ten years of Rust", prerequisites: ["thin", "SQL"] }),
      ],
      source,
      "posting",
    );

    expect(result.map((n) => n.id)).toEqual(["basics", "sql", "python"]);
    expect(result.find((n) => n.id === "basics")?.prerequisites).toEqual(["sql"]);
    expect(result.find((n) => n.id === "sql")?.prerequisites).toEqual([]);
    expect(result.find((n) => n.id === "python")?.prerequisites).toEqual(["sql"]);
    expect(result.find((n) => n.id === "sql")?.citation?.verified).toBe(true);
    expect(result.find((n) => n.id === "python")?.citation).toEqual({
      kind: "posting",
      quote: "",
      verified: false,
    });
  });
  it("caps the number of nodes", () => {
    const nodes = Array.from({ length: 20 }, (_, i) => node(`n${i}`));
    expect(validateNodes(nodes, "source", "posting")).toHaveLength(14);
  });
});

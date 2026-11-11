import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PRETEST_PROOF_LABEL } from "@/shared/types";
import type { ProofSnapshot } from "../types";
import { ProofDocument } from "./ProofDocument";

const snapshot = (knownByPretest: ProofSnapshot["knownByPretest"]): ProofSnapshot => ({
  version: 1,
  proofId: "p1",
  displayName: "Sam",
  roleTitle: "System design",
  roleSubtitle: "",
  sourceKind: "topic",
  totalSkills: 3,
  skills: [],
  ...(knownByPretest && { knownByPretest }),
  notYetProven: ["Caching"],
  publishedAt: "2026-11-11T12:00:00.000Z",
});

describe("pre-test passes on the evidence page", () => {
  const html = renderToStaticMarkup(
    <ProofDocument
      snapshot={snapshot([{ nodeId: "lat", title: "Latency", label: PRETEST_PROOF_LABEL, passedAt: "2026-11-10T09:00:00.000Z" }])}
      hash="abc"
      url="https://example.test/proof/p1"
    />,
  );

  it("lists them in their own labelled section, apart from the explanations", () => {
    expect(html).toContain("Known from a pre-test");
    expect(html).toContain("Latency");
    expect(html).toContain(PRETEST_PROOF_LABEL);
    expect(html).toContain("There is no");
    expect(html).toContain("not counted among the skills proven above");
  });

  it("shows no such section when there are none", () => {
    const plain = renderToStaticMarkup(<ProofDocument snapshot={snapshot(undefined)} hash="abc" url="https://example.test/proof/p1" />);
    expect(plain).not.toContain("Known from a pre-test");
  });
});

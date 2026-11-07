import { describe, expect, it } from "vitest";
import { SAMPLE_POSTINGS } from "@/shared/samplePostings";
import { isEnergyRelated } from "./energy";

describe("isEnergyRelated", () => {
  it("spots the sample grid analyst posting", () => {
    const posting = SAMPLE_POSTINGS.find((item) => item.id === "data-analyst-grid");
    expect(isEnergyRelated(posting?.text ?? "")).toBe(true);
  });

  it("spots energy words", () => {
    expect(isEnergyRelated("Wind turbine technician, southern Alberta")).toBe(true);
    expect(isEnergyRelated("SCADA engineer")).toBe(true);
  });

  it("ignores postings that only sound similar", () => {
    expect(isEnergyRelated("Lead generation specialist for a CSS grid library")).toBe(false);
    expect(isEnergyRelated("Junior backend developer, Node and Postgres")).toBe(false);
  });
});

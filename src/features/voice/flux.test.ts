import { describe, expect, it } from "vitest";
import { buildFluxUrl, buildKeyterms, COMMON_TERMS, extractKeyterms, FLUX_MODEL, parseFluxMessage } from "./flux";

describe("parseFluxMessage", () => {
  it("reads a TurnInfo", () => {
    const message = parseFluxMessage(
      JSON.stringify({ type: "TurnInfo", event: "EndOfTurn", turn_index: 3, transcript: "Hi.", sequence_id: 9, trigger: "manual" }),
    );
    expect(message).toEqual({ type: "TurnInfo", event: "EndOfTurn", turnIndex: 3, transcript: "Hi.", sequenceId: 9 });
  });

  it("reads Connected, Warning and Error", () => {
    expect(parseFluxMessage('{"type":"Connected","request_id":"x","sequence_id":0}').type).toBe("Connected");
    expect(parseFluxMessage('{"type":"Warning","code":"FORCE_END_TURN_NO_ACTIVE_TURN"}')).toEqual({
      type: "Warning",
      code: "FORCE_END_TURN_NO_ACTIVE_TURN",
    });
    expect(parseFluxMessage('{"type":"Error","code":"INTERNAL_SERVER_ERROR"}').type).toBe("Error");
  });

  it("ignores what it does not understand, because Flux may add new messages", () => {
    expect(parseFluxMessage("not json").type).toBe("Ignored");
    expect(parseFluxMessage('{"type":"Metadata"}').type).toBe("Ignored");
    expect(parseFluxMessage('{"type":"TurnInfo","event":"NewEvent","turn_index":1}').type).toBe("Ignored");
    expect(parseFluxMessage("null").type).toBe("Ignored");
  });
});

describe("buildFluxUrl", () => {
  it("repeats keyterm for each term, and asks for 16 kHz linear16 with our end-of-turn settings", () => {
    const url = new URL(buildFluxUrl("wss://api.deepgram.com", ["load flow", "SCADA"]));
    expect(url.pathname).toBe("/v2/listen");
    expect(url.searchParams.get("model")).toBe(FLUX_MODEL);
    expect(url.searchParams.getAll("keyterm")).toEqual(["load flow", "SCADA"]);
    expect(url.searchParams.get("encoding")).toBe("linear16");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
    expect(url.searchParams.get("eot_threshold")).toBe("0.7");
    expect(url.searchParams.get("eot_timeout_ms")).toBe("3000");
  });
});

describe("extractKeyterms", () => {
  it("starts with the skill title and picks technical words from the explanation", () => {
    const terms = extractKeyterms(
      "Power flow analysis",
      "The Newton-Raphson method solves the AC equations. Then SCADA data updates the reactive power values.",
    );
    expect(terms[0]).toBe("Power flow analysis");
    expect(terms).toContain("Newton-Raphson");
    expect(terms).toContain("SCADA");
  });

  it("leaves out common words", () => {
    const terms = extractKeyterms("Skill", "this because which would should there really basically");
    expect(terms).toEqual(["Skill"]);
  });

  it("does not pick small everyday words, however often they appear", () => {
    const terms = extractKeyterms("Skill", "and the and the for the insulation and the insulation");
    expect(terms).toEqual(["Skill", "insulation"]);
  });

  it("caps the number and length, and removes duplicates and control characters", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Term${i}`).join(" ");
    const terms = extractKeyterms("Title", `${"x".repeat(60)} TITLE ${many}`);
    expect(terms.length).toBeLessThanOrEqual(12);
    expect(terms.every((term) => term.length <= 40)).toBe(true);
    expect(terms.filter((term) => term.toLowerCase() === "title")).toHaveLength(1);
    expect(extractKeyterms("a\u0000 b\nc", "")).toEqual(["a b c"]);
  });
});

describe("buildKeyterms", () => {
  it("puts the skill and explanation first, then every topic on the map, then common terms, once each", () => {
    const terms = buildKeyterms("Power flow", "Newton-Raphson is fast.", ["Map title", "Power flow", "Load shedding", "SQL"]);
    expect(terms.slice(0, 2)).toEqual(["Power flow", "Newton-Raphson"]);
    expect(terms.slice(2, 5)).toEqual(["Map title", "Load shedding", "SQL"]);
    expect(terms).toContain("JavaScript");
    expect(terms.filter((term) => term.toLowerCase() === "sql")).toHaveLength(1);
    expect(terms.filter((term) => term.toLowerCase() === "power flow")).toHaveLength(1);
  });

  it("stays inside Deepgram's 500-token keyterm limit however big the map is", () => {
    const topics = Array.from({ length: 300 }, (_, i) => `Topic number ${i} with a long title`);
    const terms = buildKeyterms("Skill", "", topics);
    expect(terms.length).toBeLessThanOrEqual(100);
    const estimate = terms.reduce((sum, term) => sum + Math.ceil(term.length / 3) + 1, 0);
    expect(estimate).toBeLessThanOrEqual(450);
    expect(terms[0]).toBe("Skill");
  });

  it("keeps the common list short enough to leave room for the map", () => {
    expect(COMMON_TERMS.length).toBeLessThanOrEqual(50);
  });
});

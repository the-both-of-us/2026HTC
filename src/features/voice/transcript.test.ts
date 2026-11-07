import { describe, expect, it } from "vitest";
import {
  applyTurn,
  editTranscript,
  EMPTY_TRANSCRIPT,
  finalText,
  fullText,
  inputMethodOf,
  interimText,
  settle,
  startTake,
  type Transcript,
  type TurnUpdate,
} from "./transcript";

let sequence = 0;
function say(transcript: Transcript, event: TurnUpdate["event"], turnIndex: number, text: string): Transcript {
  sequence += 1;
  return applyTurn(transcript, { event, turnIndex, transcript: text, sequenceId: sequence });
}

describe("a turn", () => {
  it("replaces its interim text with the newest, because each message has the whole turn", () => {
    let t = say(EMPTY_TRANSCRIPT, "Update", 0, "A transformer");
    t = say(t, "Update", 0, "A transformer steps");
    expect(interimText(t)).toBe("A transformer steps");
    expect(finalText(t)).toBe("");
  });

  it("moves from muted to solid at EndOfTurn", () => {
    let t = say(EMPTY_TRANSCRIPT, "Update", 0, "A transformer steps");
    t = say(t, "EndOfTurn", 0, "A transformer steps voltage up.");
    expect(interimText(t)).toBe("");
    expect(finalText(t)).toBe("A transformer steps voltage up.");
  });

  it("ignores messages that arrive after its EndOfTurn", () => {
    let t = say(EMPTY_TRANSCRIPT, "EndOfTurn", 0, "Done.");
    t = say(t, "Update", 0, "Done and something else");
    expect(fullText(t)).toBe("Done.");
  });

  it("ignores messages that arrive out of order", () => {
    let t = applyTurn(EMPTY_TRANSCRIPT, { event: "Update", turnIndex: 0, transcript: "two words", sequenceId: 10 });
    t = applyTurn(t, { event: "Update", turnIndex: 0, transcript: "two", sequenceId: 9 });
    expect(fullText(t)).toBe("two words");
  });

  it("keeps the words it has when an EndOfTurn comes back empty", () => {
    let t = say(EMPTY_TRANSCRIPT, "Update", 0, "kept words");
    t = say(t, "EndOfTurn", 0, "");
    expect(finalText(t)).toBe("kept words");
  });

  it("does not create a turn from an empty message", () => {
    expect(say(EMPTY_TRANSCRIPT, "StartOfTurn", 0, "").turns).toHaveLength(0);
  });
});

describe("an answer split by pauses", () => {
  it("joins turns by turn_index, whatever order they arrive in", () => {
    let t = say(EMPTY_TRANSCRIPT, "EndOfTurn", 1, "Second part.");
    t = say(t, "EndOfTurn", 0, "First part.");
    t = say(t, "Update", 2, "third part");
    expect(fullText(t)).toBe("First part. Second part. third part");
    expect(finalText(t)).toBe("First part. Second part.");
    expect(interimText(t)).toBe("third part");
  });

  it("treats a new connection as a new take, so its turn 0 adds rather than overwrites", () => {
    let t = say(EMPTY_TRANSCRIPT, "EndOfTurn", 0, "First take.");
    t = startTake(t);
    t = say(t, "EndOfTurn", 0, "Second take.");
    expect(fullText(t)).toBe("First take. Second take.");
  });

  it("finalises interim text when a take starts", () => {
    let t = say(EMPTY_TRANSCRIPT, "Update", 0, "no end of turn");
    t = startTake(t);
    expect(finalText(t)).toBe("no end of turn");
  });
});

describe("settling at the end", () => {
  it("takes the latest Update as final, as Flux's CloseStream docs say to", () => {
    const t = settle(say(EMPTY_TRANSCRIPT, "Update", 0, "latest update"));
    expect(finalText(t)).toBe("latest update");
    expect(interimText(t)).toBe("");
  });

  it("returns the same object when nothing changes", () => {
    const t = say(EMPTY_TRANSCRIPT, "EndOfTurn", 0, "final");
    expect(settle(t)).toBe(t);
  });
});

describe("editing", () => {
  it("counts unedited speech as voice", () => {
    expect(inputMethodOf(say(EMPTY_TRANSCRIPT, "EndOfTurn", 0, "spoken"))).toBe("voice");
  });

  it("marks the answer as typed and uses exactly the edited text", () => {
    const t = editTranscript(say(EMPTY_TRANSCRIPT, "EndOfTurn", 0, "spoken wrod"), "spoken word");
    expect(inputMethodOf(t)).toBe("typed");
    expect(fullText(t)).toBe("spoken word");
  });

  it("stays typed, and adds new speech after the edit", () => {
    let t = editTranscript(EMPTY_TRANSCRIPT, "Edited start.");
    t = startTake(t);
    t = say(t, "EndOfTurn", 0, "More speech.");
    expect(fullText(t)).toBe("Edited start. More speech.");
    expect(inputMethodOf(t)).toBe("typed");
  });

  it("keeps the shown and submitted text identical", () => {
    let t = say(EMPTY_TRANSCRIPT, "EndOfTurn", 0, "  spaced   text  ");
    t = say(t, "EndOfTurn", 1, "next");
    expect(fullText(t)).toBe([finalText(t), interimText(t)].filter(Boolean).join(" "));
  });
});

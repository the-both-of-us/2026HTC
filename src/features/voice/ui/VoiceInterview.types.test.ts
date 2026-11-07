/** tsc checks this file: a parent that can return a verdict must also give a way out of it. */
import { describe, expect, it } from "vitest";
import type { VoiceVerdict } from "../machine";
import type { VoiceInterviewProps } from "./VoiceInterview";

const base = { attemptId: "a", question: "Q?", onTypeInstead: () => {} };
const verdict: VoiceVerdict = { passed: true, feedback: null };

describe("VoiceInterviewProps", () => {
  it("needs onContinue when a verdict can come back", () => {
    const fine: VoiceInterviewProps = { ...base, onAnswer: async () => verdict, onContinue: () => {} };
    const takesOver: VoiceInterviewProps = { ...base, onAnswer: async () => {} };

    // @ts-expect-error A verdict with no onContinue would be a dead end.
    const deadEnd: VoiceInterviewProps = { ...base, onAnswer: async () => verdict };
    // @ts-expect-error The same, for a parent that answers without a promise.
    const syncDeadEnd: VoiceInterviewProps = { ...base, onAnswer: () => verdict };

    expect([fine, takesOver, deadEnd, syncDeadEnd]).toHaveLength(4);
  });
});

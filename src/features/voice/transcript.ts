/**
 * Builds the learner's answer from Flux messages. Pure, so it can be tested in Node.
 *
 * Flux splits speech into turns, and a pause can end a turn in the middle of an answer.
 * Each message carries the whole text of its turn so far, so the newest message for a
 * turn replaces the older ones, and turns are joined in order.
 *
 * The grader checks exact quotes, so the text on screen must be exactly the text sent.
 * `fullText` is the single source of both.
 */

export type TurnUpdate = {
  event: "StartOfTurn" | "Update" | "EagerEndOfTurn" | "TurnResumed" | "EndOfTurn";
  turnIndex: number;
  transcript: string;
  sequenceId: number;
};

type Turn = { take: number; index: number; text: string; final: boolean; sequenceId: number };

export type Transcript = {
  /** Each new connection is a new take, because Flux restarts turn_index at 0. */
  take: number;
  /** Text from an edit. Speech after an edit is added after it. */
  base: string;
  turns: readonly Turn[];
  edited: boolean;
};

export const EMPTY_TRANSCRIPT: Transcript = { take: 0, base: "", turns: [], edited: false };

/** Call when a new connection starts, so its turn 0 does not overwrite the last one's. */
export function startTake(transcript: Transcript): Transcript {
  return { ...settle(transcript), take: transcript.take + 1 };
}

export function applyTurn(transcript: Transcript, update: TurnUpdate): Transcript {
  const text = update.transcript.trim();
  const isEnd = update.event === "EndOfTurn";
  const existing = transcript.turns.find((turn) => turn.take === transcript.take && turn.index === update.turnIndex);

  if (!existing) {
    if (!text) return transcript;
    const added: Turn = {
      take: transcript.take,
      index: update.turnIndex,
      text,
      final: isEnd,
      sequenceId: update.sequenceId,
    };
    return { ...transcript, turns: sortTurns([...transcript.turns, added]) };
  }

  if (existing.final || update.sequenceId < existing.sequenceId) return transcript;
  // An empty EndOfTurn must not wipe out words we already showed.
  const next: Turn = { ...existing, text: text || existing.text, final: isEnd, sequenceId: update.sequenceId };
  return { ...transcript, turns: transcript.turns.map((turn) => (turn === existing ? next : turn)) };
}

/**
 * Treats everything so far as final. Flux's CloseStream sends no EndOfTurn and tells
 * us to take the latest Update as the transcript, so this is what Done ends with.
 */
export function settle(transcript: Transcript): Transcript {
  if (transcript.turns.every((turn) => turn.final)) return transcript;
  return { ...transcript, turns: transcript.turns.map((turn) => ({ ...turn, final: true })) };
}

/** The learner changed the text by hand. From here on the answer counts as typed. */
export function editTranscript(transcript: Transcript, text: string): Transcript {
  return { ...transcript, base: text, turns: [], edited: true };
}

/** Finished words: shown solid. */
export function finalText(transcript: Transcript): string {
  return join([transcript.base, ...transcript.turns.filter((turn) => turn.final).map((turn) => turn.text)]);
}

/** Words Flux may still change: shown muted. */
export function interimText(transcript: Transcript): string {
  return join(transcript.turns.filter((turn) => !turn.final).map((turn) => turn.text));
}

/** The answer. What the learner sees in review is what the grader gets. */
export function fullText(transcript: Transcript): string {
  return join([transcript.base, ...transcript.turns.map((turn) => turn.text)]);
}

export function inputMethodOf(transcript: Transcript): "voice" | "typed" {
  return transcript.edited ? "typed" : "voice";
}

function join(parts: string[]): string {
  return parts.filter((part) => part.trim()).join(" ");
}

function sortTurns(turns: Turn[]): Turn[] {
  return turns.sort((a, b) => a.take - b.take || a.index - b.index);
}

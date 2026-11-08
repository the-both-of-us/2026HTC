/** Reading the model's chosen letter out of its reply, by code, the same way for every model. */

export const LETTERS = "ABCDEFGHIJ";

export type Question = {
  id: string;
  subject: string;
  question: string;
  options: string[];
  /** The correct letter. */
  answer: string;
};

/** The one prompt every model gets. */
export function buildPrompt(question: Question, subjectLabel: string): string {
  const options = question.options.map((option, i) => `${LETTERS[i]}. ${option}`).join("\n");
  return [
    `Answer this multiple-choice question about ${subjectLabel.toLowerCase()}.`,
    "",
    `Question: ${question.question.trim()}`,
    "",
    options,
    "",
    'Think briefly, then end your reply with a final line in the form "Answer: X", where X is the letter of the one best option.',
  ].join("\n");
}

/**
 * The letter after the last "Answer:" in the reply (markdown, brackets and "is" allowed), else a
 * \boxed{X}, else a last line that is only a letter. Null when the reply never commits, which
 * counts as wrong. Letters past the number of options are ignored.
 */
export function parseAnswerLetter(reply: string, optionCount: number): string | null {
  const allowed = LETTERS.slice(0, optionCount);
  const valid = (letter: string | undefined) => {
    const upper = letter?.toUpperCase();
    return upper && allowed.includes(upper) ? upper : null;
  };
  const text = reply.replace(/\r/g, "");

  const answerMatches = [
    ...text.matchAll(/answer\s*(?:is)?\s*[:：]\s*[*_`\s]*(?:option\s+)?[(\[]?\s*([A-J])(?![A-Za-z])/gi),
  ];
  for (let i = answerMatches.length - 1; i >= 0; i--) {
    const letter = valid(answerMatches[i][1]);
    if (letter) return letter;
  }

  const boxed = [...text.matchAll(/\\boxed\{\s*(?:\\text\{)?\s*([A-J])\s*\}?\s*\}/g)];
  for (let i = boxed.length - 1; i >= 0; i--) {
    const letter = valid(boxed[i][1]);
    if (letter) return letter;
  }

  const lastLine = text.trim().split("\n").at(-1) ?? "";
  const bare = lastLine.match(/^\s*[*_(\[]*\s*([A-J])\s*[)\].*_]*\s*$/);
  return valid(bare?.[1]);
}

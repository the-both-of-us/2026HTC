/**
 * Decides how much of the question has been spoken, so the words light up with the voice.
 *
 * The stream endpoint gives audio, not word timings, so this estimates: each word's
 * share of the time follows its length, and punctuation adds a beat. The total comes
 * from the audio's real duration as soon as the browser knows it.
 */

/** About how fast a calm, clear voice reads, including small gaps. */
const SECONDS_PER_CHARACTER = 0.068;
const COMMA_BEAT = 3;
const SENTENCE_BEAT = 6;

export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function wordWeight(word: string): number {
  const beat = /[.?!:]["')\]]?$/.test(word) ? SENTENCE_BEAT : /[,;]["')\]]?$/.test(word) ? COMMA_BEAT : 0;
  return word.length + 1 + beat;
}

/** A first guess at the length, used until the browser knows the real duration. */
export function estimateSeconds(words: readonly string[]): number {
  return words.reduce((sum, word) => sum + wordWeight(word), 0) * SECONDS_PER_CHARACTER;
}

/**
 * How many words have been spoken after this many seconds. With only an estimate of
 * the total it stops one word short, so the caption never finishes before the voice.
 */
export function spokenWordCount(words: readonly string[], seconds: number, realDuration: number | null): number {
  if (words.length === 0 || seconds <= 0) return 0;
  const usable = realDuration !== null && Number.isFinite(realDuration) && realDuration > 0;
  const total = usable ? realDuration : Math.max(estimateSeconds(words), 0.001);
  const fraction = seconds / total;
  if (usable && fraction >= 1) return words.length;

  const weights = words.map(wordWeight);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let reached = 0;
  let count = 0;
  for (const weight of weights) {
    reached += weight;
    if (reached / totalWeight > fraction) break;
    count += 1;
  }
  return usable ? count : Math.min(count, words.length - 1);
}

/**
 * Follows one playback. Words already lit stay lit: the real duration can arrive late and be
 * longer than the estimate, and the caption must never step backward when it does.
 */
export function captionFollower(words: readonly string[]): (seconds: number, realDuration: number | null) => number {
  let furthest = 0;
  return (seconds, realDuration) => {
    furthest = Math.max(furthest, spokenWordCount(words, seconds, realDuration));
    return furthest;
  };
}

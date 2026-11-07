/**
 * Checks that a quote the model gave us really appears in a source text. Used for
 * citations from a posting and for quotes from a learner's explanation.
 */

/**
 * Lower case, every run of whitespace turned into one space, and curly quotes and
 * long dashes made plain. Web pages and this model often use those, but the words
 * are the same.
 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** True if the quote appears in the source, ignoring the differences above. */
export function quoteAppearsIn(quote: string, source: string): boolean {
  const normalized = normalizeForMatch(quote);
  // Every string "includes" the empty string, so an empty quote must be ruled out.
  return normalized !== "" && normalizeForMatch(source).includes(normalized);
}

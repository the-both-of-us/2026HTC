/**
 * The Deepgram Flux protocol, as plain functions. Message names are from
 * https://developers.deepgram.com/reference/speech-to-text/listen-flux (checked 2026-11-07).
 */
import type { TurnUpdate } from "./transcript";

export const FLUX_MODEL = "flux-general-en";

export type FluxMessage =
  | { type: "Connected" }
  | ({ type: "TurnInfo" } & TurnUpdate)
  | { type: "Warning"; code: string }
  | { type: "Error"; code: string }
  | { type: "Ignored" };

const TURN_EVENTS = new Set<TurnUpdate["event"]>(["StartOfTurn", "Update", "EagerEndOfTurn", "TurnResumed", "EndOfTurn"]);

/** Flux's reply when ForceEndTurn arrives with no active turn. It is normal, not an error. */
export const NO_ACTIVE_TURN = "FORCE_END_TURN_NO_ACTIVE_TURN";

/** Reads one text frame. Unknown or malformed frames are ignored: Flux may add new ones. */
export function parseFluxMessage(raw: string): FluxMessage {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { type: "Ignored" };
  }
  switch (data?.type) {
    case "Connected":
      return { type: "Connected" };
    case "TurnInfo": {
      const event = data.event as TurnUpdate["event"];
      if (!TURN_EVENTS.has(event) || typeof data.turn_index !== "number") return { type: "Ignored" };
      return {
        type: "TurnInfo",
        event,
        turnIndex: data.turn_index,
        transcript: typeof data.transcript === "string" ? data.transcript : "",
        sequenceId: typeof data.sequence_id === "number" ? data.sequence_id : 0,
      };
    }
    case "Warning":
      return { type: "Warning", code: String(data.code ?? "") };
    case "Error":
      return { type: "Error", code: String(data.code ?? "") };
    default:
      return { type: "Ignored" };
  }
}

export const FORCE_END_TURN = JSON.stringify({ type: "ForceEndTurn" });
export const CLOSE_STREAM = JSON.stringify({ type: "CloseStream" });

/** The browser sends raw 16-bit PCM at this rate. See adapters/pcmWorklet.ts. */
export const FLUX_SAMPLE_RATE = 16_000;

/**
 * End-of-turn settings, measured on 2026-11-07 with real Flux (see README): 0.7 ends a
 * finished answer 0.7 to 1.4 s after the last word. No threshold up to 0.9 kept a 2 s pause
 * after a whole clause from ending the turn, so session.ts holds the mic open briefly after
 * EndOfTurn instead. The timeout caps how long a trailing-off answer waits.
 */
export const EOT_THRESHOLD = "0.7";
export const EOT_TIMEOUT_MS = "3000";

/**
 * The socket URL. Raw linear16 rather than WebM: it was as accurate in our test, ended
 * turns about 0.15 s sooner, and lets the socket stay open on silence while the question plays.
 */
export function buildFluxUrl(base: string, keyterms: readonly string[]): string {
  const url = new URL("/v2/listen", base);
  url.searchParams.set("model", FLUX_MODEL);
  url.searchParams.set("encoding", "linear16");
  url.searchParams.set("sample_rate", String(FLUX_SAMPLE_RATE));
  url.searchParams.set("eot_threshold", EOT_THRESHOLD);
  url.searchParams.set("eot_timeout_ms", EOT_TIMEOUT_MS);
  for (const term of keyterms) url.searchParams.append("keyterm", term);
  return url.toString();
}

/** Terms taken from the title and the learner's explanation. */
const MAX_EXPLANATION_TERMS = 12;
const MAX_TERM_LENGTH = 40;

/**
 * Deepgram's keyterm limit, which applies to Flux too: 500 tokens per request
 * (developers.deepgram.com/docs/keyterm). We count a token per 3 characters, which
 * overestimates, and stop at 450 so a long topic list can't make the socket refuse.
 */
const KEYTERM_TOKEN_BUDGET = 450;
const MAX_KEYTERMS = 100;
const estimateTokens = (term: string) => Math.ceil(term.length / 3) + 1;

/**
 * Words speech models often get wrong in a study explanation. They're public, so they
 * are safe in the URL, and they go last: the learner's own map comes first.
 */
export const COMMON_TERMS: readonly string[] = [
  "API", "SQL", "JSON", "HTTP", "HTML", "CSS", "JavaScript", "TypeScript", "Python", "React", "Next.js",
  "Node.js", "PostgreSQL", "GraphQL", "Docker", "Kubernetes", "AWS", "Git", "GitHub", "Linux",
  "algorithm", "recursion", "asynchronous", "latency", "cache", "regression", "variance", "derivative",
  "integral", "eigenvalue", "neural network", "gradient descent", "DNA", "RNA", "enzyme", "mitochondria",
  "photosynthesis", "molecule", "voltage", "kilowatt", "megawatt", "AESO",
];

const COMMON_WORDS = new Set(
  `and the for are but not its was has had his her our out how why who all any can too off per via yes than then
  about above after again against because been before being below between both could does doing down during each
  from further have having here into itself just like make makes more most much must only other over same should
  some such than that their them then there these they this those through under until very were what when where
  which while will with would your you'll it's that's there's also can may might one two three first second thing
  things way ways use used uses using get gets need needs want wants really basically actually going know think`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * The words Flux should listen for. They travel in a URL the browser can see, so they
 * come only from what the learner already has: the skill's title and their own explanation.
 * Never pass checkpoints here, because that would hand them the answer.
 */
export function extractKeyterms(title: string, explanation: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const term = clean(raw);
    const key = term.toLowerCase();
    if (term.length < 2 || term.length > MAX_TERM_LENGTH || seen.has(key)) return;
    seen.add(key);
    terms.push(term);
  };

  add(title);

  const words = explanation.match(/[\p{L}\p{N}][\p{L}\p{N}+#./-]*[\p{L}\p{N}+#]|[\p{L}\p{N}]/gu) ?? [];
  const counts = new Map<string, { word: string; count: number; score: number }>();
  words.forEach((word, position) => {
    const key = word.toLowerCase();
    if (COMMON_WORDS.has(key) || key.length < 3) return;
    // A capital anywhere but the start of a sentence, a digit or a hyphen usually marks a term.
    const looksTechnical = /\p{N}|[-+#./]|^\p{Lu}{2,}/u.test(word) || (position > 0 && /^\p{Lu}/u.test(word));
    const entry = counts.get(key) ?? { word, count: 0, score: 0 };
    entry.count += 1;
    entry.score = entry.count + (looksTechnical ? 3 : 0) + (key.length >= 9 ? 1 : 0);
    counts.set(key, entry);
  });

  [...counts.values()]
    .filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score)
    .forEach((entry) => add(entry.word));

  return terms.slice(0, MAX_EXPLANATION_TERMS);
}

/**
 * Every keyterm for one socket: the skill's title and the learner's explanation first, then
 * the other topic titles on the map, then COMMON_TERMS. Deduplicated and kept inside
 * Deepgram's limit. Topic titles are fine to send; checkpoints never are.
 */
export function buildKeyterms(title: string, explanation: string, topics: readonly string[] = []): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  let tokens = 0;
  for (const raw of [...extractKeyterms(title, explanation), ...topics, ...COMMON_TERMS]) {
    const term = clean(raw);
    const key = term.toLowerCase();
    if (term.length < 2 || term.length > MAX_TERM_LENGTH || seen.has(key)) continue;
    const cost = estimateTokens(term);
    if (terms.length >= MAX_KEYTERMS || tokens + cost > KEYTERM_TOKEN_BUDGET) break;
    seen.add(key);
    terms.push(term);
    tokens += cost;
  }
  return terms;
}

function clean(text: string): string {
  return text
    .replace(/[\p{C}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

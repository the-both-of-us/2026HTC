/**
 * What the two voice routes do. Every error is a sentence for people, and a key, token
 * or provider message never reaches the client or the log.
 */
import { getSkillMap } from "@/features/skill-map";
import { AttemptError, getOwnAttempt } from "@/features/teachback";
import type { Attempt } from "@/shared/types";
import { buildFluxUrl, extractKeyterms } from "../flux";
import { allowRate } from "./rateLimit";
import { providersFromEnv, speakWithFailover, type FetchLike, type TtsProvider } from "./tts";

const NOT_SET_UP = "Voice isn't available right now, so please type your answer.";
const TOO_MANY = "That's a lot of voice requests in a short time. Please type your answer, or try again in a few minutes.";
const NOT_ALLOWED = "This request has to come from the OryxLearn page.";
const NOTHING_TO_SAY = "There is nothing to read aloud for this attempt yet.";

const SPEAK_RULE = { limit: 12, windowMs: 10 * 60_000 };
const GRANT_RULE = { limit: 30, windowMs: 10 * 60_000 };
const GRANT_RULE_PER_ADDRESS = { limit: 90, windowMs: 10 * 60_000 };

/** Questions are a sentence or two. This stops a surprise long text from spending the credits. */
const MAX_SPOKEN_CHARACTERS = 1_200;

export type SayKind = "question" | "feedback";

/**
 * Picks the words for an attempt. There is no text parameter on the route on purpose:
 * the client can only ask for words the server already stored for this learner.
 * Feedback stays silent while a follow-up is open, so it can't be fished for early.
 */
export function chooseSpokenText(attempt: Attempt, requested: string | null): string | null {
  const followUp = attempt.followUp;
  if (!followUp) return null;
  const kind: SayKind =
    requested === "question" || requested === "feedback"
      ? requested
      : attempt.status === "needs-followup"
        ? "question"
        : "feedback";
  if (kind === "question") return followUp.question.trim() || null;
  if (attempt.status === "needs-followup") return null;
  return followUp.feedback?.trim() || null;
}

type SpeakDeps = {
  providers?: readonly TtsProvider[];
  loadAttempt?: (userId: string, attemptId: string) => Promise<Attempt>;
};

/** GET /api/voice/speak?attemptId=...&say=question|feedback */
export async function handleSpeak(request: Request, userId: string, deps: SpeakDeps = {}): Promise<Response> {
  const providers = deps.providers ?? providersFromEnv();
  const loadAttempt = deps.loadAttempt ?? getOwnAttempt;
  if (providers.length === 0) return sentence(NOT_SET_UP, 503);

  const params = new URL(request.url).searchParams;
  const attemptId = params.get("attemptId") ?? "";

  let attempt: Attempt;
  try {
    attempt = await loadAttempt(userId, attemptId);
  } catch (error) {
    return attemptFailure(error);
  }

  const text = chooseSpokenText(attempt, params.get("say"));
  if (!text) return sentence(NOTHING_TO_SAY, 404);
  if (text.length > MAX_SPOKEN_CHARACTERS) return sentence(NOT_SET_UP, 503);
  if (!allowRate(`speak:${userId}`, SPEAK_RULE)) return sentence(TOO_MANY, 429);

  const audio = await speakWithFailover(providers, text, request.signal);
  if (!audio) return sentence(NOT_SET_UP, 503);
  return new Response(audio.body, {
    headers: {
      "Content-Type": audio.contentType,
      // The words for a given URL never change, so a replay doesn't pay for them twice.
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type GrantDeps = {
  env?: NodeJS.ProcessEnv;
  fetchFn?: FetchLike;
  loadAttempt?: (userId: string, attemptId: string) => Promise<Attempt>;
  loadTitle?: (mapId: string, nodeId: string) => Promise<string | null>;
};

/**
 * POST /api/voice/stt-token with { attemptId } or, for dictation, { skillTitle }.
 * Mints a 30 second Deepgram token, and builds the socket URL here so the browser
 * never chooses the model or the keyterms.
 */
export async function handleSttToken(request: Request, userId: string, deps: GrantDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const apiKey = env.DEEPGRAM_API_KEY;
  if (!apiKey) return sentence(NOT_SET_UP, 503);
  if (!isSameOrigin(request)) return sentence(NOT_ALLOWED, 403);

  const address = clientAddress(request);
  if (!allowRate(`grant:${userId}`, GRANT_RULE) || !allowRate(`grant-ip:${address}`, GRANT_RULE_PER_ADDRESS)) {
    return sentence(TOO_MANY, 429);
  }

  const body = (await request.json().catch(() => null)) as { attemptId?: unknown; skillTitle?: unknown } | null;
  let keyterms: string[];
  try {
    keyterms = await keytermsFor(userId, body, deps);
  } catch (error) {
    return attemptFailure(error);
  }

  const httpBase = env.DEEPGRAM_API_BASE || "https://api.deepgram.com";
  const fetchFn = deps.fetchFn ?? fetch;
  try {
    const response = await fetchFn(`${httpBase}/v1/auth/grant`, {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 30 }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      console.error(`[voice] Deepgram grant returned ${response.status}`);
      return sentence(NOT_SET_UP, 503);
    }
    const grant = (await response.json()) as { access_token?: unknown };
    if (typeof grant.access_token !== "string") return sentence(NOT_SET_UP, 503);
    return Response.json(
      { token: grant.access_token, wsUrl: buildFluxUrl(httpBase.replace(/^http/, "ws"), keyterms) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(`[voice] Deepgram grant failed: ${error instanceof Error ? error.name : "unknown"}`);
    return sentence(NOT_SET_UP, 503);
  }
}

async function keytermsFor(
  userId: string,
  body: { attemptId?: unknown; skillTitle?: unknown } | null,
  deps: GrantDeps,
): Promise<string[]> {
  if (typeof body?.attemptId === "string") {
    const loadAttempt = deps.loadAttempt ?? getOwnAttempt;
    const attempt = await loadAttempt(userId, body.attemptId);
    const loadTitle = deps.loadTitle ?? skillTitleOf;
    return extractKeyterms((await loadTitle(attempt.mapId, attempt.nodeId)) ?? "", attempt.explanation);
  }
  return extractKeyterms(typeof body?.skillTitle === "string" ? body.skillTitle : "", "");
}

async function skillTitleOf(mapId: string, nodeId: string): Promise<string | null> {
  const map = await getSkillMap(mapId);
  return map?.nodes.find((node) => node.id === nodeId)?.title ?? null;
}

/**
 * The token route needs no login, so a page on another site must not be able to use it.
 * A script can fake this header, which is why the rate limits and short token life exist too.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function clientAddress(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown"
  );
}

function attemptFailure(error: unknown): Response {
  if (error instanceof AttemptError) return sentence(error.message, error.status);
  console.error(`[voice] could not load the attempt: ${error instanceof Error ? error.name : "unknown"}`);
  return sentence(NOT_SET_UP, 503);
}

function sentence(error: string, status: number): Response {
  return Response.json({ error }, { status });
}

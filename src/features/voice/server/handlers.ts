/**
 * What the two voice routes do. Every error is a sentence for people, and a key, token
 * or provider message never reaches the client or the log.
 */
import { getSkillMap } from "@/features/skill-map";
import { AttemptError, getOwnAttempt } from "@/features/teachback";
import type { Attempt, SkillMap } from "@/shared/types";
import { buildFluxUrl, extractKeyterms } from "../flux";
import { allowRate } from "./rateLimit";
import { sharedProviders, speakWithFailover, type FetchLike, type TtsProvider } from "./tts";

const NOT_SET_UP = "Voice isn't available right now, so please type your answer.";
const TOO_MANY = "That's a lot of voice requests in a short time. Please type your answer, or try again in a few minutes.";
const NOT_ALLOWED = "This request has to come from the OryxLearn page.";
const NOTHING_TO_SAY = "There is nothing to read aloud for this attempt yet.";
const NO_LEARNER = "Open the skill first, then try voice again.";
const NOT_WAITING = "This attempt isn't waiting for a spoken answer.";
const NO_SKILL = "This skill isn't on one of your maps.";

const SPEAK_RULE = { limit: 12, windowMs: 10 * 60_000 };
const GRANT_RULE = { limit: 20, windowMs: 10 * 60_000 };
/** A demo room shares one address. Each spoken answer uses about two tokens. */
const GRANT_RULE_PER_ADDRESS = { limit: 40, windowMs: 10 * 60_000 };

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
  const providers = deps.providers ?? sharedProviders();
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
  loadMap?: (mapId: string) => Promise<SkillMap | null>;
};

/**
 * POST /api/voice/stt-token with { attemptId } or, for dictation, { mapId, nodeId }.
 * Mints a 30 second Deepgram token, and builds the socket URL here so the browser
 * never chooses the model or the keyterms.
 *
 * A Deepgram token can also spend credit on its other speech APIs, and it can't be narrowed.
 * So one is only minted for a learner with an answer or explanation to give right now, and
 * userId is null for a caller with no cookie: this route must never create an identity.
 */
export async function handleSttToken(request: Request, userId: string | null, deps: GrantDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env;
  const apiKey = env.DEEPGRAM_API_KEY;
  if (!apiKey) return sentence(NOT_SET_UP, 503);
  if (!isSameOrigin(request)) return sentence(NOT_ALLOWED, 403);
  if (!userId) return sentence(NO_LEARNER, 401);
  if (!allowRate(`grant:${userId}`, GRANT_RULE)) return sentence(TOO_MANY, 429);

  const body = (await request.json().catch(() => null)) as GrantBody | null;
  let keyterms: string[];
  try {
    keyterms = await keytermsFor(userId, body, deps);
  } catch (error) {
    return attemptFailure(error);
  }

  // Counted only once we would really spend, so junk requests can't lock out a room sharing one address.
  if (!allowRate(`grant-ip:${clientAddress(request)}`, GRANT_RULE_PER_ADDRESS)) return sentence(TOO_MANY, 429);

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

type GrantBody = { attemptId?: unknown; mapId?: unknown; nodeId?: unknown };

/** Also the permission check: it throws unless this learner has something to say right now. */
async function keytermsFor(userId: string, body: GrantBody | null, deps: GrantDeps): Promise<string[]> {
  const loadMap = deps.loadMap ?? getSkillMap;

  if (typeof body?.attemptId === "string") {
    const loadAttempt = deps.loadAttempt ?? getOwnAttempt;
    const attempt = await loadAttempt(userId, body.attemptId);
    if (attempt.status !== "needs-followup") throw new AttemptError(NOT_WAITING, 409);
    const map = await loadMap(attempt.mapId);
    const title = map?.nodes.find((node) => node.id === attempt.nodeId)?.title ?? "";
    return extractKeyterms(title, attempt.explanation);
  }

  if (typeof body?.mapId === "string" && typeof body.nodeId === "string") {
    const map = await loadMap(body.mapId);
    const node = map?.ownerId === userId ? map.nodes.find((candidate) => candidate.id === body.nodeId) : undefined;
    if (!node) throw new AttemptError(NO_SKILL, 404);
    return extractKeyterms(node.title, "");
  }

  throw new AttemptError(NO_SKILL, 400);
}

/**
 * The token route needs no login, so a page on another site must not be able to use it.
 * A script can fake this header, which is why the other checks and rate limits exist too.
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

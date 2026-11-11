import { getClient } from "./client";
import { AiRefusedError, AiUnavailableError } from "./errors";
import { modelId, PROFILES, type Profile, type ProfileSettings } from "./profiles";

/** A failed call is retried once, but only if it failed this fast. A slow failure won't recover while the learner waits. */
const RETRY_WITHIN_MS = 10_000;
/** The longest we wait for `retry-after`. */
const MAX_RETRY_WAIT_MS = 5_000;
const DEFAULT_RETRY_WAIT_MS = 500;
/** No second try with less time than this left. */
const MIN_RETRY_BUDGET_MS = 2_000;

/** One provider failure. The message goes to the server log and never to callers. */
export class CallFailure extends Error {
  constructor(
    message: string,
    readonly retry: { wait: number } | null = null,
  ) {
    super(message);
  }
}

export type CallSpec = {
  profile: Profile;
  label: string;
  system?: string;
  prompt: string;
  /** Clamped to the profile's maxTokens. */
  maxTokens?: number;
  /** Clamped to the profile's firstTextMs. */
  firstTextMs?: number;
  /** Limit for the whole call, retry included. Clamped to the profile's totalMs. */
  totalMs?: number;
  /** A lower effort than the profile's (never a higher one), for a call whose thinking runs too long. */
  effort?: ProfileSettings["effort"];
};

export type CallResult = { text: string; stopReason: string | null; model: string; ms: number };

type TextHandler = (delta: string) => void | Promise<void>;

/** What the failing request had already produced, so streamLines knows whether a retry is safe. */
type Progress = { sawText: boolean };

class CallbackError {
  constructor(readonly error: unknown) {}
}

const clampDown = (wanted: number | undefined, ceiling: number) =>
  wanted !== undefined && Number.isFinite(wanted) && wanted > 0 ? Math.min(wanted, ceiling) : ceiling;

const EFFORTS: readonly ProfileSettings["effort"][] = ["low", "medium", "high"];
/** The caller's effort when it is lower than the profile's, else the profile's. */
export const effortFor = (wanted: ProfileSettings["effort"] | undefined, ceiling: ProfileSettings["effort"]) =>
  wanted !== undefined && EFFORTS.indexOf(wanted) >= 0 && EFFORTS.indexOf(wanted) < EFFORTS.indexOf(ceiling) ? wanted : ceiling;

/**
 * Streams one Messages request and returns its text. Retries once when the failure came within
 * 10 s, was a 429, a 5xx/529 or a connection error, and nothing had been shown yet. A refusal
 * throws AiRefusedError; every other failure throws AiUnavailableError (logged without provider
 * text). An error thrown by `onText` is rethrown as it is.
 */
export async function runCall(spec: CallSpec, onText?: TextHandler): Promise<CallResult> {
  const profile = PROFILES[spec.profile];
  const totalMs = clampDown(spec.totalMs, profile.totalMs);
  const startedAt = Date.now();
  const progress: Progress = { sawText: false };
  const model = modelId();

  for (let attempt = 1; ; attempt++) {
    const elapsed = Date.now() - startedAt;
    try {
      const result = await streamOnce(spec, totalMs - elapsed, progress, onText);
      console.info(`[ai] ${spec.label}: ${spec.profile} (${model}) answered in ${Date.now() - startedAt}ms`);
      return result;
    } catch (error) {
      if (error instanceof CallbackError) throw error.error;
      if (error instanceof AiRefusedError) {
        console.warn(`[ai] ${spec.label}: ${spec.profile} (${model}) refused after ${Date.now() - startedAt}ms`);
        throw error;
      }
      const spent = Date.now() - startedAt;
      const failure = error instanceof CallFailure ? error : classify(error);
      const canRetry =
        attempt === 1 && failure.retry && !progress.sawText && spent <= RETRY_WITHIN_MS && totalMs - spent - failure.retry.wait >= MIN_RETRY_BUDGET_MS;
      console.warn(`[ai] ${spec.label}: ${spec.profile} (${model}) failed after ${spent}ms: ${failure.message}${canRetry ? ", retrying" : ""}`);
      if (!canRetry || !failure.retry) throw new AiUnavailableError();
      await new Promise((resolve) => setTimeout(resolve, failure.retry!.wait));
    }
  }
}

async function streamOnce(spec: CallSpec, budgetMs: number, progress: Progress, onText?: TextHandler): Promise<CallResult> {
  const client = getClient();
  if (!client) throw new CallFailure("ANTHROPIC_API_KEY is not set");

  const profile = PROFILES[spec.profile];
  const startedAt = Date.now();
  const controller = new AbortController();
  const firstTextMs = Math.min(clampDown(spec.firstTextMs, profile.firstTextMs), budgetMs);
  let firstTimer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    firstTimer = setTimeout(() => reject(new CallFailure("no text within the first-text limit")), firstTextMs);
    totalTimer = setTimeout(() => reject(new CallFailure("timeout")), budgetMs);
  });
  timedOut.catch(() => {});

  // No temperature, top_p, top_k, prefill or fallbacks: Haiku 5.5 rejects them.
  const params = {
    model: modelId(),
    max_tokens: clampDown(spec.maxTokens, profile.maxTokens),
    ...(spec.system ? { system: spec.system } : {}),
    messages: [{ role: "user" as const, content: spec.prompt }],
    thinking: profile.thinking,
    output_config: { effort: effortFor(spec.effort, profile.effort) },
  };

  try {
    const stream = client.messages.stream(params, { signal: controller.signal });
    // Asked for now so an aborted stream always has an error handler, and a lost race never leaves a rejection unhandled.
    const finished = stream.finalMessage();
    finished.catch(() => {});
    const iterator = stream[Symbol.asyncIterator]();
    let text = "";
    for (;;) {
      const pending = iterator.next();
      pending.catch(() => {});
      const next = await Promise.race([pending, timedOut]);
      if (next.done) break;
      const event = next.value;
      if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") continue;
      if (!progress.sawText) {
        progress.sawText = true;
        clearTimeout(firstTimer);
      }
      text += event.delta.text;
      if (onText) {
        const handled = Promise.resolve(onText(event.delta.text)).catch((error) => {
          throw new CallbackError(error);
        });
        handled.catch(() => {});
        await Promise.race([handled, timedOut]);
      }
    }
    const message = await Promise.race([finished, timedOut]);
    if (message.stop_reason === "refusal") throw new AiRefusedError();
    return { text, stopReason: message.stop_reason, model: message.model || params.model, ms: Date.now() - startedAt };
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    clearTimeout(firstTimer);
    clearTimeout(totalTimer);
  }
}

/** Turns an SDK error into a CallFailure that says whether one fast retry makes sense. */
function classify(error: unknown): CallFailure {
  const { status, name, headers } = error as { status?: unknown; name?: unknown; headers?: unknown };
  if (typeof status === "number") {
    const retryable = status === 429 || status >= 500;
    return new CallFailure(`HTTP ${status}`, retryable ? { wait: retryAfterMs(headers) } : null);
  }
  const isAbort = name === "APIUserAbortError" || name === "AbortError";
  const isConnection = typeof name === "string" && name.startsWith("APIConnection");
  if (name === "APIConnectionTimeoutError") return new CallFailure("timeout");
  if (isConnection || (!isAbort && error instanceof TypeError)) return new CallFailure("connection error", { wait: DEFAULT_RETRY_WAIT_MS });
  return new CallFailure(isAbort ? "aborted" : "unexpected error");
}

function retryAfterMs(headers: unknown): number {
  let raw: string | null | undefined;
  if (headers && typeof (headers as { get?: unknown }).get === "function") raw = (headers as Headers).get("retry-after");
  else if (headers && typeof headers === "object") raw = (headers as Record<string, string>)["retry-after"];
  const seconds = Number(raw);
  if (!raw || !Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_WAIT_MS;
  return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
}

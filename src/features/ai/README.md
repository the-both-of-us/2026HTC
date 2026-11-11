# ai

Every model call in the app goes through here. One provider, one model: **Claude Haiku 5.5** through the official `@anthropic-ai/sdk`. There is no fallback model and no tier, route or per-user model choice.

```ts
import { chatJSON, chatText, streamLines } from "@/features/ai";

const grade = await chatJSON({
  profile: "check",              // plan | write | check: how hard the model thinks (below)
  label: "teachback-grade",      // shows up in the logs
  system: "You are a strict grader.",
  prompt: "...",
  schema: z.object({ score: z.number() }), // top level must be an object
  maxTokens: 1000,               // optional, can only go DOWN from the profile's
  totalMs: 10_000,               // optional, can only go DOWN from the profile's
});

const text = await chatText({ profile: "write", label: "summary", prompt: "..." });

const { lines, rejected, truncated } = await streamLines({
  profile: "plan",
  label: "syllabus",
  system: "...",                 // the JSON Lines instruction is appended for you
  prompt: "...",
  line: z.discriminatedUnion("kind", [headLine, unitLine]),
  onLine: async (line, index) => { await emit(line); }, // awaited, in order; index = lines[index]
});
```

## Profiles (`profiles.ts`)

Callers pick a profile by task, never a model. The model is `ANTHROPIC_MODEL` (default `claude-haiku-5-5`).

| profile | thinking | effort | default `max_tokens` | first text within | whole call |
|---|---|---|---|---|---|
| plan | adaptive | high | 32,000 | 70 s | 100 s |
| write | adaptive | low | 12,000 | 25 s | 60 s |
| check | disabled | low | 2,000 | 10 s | 15 s |

Thinking counts against `max_tokens`, so plan needs the room (a syllabus spends about 10k tokens thinking). Callers may lower `maxTokens`, `firstTextMs` and `totalMs` per call, never raise them past the profile. An unset `profile` means `write` while other features migrate (it should become required).

Never sent, because Haiku 5.5 rejects them: `temperature`, `top_p`, `top_k`, an assistant prefill, `fallbacks`. Only `text` blocks are read; thinking is never shown or stored.

## How a call runs (`call.ts`)

- Every request streams (`client.messages.stream`); the SDK's own retries are off (`maxRetries: 0`).
- **One fast retry:** a 429, a 5xx/529 or a connection error that came within 10 s, before any text, with at least 2 s of the call left, waits for `retry-after` (at most 5 s) and tries once more. A slow failure, any other status, a timeout or an error after text started is not retried.
- **Timeouts:** no text within the profile's first-text limit, or the whole call past `totalMs`, fails. Thinking deltas don't count as text.
- **Refusal** (`stop_reason: "refusal"`) throws `AiRefusedError` ("We can't write this topic here."). Every other failure throws `AiUnavailableError` (safe to show). Provider error text never reaches callers or the logs: the log has the label, profile, time and a reason such as `HTTP 429`.
- **`chatJSON`:** the schema goes in the system prompt. A reply that is not valid JSON or fails the schema gets one repair request with the error appended, if 5 s or more of the call is left. A reply cut off at `max_tokens` is a failure (it would be cut off again). `chatText` also fails on `max_tokens` or an empty reply.
- **`streamLines`:** splits text on newlines, skips blank lines and code fences, parses each complete line and checks it against `line`. A bad line goes to `rejected` (never throws); a last line without a newline is handled at the end; `max_tokens` sets `truncated` and keeps the lines so far. A fast retry only happens before the first text, so `onLine` never sees a line twice. An error thrown by `onLine` stops the stream and is rethrown as it is.
- `onServed({ route: "anthropic", model, ms })` is called once. `modelLabel(model)` gives "Claude Haiku" for people.

## Tests

`npm test -- ai`. `ai.test.ts` mocks the SDK client (request bodies per profile, refusal, max_tokens, retries, timeouts, `streamLines` edge cases). `sdk.test.ts` runs the **real SDK** over a stubbed `fetch`. `testing.ts` (import `@/features/ai/testing`) has `anthropicStreamResponse(text)`, `anthropicError(status)` and `readAnthropicRequest(init)` for tests, evals and no-cost end-to-end runs that replace `globalThis.fetch` (the client looks fetch up on every request, so a late swap works).

Tests never call the API. Real calls need `ANTHROPIC_API_KEY` in `.env.local`; spend them sparingly.

## Files

- `profiles.ts`: `Profile`, `PROFILES`, `modelId()`, `modelLabel()`.
- `call.ts`: the streaming request, timeouts, the one retry.
- `chat.ts`: `chatJSON`, `chatText`. `lines.ts`: `streamLines`. `client.ts`: the SDK client. `errors.ts`: the two errors.
- `testing.ts`: stub responses for tests.

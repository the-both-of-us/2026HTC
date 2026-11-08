# ai

Every model call in the app goes through here.

```ts
import { AiUnavailableError, chatJSON, chatText } from "@/features/ai";

const grade = await chatJSON({
  label: "grade",                // shows up in the logs
  system: "You are a strict grader.",
  prompt: "...",
  schema: z.object({ score: z.number() }), // top level must be an object
  maxTokens: 2000,               // optional, default 4000
  timeoutMs: 15_000,             // optional, default 30000, per request
  preferredRoute: "gemini",      // optional: try this one first, then the normal order
});

const text = await chatText({ label: "summary", prompt: "..." });
```

## Provider chain

| Order | Route | Used when | Model |
|---|---|---|---|
| 1 | Cerebras | `CEREBRAS_API_KEY` is set | `gpt-oss-120b` |
| 2 | Groq | `GROQ_API_KEY` is set | `openai/gpt-oss-120b` |
| 3 | Vercel AI Gateway | an OIDC token exists (always on Vercel) | `openai/gpt-oss-120b` |
| 4 | Gemini | `GEMINI_API_KEY` is set | `gemini-3.6-flash`, or `GEMINI_MODEL` |
| 5 | Bedrock | `BEDROCK_API_KEY` is set | `openai.gpt-oss-120b-1:0` in `us-west-2`, or `BEDROCK_MODEL` and `BEDROCK_REGION` |

- **Any failure** (a timeout, a network error or any error status, including 401) moves on to the next route. One provider's bad key or missing model should not end the demo.
- **`preferredRoute`** moves one route to the front. Everything else stays the same.
- **Gemini is not first** for grading, because it was measured at 4.7 to 13.2 s against under 1 s on Cerebras. Flashcards and quiz can prefer it, since their results are saved.
- **Bad JSON** gets one retry on the same route, with the error appended to the prompt. If that fails too, the next route gets a turn.
- **If every route fails within 15 seconds**, `chatJSON` goes round them once more, because this model returns an empty reply now and then. It doesn't do this after a slow failure, since a provider that hung won't recover while the learner waits. So one `chatJSON` can make up to 20 requests with all five routes set (two per route, twice round), and `timeoutMs` applies to each one.

`chatJSON` adds the schema to the system prompt for you, so a prompt doesn't need to describe the shape. Only Cerebras is asked for `response_format: json_object`.

## Tiers and Claude

`tier` (1 to 4, picked by the router in `features/settings`) puts one Claude model in front of the chain above:

| Tier | Model | Env override | Request |
|---|---|---|---|
| 1 or unset | the chain above, unchanged | | |
| 2 | `claude-haiku-5-5` | `ANTHROPIC_MODEL_HAIKU` | thinking `disabled`, effort `medium` |
| 3 | `claude-sonnet-5-5` | `ANTHROPIC_MODEL_SONNET` | thinking `between_tools` (off), effort `medium` |
| 4 | `claude-opus-5-5` | `ANTHROPIC_MODEL_OPUS` | adaptive thinking (can't be off), effort `medium`, max_tokens + 8000 |

- The route calls `https://api.anthropic.com/v1/messages` with `x-api-key: $ANTHROPIC_API_KEY` and `anthropic-version: 2023-06-01`, by `fetch` like the other routes (no SDK, so tests mock `fetch` the same way). No temperature.
- No key means it is skipped. Any error status, a timeout, `stop_reason: "refusal"` or `"max_tokens"`, or bad JSON twice moves on to the normal chain (then `preferredRoute`, then the usual order), so a Claude problem never loses a call.
- JSON comes from the same system-prompt instructions and `parseReply` as the other routes.
- `onServed({ route, model, ms })` is called once with the model that answered and the whole call's time. `modelLabel(model)` gives "Claude Sonnet" or "gpt-oss-120b" for people. Lessons use both for "Written by AI (Claude Sonnet, 14 s)".

## Errors

When no route can answer, both functions throw `AiUnavailableError`. Its message is safe to show to a user. Provider error text never reaches callers or the logs: the logs only record the route, the time taken and the reason, such as `HTTP 429`.

```
[ai] grade: served by cerebras (gpt-oss-120b) in 812ms
[ai] lesson: anthropic (claude-sonnet-5-5) failed after 50001ms: timeout
```

## Files

- `routes.ts`: the provider list, plus `claudeRoute(tier)` and `modelLabel`. Add or reorder routes here.
- `chat.ts`: the fallback loop, the request and JSON validation.

Tests mock `fetch`: `npm test -- ai`. The gateway free tier allows about 5 requests a minute per model, so spend real calls sparingly.

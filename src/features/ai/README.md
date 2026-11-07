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

## Errors

When no route can answer, both functions throw `AiUnavailableError`. Its message is safe to show to a user. Provider error text never reaches callers or the logs: the logs only record the route, the time taken and the reason, such as `HTTP 429`.

```
[ai] grade: served by cerebras in 812ms
[ai] grade: cerebras failed after 30001ms: timeout
```

## Files

- `routes.ts`: the provider list. Add or reorder routes here.
- `chat.ts`: the fallback loop, the request and JSON validation.

Tests mock `fetch`: `npm test -- ai`. The gateway free tier allows about 5 requests a minute per model, so spend real calls sparingly.

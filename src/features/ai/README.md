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
});

const text = await chatText({ label: "summary", prompt: "..." });
```

## Provider chain

| Order | Route | Used when | Model |
|---|---|---|---|
| 1 | Cerebras | `CEREBRAS_API_KEY` is set | `gpt-oss-120b` |
| 2 | Groq | `GROQ_API_KEY` is set | `openai/gpt-oss-120b` |
| 3 | Vercel AI Gateway | an OIDC token exists (always on Vercel) | `openai/gpt-oss-120b` |

- **A timeout, network error, 402, 429 or 5xx** moves on to the next route.
- **Any other status (400, 401, 403, 404)** stops the chain, since it usually means our request or key is wrong.
- **Bad JSON** gets one retry on the same route, with the error appended to the prompt. If that fails too, the next route gets a turn. So one `chatJSON` can make up to 6 requests, and `timeoutMs` applies to each one.

`chatJSON` adds the schema to the system prompt for you, so a prompt doesn't need to describe the shape. Only Cerebras is asked for `response_format: json_object`.

## Errors

When no route can answer, both functions throw `AiUnavailableError`. Its message is safe to show to a user. Provider error text never reaches callers or the logs: the logs only record the route, the time taken and the reason, such as `HTTP 429`.

```
[ai] grade: served by gateway in 812ms
[ai] grade: cerebras failed after 30001ms: timeout
```

## Files

- `routes.ts`: the provider list. Add or reorder routes here.
- `chat.ts`: the fallback loop, the request and JSON validation.

Tests mock `fetch`: `npm test -- ai`. The gateway free tier allows about 5 requests a minute per model, so spend real calls sparingly.

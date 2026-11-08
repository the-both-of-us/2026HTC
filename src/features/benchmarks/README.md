# benchmarks

How gpt-oss-120b (Cerebras), Claude Haiku 5.5, Sonnet 5.5 and Opus 5.5 do per subject on public
exam questions, and how fast each writes a lesson. Shown at `/settings/models` (linked quietly from
Settings), so the model router's choices rest on data.

- `catalog.ts`: the models (with list prices) and subjects (MMLU-Pro category or MMLU config).
- `parse.ts`: the one prompt every model gets, and the code that reads `Answer: X` from a reply.
- `shape.ts`: raw calls to `results.json`, plus `pickModel` (cheapest model within 5 points of the
  best on a subject) used for the page's "Use" column and takeaways.
- `results.json`: the latest run, committed. The page renders only this; it makes no AI calls.
- `ui/BenchmarksScreen.tsx`: the page (server component).

## Rerunning

```
npx tsx --env-file=/path/to/.env.local scripts/bench-models.ts --pilot   # 2 questions x 4 models
npx tsx --env-file=/path/to/.env.local scripts/bench-models.ts           # everything missing
npx tsx scripts/bench-models.ts --report                                 # rewrite results.json, no calls
```

Needs `CEREBRAS_API_KEY` and `ANTHROPIC_API_KEY`. Each finished call is appended to `calls.jsonl`
in `BENCH_DIR` (a scratch folder), so a rerun only makes the missing calls. The question sample
is fixed: the lowest SHA-256 of each question id. Cerebras runs at about 26 requests a minute and
stops if its daily token allowance drops under 300k, so the live app keeps working. Grading is
by code against the answer key: no AI judge. A reply with no readable letter counts as wrong.

Tests: `npm test -- benchmarks`.

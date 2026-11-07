# Grading eval

Measures `gradeExplanation` with real model calls. `npm run eval` writes `docs/eval-results.md`.

- `cases.json`: labelled explanations. Labels are written by the AI builder and need a human spot check.
- `skills.json`: the skills under test, frozen. Fixture nodes plus two generated live.
- `metrics.ts`: the numbers, pure and tested.
- `fetchTap.ts`: reads token counts and raw replies without changing the grader.
- `plantedQuotes.ts`: plants fake quotes through the real grader, with no model call.
- `report.ts`, `findings.md`: the written report. `findings.md` is the hand-written reading of the latest run.
- `results.json`: every raw run.

Commit `cases.json` before running, so labels can't be fitted to results. Other features must not import from this folder.

# settings

The `/settings` page: **Display** (theme, text size), **Accessibility** (Accessible learning mode), both per-browser (localStorage, in `src/shared/ui`), and **Friends and privacy** (from `features/network`).

There are no AI model settings any more. Wave 2 runs one model (Claude Haiku, with three thinking profiles chosen by task: see `features/ai`), so the model router, the speed and per-task model choices, `/api/settings` and `/settings/models` (the benchmark page) are gone.

Tests: `npm test -- settings`.

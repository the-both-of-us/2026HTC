# labour

**Owner:** Abdu. Live labour numbers from Statistics Canada's Web Data Service (no key).

- `getLabourSnapshot()` returns unemployment (Canada, Alberta, Calgary CMA), Calgary offered wages for six occupations, reference period, a source URL for each StatCan table used, and retrieved-at. Cached about 6 hours in memory; falls back to the last good copy (`stale: true`); returns `null` if never fetched. Nothing is invented.
- `GET /api/labour` returns it (503 with `{ error }` when null).
- `LabourCard` (presentational, server or client) and `LiveLabourCard` (async server component, wrap in `<Suspense>`).

Verified against live calls on 2026-11-07 (October 2026): Canada 6.7 (vector 2062815), Alberta 7.3 (2064516), Calgary 6.6 (1643280342, three-month moving average). Wages come from table 14-10-0444-01, which is the job vacancy survey's **average offered hourly wage** for the Calgary economic region, quarterly (Q2 2026), not wages actually paid. Tests use `fixtures/statcan-unemployment.json`, a saved real response.

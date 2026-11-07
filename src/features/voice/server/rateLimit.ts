/**
 * A small in-memory limit, so one tab or script can't spend the demo's credits.
 * On Vercel each instance counts separately, which is good enough for a hackathon.
 */
type Window = { count: number; resetAt: number };

const MAX_TRACKED_KEYS = 5_000;

const shared = globalThis as typeof globalThis & { voiceRateWindows?: Map<string, Window> };
const windows = (shared.voiceRateWindows ??= new Map<string, Window>());

export type RateRule = { limit: number; windowMs: number };

/** Returns true if this use is allowed, and counts it. */
export function allowRate(key: string, rule: RateRule, now = Date.now()): boolean {
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS) windows.clear();
    windows.set(key, { count: 1, resetAt: now + rule.windowMs });
    return true;
  }
  if (current.count >= rule.limit) return false;
  current.count += 1;
  return true;
}

export function resetRateLimits(): void {
  windows.clear();
}

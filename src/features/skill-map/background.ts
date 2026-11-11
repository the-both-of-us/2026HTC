import { after } from "next/server";

/**
 * Every route that may start generation in the background has `maxDuration = 120`, and work
 * started there must finish 8 s before that: the deadline is the request start plus this.
 */
export const ROUTE_BUDGET_MS = 112_000;

/** The deadline for work a request starts now. */
export function routeDeadline(startedAt: number = Date.now()): number {
  return startedAt + ROUTE_BUDGET_MS;
}

/**
 * Runs `task` after the response, with Next's `after()`, so the request does not wait for it.
 * Outside a request (a script or a test) `after()` throws, and the task simply starts now. The
 * task never throws out of here: this is a head start, and a failure is logged.
 */
export function inBackground(label: string, task: () => Promise<unknown>): void {
  const run = () =>
    task().catch((error: unknown) => {
      console.warn(`[skill-map] ${label} failed in the background: ${error instanceof Error ? error.message : String(error)}`);
    });
  try {
    after(run);
  } catch {
    void run();
  }
}

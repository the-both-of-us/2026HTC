"use client";

import type { ProgramPlanning } from "../types";
import { Button, ErrorNotice, Spinner } from "@/shared/ui";
import { planningLine } from "./planning";

/**
 * The line under the program title while its course list is being written. Every number is a
 * count of course lines committed so far; the total is shown only when the program has a fixed one.
 */
export function PlanningNotice({
  planning,
  lost,
  retrying,
  error,
  onRetryPlanning,
  onReconnect,
}: {
  planning: ProgramPlanning | undefined;
  /** Polling gave up after repeated network failures. */
  lost: boolean;
  retrying: boolean;
  error: string | null;
  onRetryPlanning: () => void;
  onReconnect: () => void;
}) {
  if (lost) {
    return <ErrorNotice message="We lost the connection while planning. Your program is still being written." onRetry={onReconnect} />;
  }
  if (!planning || planning.state === "ready") return null;

  if (planning.state === "stalled") {
    return (
      <div className="flex flex-col gap-2 rounded-sheet border border-danger/50 px-4 py-3">
        <p className="font-medium tabular-nums">
          Planning stopped at {planning.planned} {planning.planned === 1 ? "course" : "courses"}.
        </p>
        <p className="text-sm text-ink-soft">The courses planned so far are kept. Trying again continues the plan.</p>
        <div>
          <Button onClick={onRetryPlanning} pending={retrying}>
            Try again
          </Button>
        </div>
        {error && <ErrorNotice message={error} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-sheet border border-rule-strong bg-sheet/90 px-4 py-3">
      <p role="status" className="flex items-center gap-2.5 font-medium tabular-nums">
        <Spinner size={16} />
        {planningLine(planning)}
      </p>
      <p className="text-sm text-ink-soft">
        Courses appear below as they are planned. A course can be started as soon as its Start button turns on.
      </p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button, ErrorNotice, Spinner } from "@/shared/ui";
import type { CanvasWait } from "./buildState";
import { startUnit } from "./unitApi";

/**
 * Shown in place of the canvas while a catalog course is being built (a map with no nodes yet).
 * Words only, with no percentage: the page really does not know how far along the model is.
 * "Try again" is `POST /api/maps/[id]/units/u1`, which restarts the syllabus build when needed;
 * `onRestarted` then reads the map again, which reports the build as running.
 */
export function BuildPanel({
  mapId,
  wait,
  onRestarted,
}: {
  mapId: string;
  wait: CanvasWait;
  onRestarted: () => Promise<void> | void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failed = wait === "failed-syllabus" || wait === "failed-unit1";

  async function retry() {
    setRetrying(true);
    setError(null);
    const outcome = await startUnit(mapId, "u1");
    if (outcome.kind === "error") setError(outcome.message);
    else await onRestarted();
    setRetrying(false);
  }

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto px-4 py-8 sm:px-6">
      <section aria-labelledby="build-title" className="flex w-full max-w-xl flex-col gap-3 rounded-sheet border border-rule-strong bg-sheet p-5 sm:p-6">
        {failed ? (
          <>
            <h2 id="build-title" className="text-xl font-medium">
              {wait === "failed-syllabus" ? "The syllabus was not finished" : "Unit 1 was not finished"}
            </h2>
            <p className="text-ink-soft">The writer stopped before it was done. Nothing you did is lost.</p>
            {error && <ErrorNotice message={error} />}
            <div>
              <Button onClick={() => void retry()} pending={retrying}>
                Try again
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 id="build-title" className="flex items-center gap-2.5 text-xl font-medium">
              <Spinner size={18} />
              {wait === "syllabus" ? "The syllabus is being written" : "Unit 1 is being written"}
            </h2>
            <p role="status" className="text-ink-soft">
              {wait === "syllabus"
                ? "Units appear in the row above as they are planned. Unit 1 starts as soon as it is planned."
                : "Unit 1 is being written. It usually takes under a minute."}
            </p>
            <p className="text-sm text-ink-soft">Keep this page open. The map shows up by itself.</p>
          </>
        )}
      </section>
    </div>
  );
}

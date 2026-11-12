"use client";

import clsx from "clsx";
import { Check, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, ErrorNotice, pollLoop, Spinner } from "@/shared/ui";
import type { UnitRailItem } from "../unitView";
import { startUnit } from "./unitApi";

/** How often to ask again while a unit is being written, and for how long in all. */
const POLL_MS = 2_000;
const POLL_LIMIT_MS = 3 * 60_000;

/**
 * The row of units above the canvas, for a course built from a syllabus. The canvas shows one
 * unit at a time, so its graph stays small enough to read. Counts are counted from the map.
 */
export function UnitRail({
  units,
  selectedId,
  onSelect,
  planning = false,
  knownCounts = {},
}: {
  units: UnitRailItem[];
  selectedId: string | null;
  onSelect: (unitId: string) => void;
  /** The syllabus is still being written: more units will join the row. */
  planning?: boolean;
  /** Topics known from the pre-test, by unit id (built or not). */
  knownCounts?: Record<string, number>;
}) {
  return (
    <nav aria-label="Units of this course" className="border-b border-rule px-4 py-2 sm:px-6">
      <ol className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {units.map((unit) => {
          const selected = unit.id === selectedId;
          const done = unit.built && unit.plannedTopics > 0 && unit.proved >= unit.plannedTopics;
          const known = knownCounts[unit.id] ?? 0;
          const knownNote =
            known > 0 ? (
              <>
                <span aria-hidden="true"> · {known} known</span>
                <span className="sr-only">
                  , {known} {known === 1 ? "topic" : "topics"} known from the pre-test
                </span>
              </>
            ) : null;
          return (
            <li key={unit.id} className="shrink-0">
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(unit.id)}
                title={unit.title}
                className={clsx(
                  "flex min-h-10 max-w-60 cursor-pointer items-center gap-2 rounded-control border px-3 text-left text-sm transition-control",
                  selected ? "border-ink bg-ink text-on-ink" : "border-rule-strong bg-sheet text-ink hover:border-ink",
                  !unit.built && !selected && "border-dashed text-ink-soft",
                )}
              >
                <span className="font-medium tabular-nums">Unit {unit.number}</span>
                <span className="min-w-0 truncate max-sm:hidden">{unit.title}</span>
                <span className={clsx("tabular-nums whitespace-nowrap", selected ? "text-on-ink" : "text-ink-soft")}>
                  {unit.built ? (
                    <>
                      {done && <Check aria-hidden="true" size={14} className="mr-0.5 inline align-[-2px]" />}
                      {unit.proved}/{unit.plannedTopics}
                      <span className="sr-only"> topics proven</span>
                      {knownNote}
                    </>
                  ) : unit.status === "locked" ? (
                    <>
                      <Lock aria-hidden="true" size={13} className="inline align-[-1px]" />
                      <span className="sr-only">, locked</span>
                      {knownNote}
                    </>
                  ) : (
                    <span>
                      Not started
                      {knownNote}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {planning && (
          <li className="shrink-0">
            <p role="status" className="flex min-h-10 items-center gap-2 rounded-control border border-dashed border-rule-strong px-3 text-sm text-ink-soft">
              <Spinner size={14} />
              {units.length === 0 ? "Planning units" : "Planning more units"}
            </p>
          </li>
        )}
      </ol>
    </nav>
  );
}

/**
 * Shown in place of the canvas for a unit that is not built yet: what it will cover, and either
 * "Start unit" or what it waits for.
 * `onBuilt` reloads the map once the unit's topics are in it.
 */
export function UnitStartPanel({
  mapId,
  unit,
  unitCount,
  onBuilt,
}: {
  mapId: string;
  unit: UnitRailItem;
  unitCount: number;
  onBuilt: () => Promise<void> | void;
}) {
  const [phase, setPhase] = useState<"idle" | "building" | "error">("idle");
  const [message, setMessage] = useState("");
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function start() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPhase("building");
    const startedAt = Date.now();
    // The request starts the build (or joins one running) and answers at once. Ask again every
    // 2 s until the unit is in, one request at a time and paused while the tab is hidden.
    await pollLoop(
      async (signal) => {
        const outcome = await startUnit(mapId, unit.id, signal);
        if (signal.aborted) return false;
        if (outcome.kind === "ready") {
          await onBuilt();
          return false;
        }
        if (outcome.kind === "error") {
          setMessage(outcome.message);
          setPhase("error");
          return false;
        }
        if (Date.now() - startedAt > POLL_LIMIT_MS) {
          setMessage("This unit is taking longer than usual. Your progress is saved, so try again.");
          setPhase("error");
          return false;
        }
        return true;
      },
      POLL_MS,
      controller.signal,
      "now",
    );
  }

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto px-4 py-8 sm:px-6">
      <section
        aria-labelledby="unit-start-title"
        className="flex w-full max-w-xl flex-col gap-4 rounded-sheet border border-rule-strong bg-sheet p-5 sm:p-6"
      >
        <div className="flex flex-col gap-1">
          <p className="text-sm text-ink-soft tabular-nums">
            Unit {unit.number} of {unitCount}
          </p>
          <h2 id="unit-start-title" className="text-xl font-medium">
            {unit.title}
          </h2>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-soft tabular-nums">
            {unit.plannedTopics} {unit.plannedTopics === 1 ? "topic" : "topics"} planned in the syllabus
          </p>
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            {unit.topicTitles.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ol>
        </div>

        {unit.status === "locked" && unit.waitingFor ? (
          <p className="flex items-start gap-2 text-ink-soft">
            <Lock aria-hidden="true" size={16} className="mt-1 shrink-0" />
            <span className="tabular-nums">
              Opens when {unit.waitingFor.needed} of the topics in Unit {unit.waitingFor.unitNumber} are proven. You have proven{" "}
              {unit.waitingFor.proved} so far.
            </span>
          </p>
        ) : phase === "error" ? (
          <ErrorNotice message={message} onRetry={() => void start()} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void start()} pending={phase === "building"}>
              {phase === "building" ? "Building the unit" : "Start unit"}
            </Button>
            {phase === "building" && (
              <p role="status" className="text-sm text-ink-soft">
                Writing this unit&apos;s topics. Keep this page open.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

import { Card } from "@/shared/ui";
import type { LabourSnapshot } from "../types";

/** Presentational, no hooks: works in server and client components. Renders nothing without data. */
export function LabourCard({ snapshot }: { snapshot: LabourSnapshot | null }) {
  if (!snapshot) return null;
  const { alberta, canada, calgary } = snapshot.unemployment;
  return (
    <Card role="group" aria-label="Labour market snapshot">
      <p className="text-sm text-ink-soft">Unemployment rate, {snapshot.referencePeriod}</p>
      <p className="mt-2 text-xl text-ink">
        Alberta <strong>{alberta.value}%</strong>, Canada <strong>{canada.value}%</strong>
        {calgary ? (
          <>
            , Calgary <strong>{calgary.value}%</strong>
          </>
        ) : null}
      </p>
      <p className="mt-2 text-sm text-ink-soft">
        Source: {snapshot.source.name}, seasonally adjusted, table{" "}
        <a className="underline" href={snapshot.source.url}>
          {snapshot.source.table}
        </a>
        {calgary ? (
          <>
            ; Calgary is a three-month moving average, table{" "}
            <a className="underline" href={snapshot.calgarySource.url}>
              {snapshot.calgarySource.table}
            </a>
          </>
        ) : null}
        . Retrieved{" "}
        {snapshot.retrievedAt.slice(0, 10)}
        {snapshot.stale ? " (last saved copy, Statistics Canada did not respond)" : ""}.
      </p>
    </Card>
  );
}

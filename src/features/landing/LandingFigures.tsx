import { connection } from "next/server";
import { getLabourSnapshot } from "@/features/labour";

/**
 * The figure in the middle of the landing seal, like the denomination on a note: Alberta's
 * unemployment rate, live from Statistics Canada. Renders nothing if StatCan has never answered.
 */
export async function LandingFigures() {
  await connection();
  const snapshot = await getLabourSnapshot();
  if (!snapshot) return null;
  const { alberta, canada, calgary } = snapshot.unemployment;

  return (
    <div className="flex flex-col items-center text-center">
      <p className="text-[clamp(2.875rem,14vw,4.375rem)] leading-[0.95] font-extrabold tracking-[-0.04em] tabular-nums font-stretch-[125%] lg:text-[clamp(3.5rem,5.4vw,5.25rem)]">
        {alberta.value}%
      </p>
      <p className="mt-1.5 text-sm font-semibold sm:text-[0.9375rem]">Alberta unemployment</p>
      <p className="mt-2 flex gap-2.5 text-sm tabular-nums sm:gap-4 sm:text-[0.9375rem]">
        <span>
          Canada <b className="font-bold">{canada.value}%</b>
        </span>
        {calgary && (
          <span>
            Calgary <b className="font-bold">{calgary.value}%</b>
          </span>
        )}
      </p>
      <p className="pointer-events-auto mt-1.5 max-w-40 text-sm leading-tight text-ink-soft sm:max-w-68">
        <a href={snapshot.source.url} className="underline-offset-4 hover:underline">
          {snapshot.referencePeriod}, Statistics Canada
        </a>
      </p>
    </div>
  );
}

/** The fine print for the figures: tables, the Calgary average and when they were fetched. */
export async function LandingFiguresSource() {
  await connection();
  const snapshot = await getLabourSnapshot();
  if (!snapshot) return null;
  return (
    <p>
      Unemployment rates: Statistics Canada, seasonally adjusted, table{" "}
      <a className="underline underline-offset-4" href={snapshot.source.url}>
        {snapshot.source.table}
      </a>
      {snapshot.unemployment.calgary && (
        <>
          ; Calgary is a three-month moving average, table{" "}
          <a className="underline underline-offset-4" href={snapshot.calgarySource.url}>
            {snapshot.calgarySource.table}
          </a>
        </>
      )}
      . Retrieved {snapshot.retrievedAt.slice(0, 10)}
      {snapshot.stale ? ", the last saved copy because Statistics Canada did not respond" : ""}.
    </p>
  );
}

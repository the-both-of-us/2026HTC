import { connection } from "next/server";
import { Suspense } from "react";
import { PageShell, Spinner } from "@/shared/ui";
import { getGridReading } from "../source";
import { GridDashboard } from "./GridDashboard";

function GridLoading() {
  return (
    <p className="flex min-h-64 items-center justify-center gap-3 text-ink-soft">
      <Spinner size={20} />
      Reading AESO&apos;s latest report.
    </p>
  );
}

/** The reading is fetched per request, so it streams in behind Suspense and is never built in. */
async function GridLive() {
  await connection();
  const reading = await getGridReading();
  return <GridDashboard initial={reading} />;
}

export function GridScreen() {
  return (
    <PageShell width="wide">
      <div className="flex flex-col gap-6">
        <header className="flex max-w-3xl flex-col gap-2">
          <h1 className="text-3xl font-medium sm:text-4xl">Read the Grid</h1>
          <p className="text-lg text-ink-soft">
            Learn to read Alberta&apos;s power system with live numbers from the public supply and demand
            report of the Alberta Electric System Operator (AESO).
          </p>
        </header>
        <Suspense fallback={<GridLoading />}>
          <GridLive />
        </Suspense>
      </div>
    </PageShell>
  );
}

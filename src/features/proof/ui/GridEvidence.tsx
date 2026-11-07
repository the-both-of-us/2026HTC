import { CircleCheck, TriangleAlert, Zap } from "lucide-react";
import type { ProofGridSolve } from "../types";
import { formatDateTime } from "./format";

/** "Nov 07, 2026 13:45" becomes "13:45 on Nov 07, 2026". AESO's times are Alberta time. */
function readingTime(asOfLabel: string): string {
  return `${asOfLabel.slice(-5)} on ${asOfLabel.slice(0, -6)}`;
}

/** Grid questions solved on real AESO figures. Shown only on an energy map's record. */
export function GridEvidence({ solves, displayName }: { solves: ProofGridSolve[]; displayName: string }) {
  return (
    <section aria-labelledby="grid-heading" className="flex flex-col gap-5">
      <div>
        <h2 id="grid-heading" className="flex items-center gap-2 text-2xl font-medium">
          <Zap size={22} aria-hidden="true" className="text-amber" />
          Worked on Alberta&apos;s real grid
        </h2>
        <p className="mt-1 text-ink-soft">
          {displayName} answered these from the public supply and demand report of the Alberta Electric System Operator
          (AESO). Code built each question from the report&apos;s figures and checked the answer on the server. No AI was
          involved.
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {solves.map((solve) => (
          <li key={solve.title} className="rounded-sheet border border-control-edge bg-sheet p-5">
            <p className="flex items-start gap-2.5">
              <CircleCheck size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-proven" />
              <span>
                Worked out <span className="font-semibold">{solve.skill}</span> from AESO&apos;s reading at{" "}
                {readingTime(solve.asOfLabel)}, Alberta time. Answer: <span className="font-semibold">{solve.answer}</span>,
                checked by code.
              </span>
            </p>
            {solve.stale && (
              <p className="mt-3 flex items-start gap-2 rounded-control border border-dashed border-contour px-3 py-2 text-sm">
                <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-contour" />
                Stale: AESO&apos;s report was over 15 minutes old when this was solved, so treat these figures as old.
              </p>
            )}
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium underline-offset-4 hover:underline">
                Show the figures and the working
              </summary>
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {solve.figures.map((figure) => (
                  <div key={figure.label} className="rounded-control border border-rule px-3 py-2">
                    <dt className="text-sm text-ink-soft">{figure.label}</dt>
                    <dd className="font-semibold tabular-nums">{figure.value}</dd>
                  </div>
                ))}
              </dl>
              <ol className="mt-3 flex flex-col gap-1 text-sm tabular-nums">
                {solve.working.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
            </details>
            <p className="mt-3 text-sm text-ink-soft">Solved {formatDateTime(solve.solvedAt)}.</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

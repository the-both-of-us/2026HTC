"use client";

import { Info, X } from "lucide-react";
import { useId, useRef } from "react";
import { Button } from "@/shared/ui";

const STEPS: { by: "AI" | "Code"; text: string }[] = [
  { by: "AI", text: "Reads your explanation and returns your exact words for each checkpoint. It never gives a number." },
  { by: "Code", text: "Checks every quote is really in what you wrote. A quote that isn't there counts as not met." },
  { by: "Code", text: "Computes the score: checkpoints met out of 100, minus 20 for each factual error the AI flagged. 65 passes." },
  { by: "AI", text: "Asks one follow-up about your own words, and judges your answer. You have to pass it." },
];

/**
 * From docs/eval-results.md, the grading eval run on Nov 7, 2026. Copied by hand, so if the eval
 * is rerun, update these with it.
 */
const MEASURED = [
  "0.53 s to grade a typical explanation, 0.92 s for the slowest 5%, measured from a laptop.",
  "About $0.00072 per grade, estimated from token counts and Cerebras's list price.",
  "0 of 48 answers that should fail passed the written check. The test answers were written by an AI, not real learners.",
];

/** A short "How it works" dialog, for the front page and the map. */
export function HowItWorksButton({ className }: { className?: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  return (
    <>
      <Button variant="quiet" size="sm" className={className} onClick={() => dialogRef.current?.showModal()}>
        <Info size={16} aria-hidden="true" />
        How it works
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-auto max-h-[90dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto border-[1.5px] border-ink bg-sheet p-5 text-ink shadow-panel backdrop:bg-ink/60 sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-2xl font-bold">
            How OryxLearn checks you
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
            className="-m-1 inline-flex size-10 shrink-0 cursor-pointer items-center justify-center hover:bg-raised"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <p className="mt-2 text-ink-soft">The AI finds the words. Code decides what they are worth.</p>
        <ol className="mt-4 flex flex-col gap-3">
          {STEPS.map((step) => (
            <li key={step.text} className="flex items-start gap-3">
              <span
                className={`mt-0.5 inline-flex w-12 shrink-0 justify-center rounded-control border py-0.5 text-sm font-medium ${
                  step.by === "Code" ? "border-ink bg-ink text-on-ink" : "border-ink-soft border-dashed text-ink-soft"
                }`}
              >
                {step.by}
              </span>
              <span>{step.text}</span>
            </li>
          ))}
        </ol>

        <h3 className="mt-6 font-bold">Measured, not promised</h3>
        <p className="text-sm text-ink-soft">From our grading eval on Nov 7, 2026: 71 test answers, each graded 3 times.</p>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm">
          {MEASURED.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-ink-soft">
          Each result shows its own grading time, measured on our server. The full report is docs/eval-results.md in our
          repository.
        </p>
      </dialog>
    </>
  );
}

"use client";

import { CircleCheck, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, buttonClasses, ErrorNotice } from "@/shared/ui";
import type { DeletedCounts } from "../deleteData";

type Step =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "deleting" }
  | { kind: "failed"; message: string }
  | { kind: "done"; deleted: DeletedCounts };

const COULD_NOT_CONNECT = "OryxLearn could not be reached, so nothing more was deleted. Check your connection, then try again.";
const COULD_NOT_DELETE = "Not everything could be deleted just now. What was already deleted stays deleted. Please try again.";

const DANGER_BUTTON = "border-danger bg-danger-surface text-ink hover:border-danger hover:bg-danger/20";

/** One button, then a confirmation in the page itself, then the result in numbers. */
export function DeleteMyData() {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const startArea = useRef<HTMLDivElement>(null);

  // Focus follows the conversation: the question when it appears, the answer when it lands.
  useEffect(() => {
    if (step.kind === "confirming") confirmHeading.current?.focus();
    if (step.kind === "done") resultRef.current?.focus();
  }, [step.kind]);

  function cancel() {
    setStep({ kind: "idle" });
    // The start button is back on screen after this render.
    requestAnimationFrame(() => startArea.current?.querySelector("button")?.focus());
  }

  async function deleteEverything() {
    setStep({ kind: "deleting" });
    try {
      const response = await fetch("/api/my-data", { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.deleted) {
        setStep({ kind: "failed", message: typeof body?.error === "string" ? body.error : COULD_NOT_DELETE });
        return;
      }
      clearBrowserCopies();
      setStep({ kind: "done", deleted: body.deleted });
    } catch {
      setStep({ kind: "failed", message: COULD_NOT_CONNECT });
    }
  }

  if (step.kind === "done") {
    return (
      <div
        ref={resultRef}
        tabIndex={-1}
        role="status"
        className="flex flex-col items-start gap-3 rounded-sheet border border-proven/60 bg-proven-surface p-4"
      >
        <p className="flex items-start gap-2.5 font-medium">
          <CircleCheck aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-proven" />
          Done. {deletedSentence(step.deleted)}
        </p>
        <p>This browser now starts fresh as a new guest.</p>
        <Link href="/" className={buttonClasses("primary")}>
          Build a new map
        </Link>
      </div>
    );
  }

  if (step.kind === "idle") {
    return (
      <div ref={startArea}>
        <Button
          variant="secondary"
          className={DANGER_BUTTON}
          onClick={() => setStep({ kind: "confirming" })}
        >
          <Trash2 aria-hidden="true" size={18} />
          Delete my data
        </Button>
      </div>
    );
  }

  return (
    <section
      aria-labelledby="delete-confirm-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && step.kind !== "deleting") cancel();
      }}
      className="flex flex-col gap-4 rounded-sheet border border-danger/70 bg-danger-surface p-4"
    >
      <h3 id="delete-confirm-title" ref={confirmHeading} tabIndex={-1} className="text-lg font-medium outline-none">
        Delete everything you made in this browser?
      </h3>
      <p>
        Your maps, explanations, scores and proven skills are deleted. Evidence pages you published
        stop working, and courses you published leave the directory. This cannot be undone.
      </p>
      {step.kind === "failed" && <ErrorNotice message={step.message} onRetry={deleteEverything} />}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          className={DANGER_BUTTON}
          pending={step.kind === "deleting"}
          onClick={deleteEverything}
        >
          {step.kind === "deleting" ? "Deleting" : "Yes, delete everything"}
        </Button>
        {step.kind !== "deleting" && (
          <Button variant="quiet" onClick={cancel}>
            Keep my data
          </Button>
        )}
      </div>
    </section>
  );
}

/** Unsent drafts live in this tab's sessionStorage. They are the learner's words too. */
function clearBrowserCopies() {
  try {
    sessionStorage.clear();
  } catch {
    // Storage is blocked, so there is nothing saved there.
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function deletedSentence(deleted: DeletedCounts): string {
  const parts = [
    plural(deleted.maps, "map"),
    plural(deleted.attempts, "attempt"),
    plural(deleted.provenSkills, "proven skill"),
    plural(deleted.evidencePages, "evidence page"),
    plural(deleted.courses, "published course"),
    plural(deleted.gridAnswers, "grid answer"),
    plural(deleted.circles, "study circle"),
    plural(deleted.networkProfiles, "people profile"),
    plural(deleted.reviewRecords, "review record"),
  ];
  return `Deleted ${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}.`;
}

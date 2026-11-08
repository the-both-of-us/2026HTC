"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/shared/ui";

/**
 * Delete your own course. Two steps on the page itself (no browser dialog): the first press
 * asks, the second deletes and goes to the dashboard.
 */
export function DeleteCourse({ mapId, published }: { mapId: string; published: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/maps/${mapId}`, { method: "DELETE" });
      if (response.ok || response.status === 404) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "The course could not be deleted. Try again.");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    }
    setBusy(false);
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 self-start text-sm text-ink-soft underline-offset-4 hover:text-danger hover:underline"
      >
        <Trash2 aria-hidden="true" size={15} />
        Delete course
      </button>
    );
  }

  return (
    <div role="group" aria-label="Delete this course" className="flex flex-col gap-3 rounded-lg border border-danger/40 bg-danger-surface p-4">
      <p className="text-sm">
        Delete this course and your progress on it? {published && "It also comes off the Courses list. "}
        Copies other learners started stay theirs. This can&apos;t be undone.
      </p>
      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          size="sm"
          onClick={remove}
          disabled={busy}
          className="bg-danger! text-paper! shadow-none! hover:opacity-90"
        >
          {busy ? "Deleting…" : "Delete for good"}
        </Button>
        <Button size="sm" variant="subtle" onClick={() => setAsking(false)} disabled={busy}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

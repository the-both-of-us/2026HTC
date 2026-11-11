"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SYLLABUS_SHAPE } from "@/shared/types";
import { Button, ErrorNotice, Spinner, pollLoop } from "@/shared/ui";
import type { CourseView, OpenCourseResponse, ProgramDepth } from "../types";
import { plural } from "./format";

/** How often to ask again while another request holds the same course. */
const POLL_MS = 1500;
/** Stop asking after this long and offer a retry instead. */
const GIVE_UP_MS = 60_000;

/**
 * What the button promises, from computed numbers only. Every catalog course gets a full
 * syllabus, so a course with no plan yet says how it will be shaped.
 */
export function startPromise(course: CourseView, _depth?: ProgramDepth): string {
  void _depth;
  if (course.plannedTopics !== undefined) {
    const units = course.units?.length;
    return `${plural(course.plannedTopics, "topic")}${units && units > 1 ? ` in ${plural(units, "unit")}` : ""}, planned.`;
  }
  const shape = SYLLABUS_SHAPE.degree;
  return `${shape.units} units of ${shape.topicsPerUnit.min} to ${shape.topicsPerUnit.max} topics. The syllabus shows on the course map as it is written.`;
}

/**
 * Opens a course in one step: the request makes no model call. It creates your map and replies
 * with its id, and the map page shows the syllabus and unit 1 as they are written. While the
 * course's catalog entry is still being registered the button stays off. If another tab holds the
 * same course the server says "building", and this asks again.
 */
export function StartCourseButton({
  programId,
  course,
  depth,
}: {
  programId: string;
  course: CourseView;
  depth: ProgramDepth | undefined;
}) {
  const router = useRouter();
  const registering = course.startable === false;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Stop asking if the person leaves the page.
  useEffect(() => () => abort.current?.abort(), []);

  async function start() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPending(true);
    setError(null);
    const startedAt = Date.now();
    let opened = false;
    await pollLoop(
      async (signal) => {
        try {
          const response = await fetch(`/api/programs/${encodeURIComponent(programId)}/courses/${encodeURIComponent(course.slug)}`, {
            method: "POST",
            signal,
          });
          const body = (await response.json().catch(() => null)) as (Partial<OpenCourseResponse> & { mapId?: unknown; error?: unknown }) | null;
          if (response.ok && typeof body?.mapId === "string") {
            opened = true;
            router.push(`/map/${body.mapId}`);
            return false;
          }
          if (response.status === 202) {
            if (Date.now() - startedAt > GIVE_UP_MS) {
              setError("This course is taking too long to open. Please try again.");
              return false;
            }
            return true;
          }
          setError(typeof body?.error === "string" ? body.error : "This course could not be opened this time. Please try again.");
          return false;
        } catch {
          if (!signal.aborted) setError("OryxLearn could not be reached. Check your connection, then try again.");
          return false;
        }
      },
      POLL_MS,
      controller.signal,
      "now",
    );
    // After a successful open the page navigates away; keep the button busy until it does.
    if (!opened && !controller.signal.aborted) setPending(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-soft">{registering ? "This course is still being named. It can be started in a moment." : startPromise(course, depth)}</p>
        <Button onClick={() => void start()} pending={pending} disabled={registering} className="grow sm:grow-0">
          {!pending && !registering && <Sparkles aria-hidden="true" size={17} />}
          {registering ? "Planning" : pending ? "Opening this course" : "Start course"}
        </Button>
      </div>
      {pending && (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-soft">
          <Spinner size={15} />
          Opening the course. Its syllabus and unit 1 are written on the next page.
        </p>
      )}
      {error && <ErrorNotice message={error} onRetry={() => void start()} />}
    </div>
  );
}

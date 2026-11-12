"use client";

import clsx from "clsx";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, ErrorNotice, PageShell, Spinner } from "@/shared/ui";
import { SharedCatalogView } from "./SharedCatalog";
import { fetchSharedCatalog, resultsSummary, SEARCH_DEBOUNCE_MS, type SharedCatalog, type SharedResult } from "./sharedApi";

type Loaded = { key: string; query: string; result: SharedResult<SharedCatalog> };

/** /courses: search the shared catalog of AI-written courses and programs, and start one. */
export function CoursesScreen() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const focusSummary = useRef(false);
  const summary = useRef<HTMLParagraphElement>(null);
  const loadingLine = useRef<HTMLParagraphElement>(null);

  const requestKey = `${query}\n${attempt}`;

  // A link such as /courses?q=SQL%20joins (from "Practise this" on People) starts with that
  // search. The server renders no search, and the browser applies the link's once.
  const linkedQuery = useSyncExternalStore(subscribeToNothing, readLinkedQuery, () => "");
  const [appliedLink, setAppliedLink] = useState("");
  if (linkedQuery && linkedQuery !== appliedLink) {
    setAppliedLink(linkedQuery);
    setInput(linkedQuery);
    setQuery(linkedQuery);
  }

  // Search once typing pauses, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    let current = true;
    const key = `${query}\n${attempt}`;
    fetchSharedCatalog(query).then((result) => {
      if (current) setLoaded({ key, query, result });
    });
    return () => {
      current = false;
    };
  }, [query, attempt]);

  const stale = loaded?.key !== requestKey;
  const failed = loaded && !loaded.result.ok ? loaded.result : null;
  const catalog = loaded?.result.ok ? loaded.result : null;
  const showLoadingLine = !loaded || (stale && failed);
  const count = catalog ? catalog.courses.length + catalog.programs.length : 0;

  // After "Try again", focus follows the content that replaced the button.
  useEffect(() => {
    if (!focusSummary.current) return;
    if (showLoadingLine) loadingLine.current?.focus();
    else if (!stale) {
      focusSummary.current = false;
      summary.current?.focus();
    }
  }, [showLoadingLine, stale, loaded]);

  function retry() {
    focusSummary.current = true;
    setAttempt((value) => value + 1);
  }

  function clearSearch() {
    setInput("");
    setQuery("");
    document.getElementById("course-search")?.focus();
  }

  return (
    <PageShell width="wide">
      <h1 className="text-3xl font-medium">Courses</h1>
      <p className="mt-2 max-w-2xl text-lg text-ink-soft">
        AI-written courses and programs that already exist. Start one to get your own copy to prove skills on, with no wait.
      </p>

      <div className="mt-6 flex min-w-0 flex-col gap-1.5 sm:max-w-md">
        <label htmlFor="course-search" className="text-base font-semibold">
          Search courses and programs
        </label>
        <input
          id="course-search"
          type="search"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxLength={100}
          placeholder="A subject or a skill"
          className="block min-h-11 w-full rounded-control border-2 border-control-edge bg-sheet px-3.5 py-2 text-base text-ink placeholder:text-ink-soft"
        />
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {showLoadingLine ? (
          <p ref={loadingLine} tabIndex={-1} role="status" className="flex items-center gap-3 text-lg outline-none">
            <Spinner size={22} />
            Loading courses.
          </p>
        ) : failed ? (
          <ErrorNotice message={failed.message} onRetry={retry} />
        ) : catalog ? (
          <>
            <p
              ref={summary}
              tabIndex={-1}
              role="status"
              className="flex items-center gap-2.5 text-base text-ink-soft outline-none"
            >
              {resultsSummary(count, loaded?.query ?? "")}
              {stale && (
                <span className="inline-flex items-center gap-2">
                  <Spinner size={16} />
                  Updating.
                </span>
              )}
            </p>

            {count === 0 && loaded?.query && (
              <Button variant="secondary" onClick={clearSearch} className="self-start">
                Clear the search
              </Button>
            )}

            <div aria-busy={stale || undefined} className={clsx("flex flex-col gap-4", stale && "motion-safe:transition-opacity opacity-70")}>
              <SharedCatalogView courses={catalog.courses} programs={catalog.programs} />
            </div>
          </>
        ) : null}
      </div>
    </PageShell>
  );
}

/** The address never changes while this page is open, so there is nothing to subscribe to. */
function subscribeToNothing(): () => void {
  return () => {};
}

/** The search from a link like /courses?q=SQL%20joins, or "". */
function readLinkedQuery(): string {
  return new URLSearchParams(window.location.search).get("q")?.trim().slice(0, 200) ?? "";
}

"use client";

import clsx from "clsx";
import { Heart, ListChecks } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, ErrorNotice, PageShell, Spinner } from "@/shared/ui";
import type { CourseSort, PublicCourse } from "../types";
import { fetchCourses, type Result } from "./api";
import {
  courseHref,
  hasSample,
  likesLabel,
  resultsSummary,
  SAMPLE_NOTE,
  SEARCH_DEBOUNCE_MS,
  skillsLabel,
} from "./courseView";

type Loaded = { key: string; query: string; result: Result<{ courses: PublicCourse[] }> };

const SORTS: { value: CourseSort; label: string }[] = [
  { value: "popular", label: "Popular" },
  { value: "new", label: "Newest" },
];

/** The public directory at /courses: search, sort, and a card per course. */
export function CoursesScreen() {
  const [sort, setSort] = useState<CourseSort>("popular");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const focusSummary = useRef(false);
  const summary = useRef<HTMLParagraphElement>(null);
  const loadingLine = useRef<HTMLParagraphElement>(null);

  const requestKey = `${sort}\n${query}\n${attempt}`;

  // Search once typing pauses, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    let current = true;
    const key = `${sort}\n${query}\n${attempt}`;
    fetchCourses(sort, query).then((result) => {
      if (current) setLoaded({ key, query, result });
    });
    return () => {
      current = false;
    };
  }, [sort, query, attempt]);

  const stale = loaded?.key !== requestKey;
  const failed = loaded && !loaded.result.ok ? loaded.result : null;
  const courses = loaded?.result.ok ? loaded.result.courses : null;
  const showLoadingLine = !loaded || (stale && failed);

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
    setAttempt((count) => count + 1);
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
        Skill maps that people chose to share. Open one to see its skills in learning order.
      </p>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-md sm:flex-1">
          <label htmlFor="course-search" className="text-base font-semibold">
            Search courses
          </label>
          <input
            id="course-search"
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={100}
            placeholder="A role, a skill or an author"
            className="block min-h-11 w-full rounded-control border-2 border-control-edge bg-sheet px-3.5 py-2 text-base text-ink placeholder:text-ink-soft"
          />
        </div>
        <div role="group" aria-label="Sort courses" className="flex gap-1.5">
          {SORTS.map((option) => (
            <Button
              key={option.value}
              variant="subtle"
              size="sm"
              aria-pressed={sort === option.value}
              onClick={() => setSort(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {showLoadingLine ? (
          <p
            ref={loadingLine}
            tabIndex={-1}
            role="status"
            className="flex items-center gap-3 text-lg outline-none"
          >
            <Spinner size={22} />
            Loading courses.
          </p>
        ) : failed ? (
          <ErrorNotice message={failed.message} onRetry={retry} />
        ) : courses ? (
          <>
            <p
              ref={summary}
              tabIndex={-1}
              role="status"
              className="flex items-center gap-2.5 text-base text-ink-soft outline-none"
            >
              {resultsSummary(courses.length, loaded?.query ?? "")}
              {stale && (
                <span className="inline-flex items-center gap-2">
                  <Spinner size={16} />
                  Updating.
                </span>
              )}
            </p>

            {courses.length === 0 && loaded?.query && (
              <Button variant="secondary" onClick={clearSearch} className="self-start">
                Clear the search
              </Button>
            )}

            {courses.length > 0 && (
              <ul
                aria-busy={stale || undefined}
                className={clsx(
                  "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
                  stale && "motion-safe:transition-opacity opacity-70",
                )}
              >
                {courses.map((course) => (
                  <li key={course.mapId} className="min-w-0">
                    <CourseCard course={course} />
                  </li>
                ))}
              </ul>
            )}

            {hasSample(courses) && <p className="text-sm text-ink-soft">{SAMPLE_NOTE}</p>}
          </>
        ) : null}
      </div>
    </PageShell>
  );
}

function CourseCard({ course }: { course: PublicCourse }) {
  return (
    <Link
      href={courseHref(course.mapId)}
      className="flex h-full flex-col gap-2 rounded-sheet border border-control-edge bg-sheet p-5 transition-control hover:border-ink"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 text-xl leading-snug font-medium break-words">{course.title}</h2>
        {course.isSample && (
          <Badge tone="sample" className="shrink-0">
            Sample
          </Badge>
        )}
      </div>
      {course.subtitle && <p className="break-words text-ink-soft">{course.subtitle}</p>}
      <p className="text-sm break-words">
        <span className="sr-only">, </span>by {course.authorName}
      </p>
      <p className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-2 text-sm text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <span className="sr-only">, </span>
          <ListChecks aria-hidden="true" size={16} />
          {skillsLabel(course.skillCount)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="sr-only">, </span>
          <Heart aria-hidden="true" size={16} />
          {likesLabel(course.likeCount)}
        </span>
      </p>
    </Link>
  );
}

/** Calls to the courses API. Every failure becomes a sentence a person can act on. */
import type { CourseDetail, CourseSort, LikeResult, PublicCourse } from "../types";
import { isUuid } from "@/shared/ids";

export type Failure = { ok: false; message: string; status: number | null };
export type Result<T> = ({ ok: true } & T) | Failure;

/** Every courses call is a few store reads, or a seed from saved output. */
const TIMEOUT_MS = 15_000;
const COULD_NOT_CONNECT = "OryxLearn could not be reached. Check your connection, then try again.";

type Messages = { failed: string; timedOut: string };

const LIST_MESSAGES: Messages = {
  failed: "The courses could not be loaded this time. Please try again.",
  timedOut: "Loading the courses took too long. Please try again.",
};
const COURSE_MESSAGES: Messages = {
  failed: "This course could not be loaded this time. Please try again.",
  timedOut: "Loading this course took too long. Please try again.",
};
const PUBLISH_MESSAGES: Messages = {
  failed: "Your course could not be published this time. Please try again.",
  timedOut: "Publishing took too long. Please try again.",
};
const UNPUBLISH_MESSAGES: Messages = {
  failed: "Your course could not be made private this time. Please try again.",
  timedOut: "Making the course private took too long. Please try again.",
};
const START_MESSAGES: Messages = {
  failed: "This course could not be started this time. Please try again.",
  timedOut: "Starting the course took too long. Please try again.",
};
const LIKE_MESSAGES: Messages = {
  failed: "Your like could not be saved this time. Please try again.",
  timedOut: "Saving your like took too long. Please try again.",
};

/**
 * The API writes its `error` field as a sentence meant for people, so it is safe to show.
 * Anything else, such as a platform error page, gets a built-in sentence instead.
 */
function failureMessage(body: unknown, fallback: string): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" && error.length > 0 ? error : fallback;
}

async function request<T>(
  url: string,
  init: RequestInit,
  messages: Messages,
  read: (body: unknown) => T | null,
): Promise<Result<T>> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, message: failureMessage(body, messages.failed), status: response.status };
    const value = read(body);
    return value ? { ok: true, ...value } : { ok: false, message: messages.failed, status: response.status };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, message: timedOut ? messages.timedOut : COULD_NOT_CONNECT, status: null };
  }
}

function field(body: unknown, name: string): unknown {
  return body && typeof body === "object" ? (body as Record<string, unknown>)[name] : undefined;
}

function isCourse(value: unknown): value is PublicCourse {
  return typeof field(value, "mapId") === "string" && typeof field(value, "title") === "string";
}


function courseUrl(mapId: string): string {
  return `/api/courses/${encodeURIComponent(mapId)}`;
}

/** The directory, sorted and filtered by the server. */
export function fetchCourses(sort: CourseSort, q: string): Promise<Result<{ courses: PublicCourse[] }>> {
  const query = new URLSearchParams({ sort });
  if (q.trim()) query.set("q", q.trim());
  return request(`/api/courses?${query}`, { method: "GET" }, LIST_MESSAGES, (body) => {
    const courses = field(body, "courses");
    return Array.isArray(courses) && courses.every(isCourse) ? { courses } : null;
  });
}

/** One course as this viewer sees it. A 404 comes back with status 404. */
export function fetchCourse(mapId: string): Promise<Result<{ detail: CourseDetail }>> {
  return request(courseUrl(mapId), { method: "GET" }, COURSE_MESSAGES, (body) => {
    const ok =
      typeof field(body, "title") === "string" &&
      typeof field(body, "published") === "boolean" &&
      typeof field(body, "isOwner") === "boolean" &&
      Array.isArray(field(body, "skills"));
    return ok ? { detail: body as CourseDetail } : null;
  });
}

/** Publishes one of your maps. An empty name shows as "Anonymous learner". */
export function publishCourse(mapId: string, authorName: string): Promise<Result<{ course: PublicCourse }>> {
  return request(
    "/api/courses",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId, authorName: authorName.trim() || undefined }),
    },
    PUBLISH_MESSAGES,
    (body) => {
      const course = field(body, "course");
      return isCourse(course) ? { course } : null;
    },
  );
}

/** Makes your course private again. */
export function unpublishCourse(mapId: string): Promise<Result<object>> {
  return request(courseUrl(mapId), { method: "DELETE" }, UNPUBLISH_MESSAGES, (body) =>
    field(body, "ok") === true ? {} : null,
  );
}

/** Likes (PUT) or unlikes (DELETE) a course, and returns the new count. */
export function setLike(mapId: string, liked: boolean): Promise<Result<LikeResult>> {
  return request(`${courseUrl(mapId)}/like`, { method: liked ? "PUT" : "DELETE" }, LIKE_MESSAGES, (body) => {
    const nextLiked = field(body, "liked");
    const likeCount = field(body, "likeCount");
    return typeof nextLiked === "boolean" && typeof likeCount === "number" ? { liked: nextLiked, likeCount } : null;
  });
}

/**
 * Starts the course and returns the map to open: your own copy, made now or earlier, or the
 * course itself if it is yours. The id is checked, because the page navigates to it.
 */
export function startCourse(mapId: string): Promise<Result<{ mapId: string }>> {
  return request(`${courseUrl(mapId)}/start`, { method: "POST" }, START_MESSAGES, (body) => {
    const startedId = field(body, "mapId");
    return typeof startedId === "string" && isUuid(startedId) ? { mapId: startedId } : null;
  });
}

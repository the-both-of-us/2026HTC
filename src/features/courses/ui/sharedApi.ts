/** Calls for the shared catalog shelf on /courses. Every failure becomes a sentence a person can act on. */
export type SharedCourseItem = {
  courseId: string;
  title: string;
  summary: string;
  audience: string;
  units: number;
  topics: number;
};

export type SharedProgramItem = {
  programId: string;
  title: string;
  summary: string;
  audience: string;
  depth: "quick" | "degree";
  courseCount: number;
};

export type SharedResult<T> = ({ ok: true } & T) | { ok: false; message: string };

const TIMEOUT_MS = 20_000;
const COULD_NOT_CONNECT = "OryxLearn could not be reached. Check your connection, then try again.";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(body: unknown, name: string): unknown {
  return body && typeof body === "object" ? (body as Record<string, unknown>)[name] : undefined;
}

const isCourse = (value: unknown): value is SharedCourseItem =>
  typeof field(value, "courseId") === "string" && typeof field(value, "title") === "string";
const isProgram = (value: unknown): value is SharedProgramItem =>
  typeof field(value, "programId") === "string" && typeof field(value, "title") === "string";

async function request<T>(url: string, init: RequestInit, fallback: string, read: (body: unknown) => T | null): Promise<SharedResult<T>> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body: unknown = await response.json().catch(() => null);
    const error = field(body, "error");
    if (!response.ok) return { ok: false, message: typeof error === "string" && error ? error : fallback };
    const value = read(body);
    return value ? { ok: true, ...value } : { ok: false, message: fallback };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, message: timedOut ? "That took too long. Please try again." : COULD_NOT_CONNECT };
  }
}

export function fetchSharedCatalog(q: string): Promise<SharedResult<{ courses: SharedCourseItem[]; programs: SharedProgramItem[] }>> {
  const query = q.trim() ? `?${new URLSearchParams({ q: q.trim() })}` : "";
  return request(`/api/catalog${query}`, {}, "The shared courses could not be loaded this time.", (body) => {
    const courses = field(body, "courses");
    const programs = field(body, "programs");
    if (!Array.isArray(courses) || !Array.isArray(programs)) return null;
    return { courses: courses.filter(isCourse), programs: programs.filter(isProgram) };
  });
}

/** Your own map of this exact shared course. The id is checked, since the page navigates to it. */
export function startSharedCourse(courseId: string): Promise<SharedResult<{ id: string }>> {
  return request(
    `/api/catalog/courses/${encodeURIComponent(courseId)}/start`,
    { method: "POST" },
    "This course could not be started this time. Please try again.",
    (body) => {
      const id = field(body, "id");
      return typeof id === "string" && UUID_PATTERN.test(id) ? { id } : null;
    },
  );
}

/** Your own program following this shared program. */
export function startSharedProgram(programId: string): Promise<SharedResult<{ programId: string }>> {
  return request(
    `/api/catalog/programs/${encodeURIComponent(programId)}/start`,
    { method: "POST" },
    "This program could not be started this time. Please try again.",
    (body) => {
      const id = field(body, "programId");
      return typeof id === "string" && UUID_PATTERN.test(id) ? { programId: id } : null;
    },
  );
}

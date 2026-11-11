/** Calls for sharing programs. Every failure becomes a sentence a person can act on. */
import type { PublicProgram } from "../types";
import { isUuid } from "@/shared/ids";

export type Result<T> = ({ ok: true } & T) | { ok: false; message: string };

const TIMEOUT_MS = 20_000;
const COULD_NOT_CONNECT = "OryxLearn could not be reached. Check your connection, then try again.";

function field(body: unknown, name: string): unknown {
  return body && typeof body === "object" ? (body as Record<string, unknown>)[name] : undefined;
}

function isProgram(value: unknown): value is PublicProgram {
  return typeof field(value, "programId") === "string" && typeof field(value, "title") === "string";
}

/** The API writes `error` as a sentence for people. Anything else gets the fallback. */
async function request<T>(
  url: string,
  init: RequestInit,
  fallback: string,
  read: (body: unknown) => T | null,
): Promise<Result<T>> {
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

const programUrl = (programId: string) => `/api/programs/${encodeURIComponent(programId)}`;

export function shareProgram(programId: string, authorName: string): Promise<Result<{ program: PublicProgram }>> {
  return request(
    `${programUrl(programId)}/share`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authorName: authorName.trim() || undefined }),
    },
    "Your program could not be shared this time. Please try again.",
    (body) => {
      const program = field(body, "program");
      return isProgram(program) ? { program } : null;
    },
  );
}

export function unshareProgram(programId: string): Promise<Result<object>> {
  return request(
    `${programUrl(programId)}/share`,
    { method: "DELETE" },
    "Your program could not be made private this time. Please try again.",
    (body) => (field(body, "ok") === true ? {} : null),
  );
}

/** Returns the program to open: your copy, made now or earlier. The id is checked, since the page navigates to it. */
export function startProgram(programId: string): Promise<Result<{ programId: string }>> {
  return request(
    `${programUrl(programId)}/start`,
    { method: "POST" },
    "This program could not be started this time. Please try again.",
    (body) => {
      const id = field(body, "programId");
      return typeof id === "string" && isUuid(id) ? { programId: id } : null;
    },
  );
}

export function fetchPublicPrograms(q: string): Promise<Result<{ programs: PublicProgram[] }>> {
  const query = q.trim() ? `?${new URLSearchParams({ q: q.trim() })}` : "";
  return request(
    `/api/programs/public${query}`,
    { method: "GET" },
    "The programs could not be loaded this time. Please try again.",
    (body) => {
      const programs = field(body, "programs");
      return Array.isArray(programs) && programs.every(isProgram) ? { programs } : null;
    },
  );
}

export function programHref(programId: string): string {
  return `/program/${encodeURIComponent(programId)}`;
}

/** "1 course", "5 courses". */
export function coursesLabel(count: number): string {
  return `${count} ${count === 1 ? "course" : "courses"}`;
}

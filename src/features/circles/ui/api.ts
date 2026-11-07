import type { CircleView } from "../circles";

/** The server's sentence from an error response, or a fallback. */
async function errorSentence(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? fallback;
}

async function post<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!response) throw new Error("We could not reach the server. Check your connection and try again.");
  if (!response.ok) throw new Error(await errorSentence(response, fallback));
  return (await response.json()) as T;
}

export function startCircle(mapId: string, name: string) {
  return post<{ code: string; title: string }>("/api/circles", { mapId, name }, "The circle could not be started. Please try again.");
}

export function joinCircle(code: string, name: string) {
  return post<{ mapId: string }>(`/api/circles/${code}/join`, { name }, "You could not join just now. Please try again.");
}

/** "missing" for a 404, so the page can say the circle is gone rather than offer a retry. */
export async function fetchCircle(code: string): Promise<CircleView | "missing"> {
  const response = await fetch(`/api/circles/${code}`, { cache: "no-store" });
  if (response.status === 404) return "missing";
  if (!response.ok) throw new Error("failed");
  return (await response.json()) as CircleView;
}

export function circleUrl(code: string): string {
  return `${window.location.origin}/circle/${code}`;
}

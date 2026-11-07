import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Flashcard } from "../types";
import { createFlashcards, fetchSavedFlashcards } from "./api";

const CARD: Flashcard = {
  id: "c1",
  mapId: "m1",
  nodeId: "n1",
  front: "What does a LEFT JOIN keep?",
  back: "Every row from the left table.",
  citation: null,
};

const fetchMock = vi.fn<typeof fetch>();

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("fetchSavedFlashcards", () => {
  it("asks for the saved cards with a GET and a timeout", async () => {
    respond(200, { items: [CARD] });

    expect(await fetchSavedFlashcards("m1", "n1")).toEqual({ ok: true, items: [CARD] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/flashcards?mapId=m1&nodeId=n1");
    expect(init).toMatchObject({ method: "GET", signal: expect.any(AbortSignal) });
  });

  it("passes on items: null when none have been made", async () => {
    respond(200, { items: null });
    expect(await fetchSavedFlashcards("m1", "n1")).toEqual({ ok: true, items: null });
  });

  it("shows the server's sentence when it sends one", async () => {
    respond(404, { error: "We could not find that map." });
    expect(await fetchSavedFlashcards("m1", "n1")).toEqual({ ok: false, message: "We could not find that map." });
  });

  it("uses a built-in sentence for a platform error page or a strange body", async () => {
    respond(504, "<html>Gateway Timeout</html>");
    const page = await fetchSavedFlashcards("m1", "n1");
    expect(page).toMatchObject({ ok: false });
    expect(JSON.stringify(page)).not.toContain("Gateway");

    respond(500, { error: { stack: "secret" } });
    expect(JSON.stringify(await fetchSavedFlashcards("m1", "n1"))).not.toContain("secret");

    respond(200, { items: "nope" });
    expect(await fetchSavedFlashcards("m1", "n1")).toMatchObject({ ok: false, message: expect.any(String) });
  });

  it("explains a timeout and a lost connection differently", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    const timedOut = await fetchSavedFlashcards("m1", "n1");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const offline = await fetchSavedFlashcards("m1", "n1");

    expect(timedOut).toMatchObject({ ok: false, message: expect.stringContaining("too long") });
    expect(offline).toMatchObject({ ok: false, message: expect.stringContaining("could not be reached") });
    expect(JSON.stringify(offline)).not.toContain("Failed to fetch");
  });
});

describe("createFlashcards", () => {
  it("posts the ids as JSON and returns the cards", async () => {
    respond(200, { items: [CARD] });

    expect(await createFlashcards("m1", "n1")).toEqual({ ok: true, items: [CARD] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/flashcards");
    expect(init).toMatchObject({ method: "POST", signal: expect.any(AbortSignal) });
    expect(JSON.parse(String(init?.body))).toEqual({ mapId: "m1", nodeId: "n1" });
  });

  it("treats an empty or missing list as a failure, and shows a 503 sentence", async () => {
    respond(200, { items: [] });
    expect(await createFlashcards("m1", "n1")).toMatchObject({ ok: false });

    respond(200, { items: null });
    expect(await createFlashcards("m1", "n1")).toMatchObject({ ok: false });

    respond(503, { error: "The AI is unavailable right now. Please try again in a moment." });
    expect(await createFlashcards("m1", "n1")).toEqual({
      ok: false,
      message: "The AI is unavailable right now. Please try again in a moment.",
    });
  });
});

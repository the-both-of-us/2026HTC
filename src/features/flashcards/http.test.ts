import { afterEach, describe, expect, it, vi } from "vitest";
import { AiUnavailableError } from "@/features/ai";
import { FlashcardsError } from "./errors";
import { flashcardsErrorResponse, parseFlashcardsBody, parseFlashcardsQuery } from "./http";

afterEach(() => {
  vi.restoreAllMocks();
});

function post(body: string): Request {
  return new Request("http://localhost/api/flashcards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

async function catchError(work: () => unknown): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error("expected an error");
}

describe("flashcardsErrorResponse", () => {
  it("sends a FlashcardsError's own message and status", async () => {
    const response = flashcardsErrorResponse(new FlashcardsError("We could not find that map.", 404));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "We could not find that map." });
  });

  it("turns AiUnavailableError into a 503 with its sentence", async () => {
    const error = new AiUnavailableError();
    const response = flashcardsErrorResponse(error);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: error.message });
  });

  it("hides anything else behind a 500 sentence and logs it with the feature prefix", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("secret stack at /var/task/db.ts");

    const response = flashcardsErrorResponse(error);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("db.ts");
    expect(JSON.parse(text)).toEqual({ error: expect.stringMatching(/^[A-Z].+\.$/) });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[flashcards\]/), error);
  });
});

describe("parseFlashcardsQuery", () => {
  it("reads mapId and nodeId", () => {
    expect(parseFlashcardsQuery("http://localhost/api/flashcards?mapId=m1&nodeId=n1")).toEqual({
      mapId: "m1",
      nodeId: "n1",
    });
  });

  it.each([
    "http://localhost/api/flashcards?mapId=m1",
    "http://localhost/api/flashcards?nodeId=n1",
    "http://localhost/api/flashcards?mapId=&nodeId=n1",
    `http://localhost/api/flashcards?mapId=${"x".repeat(101)}&nodeId=n1`,
  ])("refuses %s with a 400 sentence", async (url) => {
    const error = await catchError(() => parseFlashcardsQuery(url));
    expect(error).toBeInstanceOf(FlashcardsError);
    expect(error).toMatchObject({ status: 400, message: expect.stringMatching(/^[A-Z].+\.$/) });
  });
});

describe("parseFlashcardsBody", () => {
  it("reads a JSON body", async () => {
    expect(await parseFlashcardsBody(post(JSON.stringify({ mapId: "m1", nodeId: "n1" })))).toEqual({
      mapId: "m1",
      nodeId: "n1",
    });
  });

  it.each(["{not json", "null", JSON.stringify({ mapId: "m1" }), JSON.stringify({ mapId: 1, nodeId: "n1" })])(
    "refuses %s with a 400",
    async (body) => {
      const error = await catchError(() => parseFlashcardsBody(post(body)));
      expect(error).toBeInstanceOf(FlashcardsError);
      expect(error).toMatchObject({ status: 400 });
    },
  );
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/shared/http";
import { AiUnavailableError } from "@/features/ai";
import { parseBody, parseQuery, quizErrorResponse } from "./http";
import { QuizError } from "./validate";

const MAP_ID = "11111111-1111-4111-8111-111111111111";

function post(body: string): Request {
  return new Request("http://localhost/api/quiz", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function expectBadRequest(attempt: Promise<unknown> | (() => unknown)) {
  const promise = typeof attempt === "function" ? Promise.resolve().then(attempt) : attempt;
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(QuizError);
  expect((error as QuizError).status).toBe(400);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseBody", () => {
  it("reads mapId and nodeId", async () => {
    await expect(parseBody(post(JSON.stringify({ mapId: MAP_ID, nodeId: "sql" })))).resolves.toEqual({
      mapId: MAP_ID,
      nodeId: "sql",
    });
  });

  it("answers 400 for bad JSON, a missing nodeId or an oversized mapId", async () => {
    await expectBadRequest(parseBody(post("{not json")));
    await expectBadRequest(parseBody(post(JSON.stringify({ mapId: MAP_ID }))));
    await expectBadRequest(parseBody(post(JSON.stringify({ mapId: "x".repeat(101), nodeId: "sql" }))));
    await expectBadRequest(parseBody(post("")));
  });
});

describe("parseQuery", () => {
  it("reads mapId and nodeId from the query string", () => {
    const request = new Request(`http://localhost/api/quiz?mapId=${MAP_ID}&nodeId=sql`);
    expect(parseQuery(request)).toEqual({ mapId: MAP_ID, nodeId: "sql" });
  });

  it("answers 400 when either is missing or too long", async () => {
    await expectBadRequest(() => parseQuery(new Request("http://localhost/api/quiz")));
    await expectBadRequest(() => parseQuery(new Request(`http://localhost/api/quiz?mapId=${MAP_ID}`)));
    await expectBadRequest(() =>
      parseQuery(new Request(`http://localhost/api/quiz?mapId=${"x".repeat(101)}&nodeId=sql`)),
    );
  });
});

describe("quizErrorResponse", () => {
  it("keeps a QuizError's status and sentence", async () => {
    const response = quizErrorResponse(new QuizError("That skill is not on this map.", 404));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "That skill is not on this map." });

    expect(quizErrorResponse(new QuizError("Try again.", 502)).status).toBe(502);
  });

  it("answers 503 with the AI's own sentence when the AI is unavailable", async () => {
    const response = quizErrorResponse(new AiUnavailableError());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: new AiUnavailableError().message });
  });

  it("answers 500 with a generic sentence and logs the real error with a [quiz] prefix", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = new Error("secret stack at /var/db/password");
    const response = quizErrorResponse(raw);

    expect(response.status).toBe(500);
    const text = await response.text();
    const body = JSON.parse(text) as { error: unknown };
    expect(typeof body.error).toBe("string");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("password");
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/^\[quiz\]/);
    expect(log.mock.calls[0]).toContain(raw);
  });

  it("does not log errors it already turned into sentences", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    quizErrorResponse(new QuizError("Nope.", 404));
    quizErrorResponse(new AiUnavailableError());
    expect(log).not.toHaveBeenCalled();
  });
});

describe("quizErrorResponse with shared errors", () => {
  it("passes a shared HttpError through with its own status and sentence, unlogged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const sentence = "We can't save your work right now because of a problem on our side. Please try again later.";
    const response = quizErrorResponse(new HttpError(sentence, 503));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: sentence });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

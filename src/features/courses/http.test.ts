import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/shared/http";
import { CoursesError } from "./errors";
import { coursesErrorResponse, parseListQuery, parseMapIdParam, parsePublishBody } from "./http";

const MAP_ID = "11111111-1111-4111-8111-111111111111";

function post(body: string): Request {
  return new Request("http://localhost/api/courses", {
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
  expect(error).toBeInstanceOf(CoursesError);
  expect((error as CoursesError).status).toBe(400);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseListQuery", () => {
  it("defaults to popular with no query", () => {
    expect(parseListQuery(new Request("http://localhost/api/courses"))).toEqual({ sort: "popular", q: "" });
    expect(parseListQuery(new Request("http://localhost/api/courses?sort="))).toEqual({ sort: "popular", q: "" });
  });

  it("reads sort and q", () => {
    expect(parseListQuery(new Request("http://localhost/api/courses?sort=new&q=sql%20joins"))).toEqual({
      sort: "new",
      q: "sql joins",
    });
  });

  it("answers 400 for an unknown sort or an absurd query", async () => {
    await expectBadRequest(() => parseListQuery(new Request("http://localhost/api/courses?sort=random")));
    await expectBadRequest(() => parseListQuery(new Request(`http://localhost/api/courses?q=${"x".repeat(1001)}`)));
  });
});

describe("parsePublishBody", () => {
  it("reads mapId and an optional authorName", async () => {
    await expect(parsePublishBody(post(JSON.stringify({ mapId: MAP_ID })))).resolves.toEqual({ mapId: MAP_ID });
    await expect(parsePublishBody(post(JSON.stringify({ mapId: MAP_ID, authorName: "Ana" })))).resolves.toEqual({
      mapId: MAP_ID,
      authorName: "Ana",
    });
    await expect(parsePublishBody(post(JSON.stringify({ mapId: MAP_ID, authorName: null })))).resolves.toEqual({
      mapId: MAP_ID,
      authorName: null,
    });
  });

  it("ignores a userId in the body", async () => {
    const body = await parsePublishBody(post(JSON.stringify({ mapId: MAP_ID, userId: "someone-else" })));
    expect(body).not.toHaveProperty("userId");
  });

  it("answers 400 for bad JSON, a missing mapId, or a name that is not text", async () => {
    await expectBadRequest(parsePublishBody(post("{not json")));
    await expectBadRequest(parsePublishBody(post("")));
    await expectBadRequest(parsePublishBody(post(JSON.stringify({ authorName: "Ana" }))));
    await expectBadRequest(parsePublishBody(post(JSON.stringify({ mapId: "x".repeat(101) }))));
    await expectBadRequest(parsePublishBody(post(JSON.stringify({ mapId: MAP_ID, authorName: 7 }))));
  });
});

describe("parseMapIdParam", () => {
  it("passes a normal id through and refuses an empty or oversized one", async () => {
    expect(parseMapIdParam(MAP_ID)).toBe(MAP_ID);
    await expectBadRequest(() => parseMapIdParam(""));
    await expectBadRequest(() => parseMapIdParam("x".repeat(101)));
  });
});

describe("coursesErrorResponse", () => {
  it("keeps a CoursesError's status and sentence, without logging it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = coursesErrorResponse(new CoursesError("You can't like your own course.", 403));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "You can't like your own course." });
    expect(log).not.toHaveBeenCalled();
  });

  it("answers 500 with a generic sentence and logs the real error with a [courses] prefix", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const raw = new Error("secret stack at /var/db/password");
    const response = coursesErrorResponse(raw);

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(typeof (JSON.parse(text) as { error: unknown }).error).toBe("string");
    expect(text).not.toContain("secret");
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/^\[courses\]/);
    expect(log.mock.calls[0]).toContain(raw);
  });
});

describe("coursesErrorResponse with shared errors", () => {
  it("passes a shared HttpError through with its own status and sentence, unlogged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const sentence = "We can't save your work right now because of a problem on our side. Please try again later.";
    const response = coursesErrorResponse(new HttpError(sentence, 503));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: sentence });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

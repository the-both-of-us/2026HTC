import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiUnavailableError } from "@/features/ai";
import { errorResponse, HttpError, parseBody } from "./http";

function jsonRequest(body: string): Request {
  return new Request("http://test/", { method: "POST", body });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseBody", () => {
  const schema = z.object({ name: z.string() });

  it("returns the validated body", async () => {
    expect(await parseBody(jsonRequest('{"name":"Ada"}'), schema)).toEqual({ name: "Ada" });
  });

  it.each([
    ["JSON of the wrong shape", '{"name":1}'],
    ["text that is not JSON", "not json"],
  ])("throws a readable 400 for %s", async (_name, body) => {
    const error = await parseBody(jsonRequest(body), schema).catch((caught) => caught);

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/could not read that request/i);
  });
});

describe("errorResponse", () => {
  it("sends an HttpError's message and status", async () => {
    const response = errorResponse(new HttpError("That skill is locked.", 403));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "That skill is locked." });
  });

  it("maps AiUnavailableError to a 503 with its own message", async () => {
    const error = new AiUnavailableError();
    const response = errorResponse(error);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: error.message });
  });

  it("never leaks an unknown error, and logs it on the server", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = errorResponse(new TypeError("fetch failed: secret-host:5432"));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret-host");
    expect(log).toHaveBeenCalledOnce();
  });

  it("uses the caller's sentence for an unknown error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = errorResponse(new Error("boom"), "Your answer was not saved.");

    expect(await response.json()).toEqual({ error: "Your answer was not saved." });
  });
});

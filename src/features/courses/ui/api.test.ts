import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseDetail, PublicCourse } from "../types";
import { fetchCourse, fetchCourses, publishCourse, setLike, startCourse, unpublishCourse } from "./api";

const COURSE: PublicCourse = {
  mapId: "m1",
  title: "Data analyst",
  subtitle: "",
  authorName: "Ana",
  skillCount: 3,
  likeCount: 2,
  isSample: false,
  publishedAt: "2026-11-07T00:00:00.000Z",
  updatedAt: "2026-11-07T00:00:00.000Z",
};

const DETAIL: CourseDetail = {
  course: COURSE,
  title: "Data analyst",
  subtitle: "",
  published: true,
  isSample: false,
  isOwner: false,
  likedByMe: false,
  myCopyId: null,
  skills: [],
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

describe("fetchCourses", () => {
  it("asks with sort and a trimmed q, and a timeout", async () => {
    respond(200, { courses: [COURSE] });
    expect(await fetchCourses("new", "  sql ")).toEqual({ ok: true, courses: [COURSE] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/courses?sort=new&q=sql");
    expect(init).toMatchObject({ method: "GET", signal: expect.any(AbortSignal) });
  });

  it("leaves q out when empty", async () => {
    respond(200, { courses: [] });
    await fetchCourses("popular", "   ");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/courses?sort=popular");
  });

  it("uses a built-in sentence for a platform page or a strange body", async () => {
    respond(504, "<html>Gateway Timeout</html>");
    const page = await fetchCourses("new", "");
    expect(page).toMatchObject({ ok: false, status: 504 });
    expect(JSON.stringify(page)).not.toContain("Gateway");

    respond(500, { error: { stack: "secret" } });
    expect(JSON.stringify(await fetchCourses("new", ""))).not.toContain("secret");

    respond(200, { courses: [{ nope: true }] });
    expect(await fetchCourses("new", "")).toMatchObject({ ok: false, message: expect.any(String) });
  });

  it("explains a timeout and a lost connection differently", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    const timedOut = await fetchCourses("new", "");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const offline = await fetchCourses("new", "");

    expect(timedOut).toMatchObject({ ok: false, status: null, message: expect.stringContaining("too long") });
    expect(offline).toMatchObject({ ok: false, message: expect.stringContaining("could not be reached") });
    expect(JSON.stringify(offline)).not.toContain("Failed to fetch");
  });
});

describe("fetchCourse", () => {
  it("returns the detail, and passes on a 404 with the server's sentence", async () => {
    respond(200, DETAIL);
    expect(await fetchCourse("m1")).toEqual({ ok: true, detail: DETAIL });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/courses/m1");

    respond(404, { error: "We could not find that course." });
    expect(await fetchCourse("m1")).toEqual({ ok: false, status: 404, message: "We could not find that course." });
  });
});

describe("publishCourse and unpublishCourse", () => {
  it("posts the map id and name, leaving out an empty name", async () => {
    respond(201, { course: COURSE });
    expect(await publishCourse("m1", " Ana ")).toEqual({ ok: true, course: COURSE });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ mapId: "m1", authorName: "Ana" });

    respond(201, { course: COURSE });
    await publishCourse("m1", "  ");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ mapId: "m1" });
  });

  it("shows the server's 403 sentence", async () => {
    respond(403, { error: "Only the person who built this map can publish it or make it private." });
    expect(await publishCourse("m1", "")).toMatchObject({ ok: false, status: 403, message: expect.stringMatching(/^Only/) });
  });

  it("unpublishes with DELETE", async () => {
    respond(200, { ok: true });
    expect(await unpublishCourse("m1")).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
  });
});

describe("setLike", () => {
  it("uses PUT to like and DELETE to unlike", async () => {
    respond(200, { liked: true, likeCount: 3 });
    expect(await setLike("m1", true)).toEqual({ ok: true, liked: true, likeCount: 3 });
    expect(fetchMock.mock.calls[0]).toEqual(["/api/courses/m1/like", expect.objectContaining({ method: "PUT" })]);

    respond(200, { liked: false, likeCount: 2 });
    await setLike("m1", false);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "DELETE" });
  });

  it("treats a strange body as a failure", async () => {
    respond(200, { liked: "yes" });
    expect(await setLike("m1", true)).toMatchObject({ ok: false });
  });
});

describe("startCourse", () => {
  const COPY = "0b7e3c1a-2f4d-4e5a-9b6c-7d8e9f0a1b2c";

  it("POSTs to the start route and returns the map to open, made now or before", async () => {
    respond(201, { mapId: COPY });
    expect(await startCourse("m/1")).toEqual({ ok: true, mapId: COPY });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/courses/m%2F1/start");
    expect(init).toMatchObject({ method: "POST", signal: expect.any(AbortSignal) });

    respond(200, { mapId: COPY });
    expect(await startCourse("m1")).toEqual({ ok: true, mapId: COPY });
  });

  it("passes the server's sentence through, with the status", async () => {
    respond(404, { error: "We could not find that course." });
    expect(await startCourse("m1")).toEqual({ ok: false, message: "We could not find that course.", status: 404 });
  });

  it("refuses an answer that is not a map id, so the page never navigates somewhere odd", async () => {
    respond(201, { mapId: "javascript:alert(1)" });
    expect(await startCourse("m1")).toMatchObject({ ok: false, message: expect.stringMatching(/could not be started/) });
  });

  it("explains a lost connection", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await startCourse("m1")).toMatchObject({ ok: false, status: null, message: expect.stringMatching(/reached/) });
  });
});

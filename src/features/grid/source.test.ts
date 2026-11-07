import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteDoc, getDoc } from "@/shared/store";
import { getGridReading, resetGridCache } from "./source";

const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/csd-2026-11-07-1316.html", import.meta.url)),
  "utf8",
);
const start = Date.parse("2026-11-07T19:17:00Z");
const fetchMock = vi.fn();

const ok = () => new Response(fixture, { status: 200 });

beforeEach(async () => {
  resetGridCache();
  await deleteDoc("grid/last-good");
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getGridReading", () => {
  it("returns a live reading", async () => {
    fetchMock.mockResolvedValue(ok());
    const reading = await getGridReading(start);
    expect(reading.status).toBe("live");
    if (reading.status === "live") {
      expect(reading.snapshot.load).toBe(10718);
      expect(reading.fetchedAt).toBe(new Date(start).toISOString());
    }
  });

  it("reads AESO only once within the minute", async () => {
    fetchMock.mockImplementation(async () => ok());
    await getGridReading(start);
    await getGridReading(start + 30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getGridReading(start + 61_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one fetch between requests that arrive together", async () => {
    fetchMock.mockImplementation(async () => ok());
    await Promise.all([getGridReading(start), getGridReading(start), getGridReading(start)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the last good reading, with its real time, when AESO fails", async () => {
    fetchMock.mockResolvedValueOnce(ok());
    await getGridReading(start);

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const reading = await getGridReading(start + 120_000);
    expect(reading.status).toBe("stale");
    if (reading.status === "stale") {
      expect(reading.snapshot.asOfLabel).toBe("Nov 07, 2026 13:16");
      expect(reading.fetchedAt).toBe(new Date(start).toISOString());
    }
  });

  it("treats an error status and an unreadable page as failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    expect((await getGridReading(start)).status).toBe("unavailable");

    fetchMock.mockResolvedValueOnce(new Response("<html>maintenance</html>", { status: 200 }));
    expect((await getGridReading(start + 20_000)).status).toBe("unavailable");
  });

  it("says unavailable, with no numbers at all, when there has never been a reading", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await getGridReading(start)).toEqual({ status: "unavailable" });
  });

  it("waits before trying a failing AESO again", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await getGridReading(start);
    await getGridReading(start + 5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getGridReading(start + 16_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("survives a restart by using the saved reading", async () => {
    fetchMock.mockResolvedValueOnce(ok());
    await getGridReading(start);
    expect(await getDoc("grid/last-good")).not.toBeNull();

    resetGridCache(); // what a new server instance starts with
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const reading = await getGridReading(start + 120_000);
    expect(reading.status).toBe("stale");
  });

  it("recovers once AESO is back", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await getGridReading(start);
    fetchMock.mockResolvedValueOnce(ok());
    expect((await getGridReading(start + 20_000)).status).toBe("live");
  });
});

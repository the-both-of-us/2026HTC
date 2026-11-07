import { afterEach, describe, expect, it, vi } from "vitest";
import raw from "./fixtures/statcan-unemployment.json";
import { clearLabourCache, getLabourSnapshot } from "./service";

const ok = () => new Response(JSON.stringify(raw), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  clearLabourCache();
});

describe("getLabourSnapshot", () => {
  it("builds a snapshot and caches it", async () => {
    const f = vi.fn(async () => ok());
    vi.stubGlobal("fetch", f);
    const a = await getLabourSnapshot();
    expect(a?.unemployment.alberta.value).toBe(7.3);
    expect(a?.referencePeriod).toBe("October 2026");
    await getLabourSnapshot();
    expect(f).toHaveBeenCalledTimes(2); // headline + wages, once
  });
  it("returns null when nothing was ever fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect(await getLabourSnapshot()).toBeNull();
  });
});

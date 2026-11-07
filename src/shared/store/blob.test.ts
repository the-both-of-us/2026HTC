import { beforeEach, describe, expect, it, vi } from "vitest";
import { put } from "@vercel/blob";
import { getDoc, putDoc } from "./index";

vi.mock("@vercel/blob", () => ({ del: vi.fn(), get: vi.fn(), list: vi.fn(), put: vi.fn() }));

beforeEach(() => {
  vi.stubEnv("S3_BUCKET", "");
  vi.mocked(put).mockClear();
});

describe("choosing a driver", () => {
  it("uses Blob when only a Blob token is set", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "blob-token");

    await putDoc("maps/one", { n: 1 });

    expect(put).toHaveBeenCalledWith("maps/one", '{"n":1}', expect.objectContaining({ access: "private" }));
  });

  it("uses memory when neither is set", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");

    await putDoc("maps/memory", { n: 1 });

    expect(put).not.toHaveBeenCalled();
    expect(await getDoc("maps/memory")).toEqual({ n: 1 });
  });
});

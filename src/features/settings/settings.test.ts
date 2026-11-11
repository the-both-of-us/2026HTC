import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDoc, putDoc } from "@/shared/store";
import { deleteAiSettings } from "./storage";

let userId: string;

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
  userId = randomUUID();
});

describe("old AI settings", () => {
  it("are removed by deleteAiSettings, so Delete my data still clears settings/<userId>", async () => {
    await putDoc(`settings/${userId}`, { speed: "fast", overrides: {} });
    await deleteAiSettings(userId);
    expect(await getDoc(`settings/${userId}`)).toBeNull();
  });

  it("ignore a user id that is not a UUID", async () => {
    await putDoc("settings/not-a-uuid", { speed: "fast" });
    await deleteAiSettings("not-a-uuid");
    expect(await getDoc("settings/not-a-uuid")).not.toBeNull();
  });
});

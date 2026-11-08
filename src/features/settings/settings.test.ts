import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDoc, putDoc } from "@/shared/store";
import { deleteAiSettings, getAiSettings, saveAiSettings, tierFor } from "./storage";
import { aiSettingsInputSchema, DEFAULT_AI_SETTINGS } from "./types";

let userId: string;

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
  userId = randomUUID();
});

describe("stored settings", () => {
  it("are Auto until something is saved, and for guests with no id", async () => {
    expect(await getAiSettings(userId)).toEqual(DEFAULT_AI_SETTINGS);
    expect(await getAiSettings(null)).toEqual(DEFAULT_AI_SETTINGS);
    expect(await getAiSettings("not-a-uuid")).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("save under settings/<userId>, leaving out Auto overrides", async () => {
    const saved = await saveAiSettings(userId, { speed: "thorough", overrides: { lesson: "opus", quiz: "auto" } });
    expect(saved).toEqual({ speed: "thorough", overrides: { lesson: "opus" } });
    expect(await getDoc(`settings/${userId}`)).toEqual(saved);
    expect(await getAiSettings(userId)).toEqual(saved);
  });

  it("fall back value by value when a stored document is out of date or damaged", async () => {
    await putDoc(`settings/${userId}`, { speed: "warp", overrides: { lesson: "gpt-9", map: "sonnet" } });
    expect(await getAiSettings(userId)).toEqual({ speed: "auto", overrides: { map: "sonnet" } });
    await putDoc(`settings/${userId}`, "nonsense");
    expect(await getAiSettings(userId)).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("are removed by deleteAiSettings", async () => {
    await saveAiSettings(userId, { speed: "fast", overrides: {} });
    await deleteAiSettings(userId);
    expect(await getDoc(`settings/${userId}`)).toBeNull();
  });

  it("decide the tier together with the course rating", async () => {
    expect(await tierFor("lesson", userId, { difficulty: 3, stakes: 3 })).toBe(4);
    await saveAiSettings(userId, { speed: "fast", overrides: {} });
    expect(await tierFor("lesson", userId, { difficulty: 3, stakes: 3 })).toBe(1);
  });
});

describe("the settings a browser may send", () => {
  it("must be known values, with no extra tasks", () => {
    expect(aiSettingsInputSchema.safeParse({ speed: "fast", overrides: { lesson: "haiku" } }).success).toBe(true);
    expect(aiSettingsInputSchema.safeParse({ speed: "warp", overrides: {} }).success).toBe(false);
    expect(aiSettingsInputSchema.safeParse({ speed: "auto", overrides: { lesson: "gpt-9" } }).success).toBe(false);
    expect(aiSettingsInputSchema.safeParse({ speed: "auto", overrides: { feed: "opus" } }).success).toBe(false);
  });
});

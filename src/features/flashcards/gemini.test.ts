import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { putDoc } from "@/shared/store";
import type { SkillMap } from "@/shared/types";
import { getOrCreateFlashcards } from "./flashcards";

/**
 * The real AI module with a fake network: proves the first request really goes to Gemini
 * when its key is set, and that generation still works through the usual order without it.
 */
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai";
const REPLY = { cards: Array.from({ length: 6 }, (_, i) => ({ front: `Question ${i + 1}?`, back: `Answer ${i + 1}.` })) };

const OWNER = randomUUID();
let mapId: string;
const fetchMock = vi.fn(async () =>
  Response.json({ choices: [{ message: { content: JSON.stringify(REPLY) } }] }),
);

beforeEach(async () => {
  for (const name of ["BLOB_READ_WRITE_TOKEN", "S3_BUCKET", "CEREBRAS_API_KEY", "VERCEL_OIDC_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_BEARER_TOKEN_BEDROCK"]) {
    vi.stubEnv(name, "");
  }
  vi.stubEnv("GROQ_API_KEY", "fake-groq-key");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();

  mapId = randomUUID();
  const map: SkillMap = {
    id: mapId,
    ownerId: OWNER,
    title: "Data analyst",
    subtitle: "",
    sourceKind: "posting",
    sourceText: "",
    nodes: [{ id: "sql-joins", title: "SQL joins", why: "Reports combine tables.", prerequisites: [], fromSource: true, citation: null, checkpoints: ["One", "Two", "Three"] }],
    createdAt: new Date().toISOString(),
  };
  await putDoc(`maps/${mapId}`, map);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function requestedUrls(): string[] {
  return fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
}

describe("flashcards asks Gemini first", () => {
  it("sends the first request to Gemini when GEMINI_API_KEY is set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "fake-gemini-key");
    await expect(getOrCreateFlashcards(mapId, "sql-joins", OWNER)).resolves.toHaveLength(6);
    expect(requestedUrls()[0]).toContain(GEMINI);
  });

  it("falls back to the usual order when Gemini has no key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(getOrCreateFlashcards(mapId, "sql-joins", OWNER)).resolves.toHaveLength(6);
    expect(requestedUrls().some((url) => url.includes(GEMINI))).toBe(false);
  });
});

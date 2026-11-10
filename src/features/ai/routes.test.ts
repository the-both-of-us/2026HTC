import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getVercelOidcToken } from "@vercel/oidc";
import { chatText } from "./index";
import { ROUTES } from "./routes";

vi.mock("@vercel/oidc", () => ({ getVercelOidcToken: vi.fn() }));

const KEYS = ["CEREBRAS_API_KEY", "GROQ_API_KEY", "VERCEL_OIDC_TOKEN", "GEMINI_API_KEY", "BEDROCK_API_KEY"];

function mockFetch() {
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({ choices: [{ message: { content: "hello" } }] }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  for (const key of KEYS) vi.stubEnv(key, "");
  // Off Vercel, the OIDC helper throws.
  vi.mocked(getVercelOidcToken).mockRejectedValue(new Error("no OIDC token"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the provider chain", () => {
  it("tries Cerebras, Groq and the gateway, with Bedrock last: gpt-oss-120b everywhere, no Gemini", () => {
    expect(ROUTES.map((route) => route.name)).toEqual(["cerebras", "groq", "gateway", "bedrock"]);
    expect(ROUTES.every((route) => route.model.includes("gpt-oss"))).toBe(true);
  });

  it("calls Bedrock's OpenAI-compatible endpoint when it has the only key", async () => {
    vi.stubEnv("BEDROCK_API_KEY", "bedrock-key");
    const fetchMock = mockFetch();

    expect(await chatText({ prompt: "Hi", label: "test" })).toBe("hello");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://bedrock-runtime.us-west-2.amazonaws.com/openai/v1/chat/completions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer bedrock-key");
    expect(JSON.parse(init?.body as string).model).toBe("openai.gpt-oss-120b-1:0");
  });

  it("skips the gateway off Vercel, when the OIDC helper throws and there is no token", async () => {
    vi.stubEnv("BEDROCK_API_KEY", "bedrock-key");
    const fetchMock = mockFetch();

    await chatText({ prompt: "Hi", label: "test" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain("bedrock-runtime");
  });
});

describe("env overrides", () => {
  it("reads the models and the Bedrock region from the environment", async () => {
    vi.stubEnv("BEDROCK_MODEL", "other.model");
    vi.stubEnv("BEDROCK_REGION", "us-east-1");
    vi.resetModules();

    const { ROUTES: fresh } = await import("./routes");

    const byName = Object.fromEntries(fresh.map((route) => [route.name, route]));
    expect(byName.bedrock.model).toBe("other.model");
    expect(byName.bedrock.baseUrl).toBe("https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1");
  });
});

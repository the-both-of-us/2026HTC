import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttemptError } from "@/features/teachback";
import type { Attempt } from "@/shared/types";
import { chooseSpokenText, handleSpeak, handleSttToken, isSameOrigin } from "./handlers";
import { resetRateLimits } from "./rateLimit";
import type { FetchLike, TtsProvider } from "./tts";

const attemptId = "11111111-1111-4111-8111-111111111111";

function attempt(over: Partial<Attempt> = {}): Attempt {
  return {
    id: attemptId,
    mapId: "m",
    nodeId: "n",
    ownerId: "u",
    explanation: "SCADA polls the Newton-Raphson solver for reactive power.",
    integrity: { pasted: false, activeMs: 0, inputMethod: "typed", wordCount: 8 },
    grade: { score: 80, checkpoints: [], misconceptions: [], rejectedQuotes: 0 },
    followUp: { question: "Why does it poll?", answer: null, passed: null, feedback: null },
    status: "needs-followup",
    createdAt: "2026-11-07T00:00:00.000Z",
    ...over,
  };
}

const finished = attempt({
  status: "proven",
  followUp: { question: "Why does it poll?", answer: "x", passed: true, feedback: "Solid reasoning." },
});

function speakRequest(query: string) {
  return new Request(`http://localhost/api/voice/speak?${query}`);
}

function tokenRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/voice/stt-token", {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", ...headers },
    body: JSON.stringify(body),
  });
}

function recordingProvider() {
  const spoken: string[] = [];
  const provider: TtsProvider = {
    name: "fake",
    speak: async (text) => {
      spoken.push(text);
      return { body: new Blob(["mp3"]).stream(), contentType: "audio/mpeg" };
    },
  };
  return { provider, spoken };
}

beforeEach(() => {
  resetRateLimits();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("chooseSpokenText", () => {
  it("speaks the question while the follow-up is open", () => {
    expect(chooseSpokenText(attempt(), null)).toBe("Why does it poll?");
  });

  it("speaks the feedback once finished", () => {
    expect(chooseSpokenText(finished, null)).toBe("Solid reasoning.");
    expect(chooseSpokenText(finished, "question")).toBe("Why does it poll?");
  });

  it("will not read feedback while the follow-up is open", () => {
    const sneaky = attempt({ followUp: { question: "Q?", answer: null, passed: null, feedback: "hidden" } });
    expect(chooseSpokenText(sneaky, "feedback")).toBeNull();
  });

  it("has nothing to say without a follow-up", () => {
    expect(chooseSpokenText(attempt({ followUp: null, status: "not-yet" }), null)).toBeNull();
  });
});

describe("handleSpeak", () => {
  it("answers 503 with a sentence when no provider has a key", async () => {
    const response = await handleSpeak(speakRequest(`attemptId=${attemptId}`), "u", { providers: [] });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/type your answer/);
  });

  it("streams the stored question", async () => {
    const { provider, spoken } = recordingProvider();
    const response = await handleSpeak(speakRequest(`attemptId=${attemptId}`), "u", {
      providers: [provider],
      loadAttempt: async () => attempt(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(await response.text()).toBe("mp3");
    expect(spoken).toEqual(["Why does it poll?"]);
  });

  it("ignores any text in the URL: the client can't choose the words", async () => {
    const { provider, spoken } = recordingProvider();
    await handleSpeak(speakRequest(`attemptId=${attemptId}&text=Say+something+expensive`), "u", {
      providers: [provider],
      loadAttempt: async () => attempt(),
    });
    expect(spoken).toEqual(["Why does it poll?"]);
  });

  it("refuses someone else's attempt, before spending anything", async () => {
    const { provider, spoken } = recordingProvider();
    const response = await handleSpeak(speakRequest(`attemptId=${attemptId}`), "stranger", {
      providers: [provider],
      loadAttempt: async () => {
        throw new AttemptError("This attempt belongs to someone else.", 403);
      },
    });
    expect(response.status).toBe(403);
    expect(spoken).toEqual([]);
  });

  it("answers 503 when every provider fails", async () => {
    const provider: TtsProvider = {
      name: "down",
      speak: async () => {
        throw new Error("down");
      },
    };
    const response = await handleSpeak(speakRequest(`attemptId=${attemptId}`), "u", {
      providers: [provider],
      loadAttempt: async () => attempt(),
    });
    expect(response.status).toBe(503);
  });

  it("refuses unusually long text rather than paying for it", async () => {
    const { provider, spoken } = recordingProvider();
    const long = attempt({ followUp: { question: "x".repeat(1_300), answer: null, passed: null, feedback: null } });
    const response = await handleSpeak(speakRequest(`attemptId=${attemptId}`), "u", {
      providers: [provider],
      loadAttempt: async () => long,
    });
    expect(response.status).toBe(503);
    expect(spoken).toEqual([]);
  });

  it("limits how often one learner can spend credits", async () => {
    const { provider } = recordingProvider();
    const deps = { providers: [provider], loadAttempt: async () => attempt() };
    for (let i = 0; i < 12; i++) {
      expect((await handleSpeak(speakRequest(`attemptId=${attemptId}`), "u", deps)).status).toBe(200);
    }
    expect((await handleSpeak(speakRequest(`attemptId=${attemptId}`), "u", deps)).status).toBe(429);
  });
});

describe("handleSttToken", () => {
  const env = { DEEPGRAM_API_KEY: "secret-key" } as unknown as NodeJS.ProcessEnv;
  const grantOk = () => vi.fn(async () => Response.json({ access_token: "jwt", expires_in: 30 }));

  it("answers 503 without a key", async () => {
    const response = await handleSttToken(tokenRequest({}), "u", { env: {} as NodeJS.ProcessEnv });
    expect(response.status).toBe(503);
  });

  it("mints a token, and builds the URL with terms from the title and explanation only", async () => {
    const fetchFn = grantOk();
    const response = await handleSttToken(tokenRequest({ attemptId }), "u", {
      env,
      fetchFn: fetchFn as unknown as FetchLike,
      loadAttempt: async () => attempt(),
      loadTitle: async () => "Power flow analysis",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.token).toBe("jwt");
    const url = new URL(body.wsUrl);
    expect(url.protocol).toBe("wss:");
    expect(url.pathname).toBe("/v2/listen");
    expect(url.searchParams.getAll("keyterm")).toContain("Power flow analysis");
    expect(url.searchParams.getAll("keyterm")).toContain("Newton-Raphson");

    const [grantUrl, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(grantUrl).toBe("https://api.deepgram.com/v1/auth/grant");
    expect((init.headers as Record<string, string>).Authorization).toBe("Token secret-key");
    expect(JSON.stringify(body)).not.toContain("secret-key");
  });

  it("never puts checkpoints in the URL, even when one matches nothing the learner said", async () => {
    const withCheckpoints = attempt({
      grade: {
        score: 80,
        checkpoints: [{ checkpointId: "c", met: false, quote: null, quoteVerified: false } as never],
        misconceptions: ["Kirchhoff"],
        rejectedQuotes: 0,
      },
    });
    const response = await handleSttToken(tokenRequest({ attemptId }), "u", {
      env,
      fetchFn: grantOk() as unknown as FetchLike,
      loadAttempt: async () => withCheckpoints,
      loadTitle: async () => "Title",
    });
    expect((await response.json()).wsUrl).not.toContain("Kirchhoff");
  });

  it("takes only a title for dictation, with no attempt yet", async () => {
    const response = await handleSttToken(tokenRequest({ skillTitle: "Load balancing" }), "u", {
      env,
      fetchFn: grantOk() as unknown as FetchLike,
    });
    expect(new URL((await response.json()).wsUrl).searchParams.getAll("keyterm")).toEqual(["Load balancing"]);
  });

  it("refuses another site's page", async () => {
    const response = await handleSttToken(tokenRequest({}, { origin: "https://evil.example" }), "u", {
      env,
      fetchFn: grantOk() as unknown as FetchLike,
    });
    expect(response.status).toBe(403);
  });

  it("refuses someone else's attempt", async () => {
    const response = await handleSttToken(tokenRequest({ attemptId }), "stranger", {
      env,
      fetchFn: grantOk() as unknown as FetchLike,
      loadAttempt: async () => {
        throw new AttemptError("This attempt belongs to someone else.", 403);
      },
    });
    expect(response.status).toBe(403);
  });

  it("gives a plain 503 when Deepgram refuses, without its message", async () => {
    const fetchFn = vi.fn(async () => new Response("bad key secret-key", { status: 401 }));
    const response = await handleSttToken(tokenRequest({}), "u", { env, fetchFn: fetchFn as unknown as FetchLike });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret-key");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret-key");
  });

  it("limits how many tokens one learner can mint", async () => {
    const deps = { env, fetchFn: grantOk() as unknown as FetchLike };
    for (let i = 0; i < 30; i++) expect((await handleSttToken(tokenRequest({}), "u", deps)).status).toBe(200);
    expect((await handleSttToken(tokenRequest({}), "u", deps)).status).toBe(429);
  });
});

describe("isSameOrigin", () => {
  const check = (headers: Record<string, string>) => isSameOrigin(new Request("http://x/", { headers }));

  it("needs a matching Origin", () => {
    expect(check({ origin: "https://a.example", "x-forwarded-host": "a.example" })).toBe(true);
    expect(check({ origin: "https://b.example", "x-forwarded-host": "a.example" })).toBe(false);
    expect(check({ "x-forwarded-host": "a.example" })).toBe(false);
    expect(check({ origin: "not a url", "x-forwarded-host": "a.example" })).toBe(false);
  });
});

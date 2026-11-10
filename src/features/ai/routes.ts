import { getVercelOidcToken } from "@vercel/oidc";

/**
 * The providers we can call, in the order we try them. All of them speak the
 * OpenAI chat API, so only these details differ.
 *
 * Every route here serves gpt-oss-120b; the only other model is Claude Sonnet, put in front by
 * the router (`claudeRoute`). Gemini was removed on Nov 9 (owner: "gpt-oss and sonnet, that's
 * it"): it went first for lessons and often failed after ~38 s with bad JSON. Bedrock is the last resort.
 */
export type RouteName = "cerebras" | "groq" | "gateway" | "bedrock" | "anthropic";

export type Route = {
  name: RouteName;
  /** "openai" speaks /chat/completions; "anthropic" speaks the Messages API. */
  api?: "openai" | "anthropic";
  baseUrl: string;
  model: string;
  /** Whether to ask this provider for its JSON mode on chatJSON calls. */
  jsonMode: boolean;
  /** Messages API settings for a Claude route: how much it thinks and how hard it tries. */
  claude?: ClaudeSettings;
  /** Returns null when this route has no credentials, so it gets skipped. */
  getToken: () => Promise<string | null>;
};

export const ROUTES: Route[] = [
  {
    name: "cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    model: "gpt-oss-120b",
    jsonMode: true,
    getToken: async () => process.env.CEREBRAS_API_KEY || null,
  },
  {
    name: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    jsonMode: false,
    getToken: async () => process.env.GROQ_API_KEY || null,
  },
  {
    name: "gateway",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    model: "openai/gpt-oss-120b",
    jsonMode: false,
    getToken: getGatewayToken,
  },
  {
    name: "bedrock",
    // The default region offers this model. ca-central-1 is not on its list.
    baseUrl: `https://bedrock-runtime.${process.env.BEDROCK_REGION || "us-west-2"}.amazonaws.com/openai/v1`,
    model: process.env.BEDROCK_MODEL || "openai.gpt-oss-120b-1:0",
    jsonMode: false,
    getToken: async () => process.env.BEDROCK_API_KEY || null,
  },
];

/**
 * On Vercel, getVercelOidcToken finds the token by itself. Locally it can fail,
 * so fall back to the one `vercel env pull` wrote to .env.local. On AWS there is
 * neither, so this returns null and the route is skipped.
 */
async function getGatewayToken(): Promise<string | null> {
  try {
    return await getVercelOidcToken();
  } catch {
    return process.env.VERCEL_OIDC_TOKEN || null;
  }
}

/**
 * How much model a call gets. 1 is the chain above (gpt-oss-120b, fast and good for general
 * material). 2, 3 and 4 put one Claude model in front of that chain: Haiku, Sonnet, Opus.
 */
export type Tier = 1 | 2 | 3 | 4;

type ClaudeTier = Exclude<Tier, 1>;

type ClaudeSettings = {
  /** Sent as `thinking`, or left out (adaptive thinking) when undefined. */
  thinking?: { type: string };
  effort: "low" | "medium" | "high";
  /** Added to max_tokens, since thinking spends from the same budget. */
  thinkingHeadroom: number;
};

/**
 * Speed first: these calls write a lesson or a map while someone waits. Haiku and Sonnet run
 * with thinking off ("between_tools" is Sonnet 5.5's off switch when no tools are sent). Opus
 * cannot turn thinking off, so it gets room for it in max_tokens. No temperature: current
 * models reject it.
 */
const CLAUDE_SETTINGS: Record<ClaudeTier, ClaudeSettings> = {
  2: { thinking: { type: "disabled" }, effort: "medium", thinkingHeadroom: 0 },
  3: { thinking: { type: "between_tools" }, effort: "medium", thinkingHeadroom: 0 },
  4: { effort: "medium", thinkingHeadroom: 8000 },
};

/** The model ids, overridable per tier so a new release needs no code change. */
const CLAUDE_MODELS: Record<ClaudeTier, { env: string; fallback: string; label: string }> = {
  2: { env: "ANTHROPIC_MODEL_HAIKU", fallback: "claude-haiku-5-5", label: "Claude Haiku" },
  3: { env: "ANTHROPIC_MODEL_SONNET", fallback: "claude-sonnet-5-5", label: "Claude Sonnet" },
  4: { env: "ANTHROPIC_MODEL_OPUS", fallback: "claude-opus-5-5", label: "Claude Opus" },
};

/** The Claude route for a tier, or null for tier 1. It is skipped like any other when ANTHROPIC_API_KEY is unset. */
export function claudeRoute(tier: Tier | undefined): Route | null {
  if (!tier || tier === 1) return null;
  const { env, fallback } = CLAUDE_MODELS[tier];
  return {
    name: "anthropic",
    api: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: process.env[env] || fallback,
    jsonMode: false,
    claude: CLAUDE_SETTINGS[tier],
    getToken: async () => process.env.ANTHROPIC_API_KEY || null,
  };
}

/** A short name for the model that wrote something, for people: "Claude Sonnet" or "gpt-oss-120b". */
export function modelLabel(model: string): string {
  const id = model.toLowerCase();
  if (id.includes("haiku")) return CLAUDE_MODELS[2].label;
  if (id.includes("sonnet")) return CLAUDE_MODELS[3].label;
  if (id.includes("opus")) return CLAUDE_MODELS[4].label;
  if (id.includes("gpt-oss")) return "gpt-oss-120b";
  if (id.includes("gemini")) return "Gemini";
  return model;
}

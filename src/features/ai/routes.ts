import { getVercelOidcToken } from "@vercel/oidc";

/**
 * The providers we can call, in the order we try them. All of them speak the
 * OpenAI chat API, so only these details differ.
 *
 * Gemini sits behind the others because grading needs speed: it was measured at
 * 4.7 to 13.2 s against under 1 s on Cerebras. Bedrock is the last resort.
 */
export type Route = {
  name: string;
  baseUrl: string;
  model: string;
  /** Whether to ask this provider for its JSON mode on chatJSON calls. */
  jsonMode: boolean;
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
    name: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    jsonMode: false,
    getToken: async () => process.env.GEMINI_API_KEY || null,
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

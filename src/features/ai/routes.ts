import { getVercelOidcToken } from "@vercel/oidc";

/**
 * The providers we can call, in the order we try them. All three speak the
 * OpenAI chat API and run the same open model, so only these details differ.
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
];

/**
 * On Vercel, getVercelOidcToken finds the token by itself. Locally it can fail,
 * so fall back to the one `vercel env pull` wrote to .env.local.
 */
async function getGatewayToken(): Promise<string | null> {
  try {
    return await getVercelOidcToken();
  } catch {
    return process.env.VERCEL_OIDC_TOKEN || null;
  }
}

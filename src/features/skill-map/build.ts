import { randomUUID } from "node:crypto";
import { chatJSON } from "@/features/ai";
import type { SkillMap, SourceKind } from "@/shared/types";
import { buildMapPrompt, MAP_SYSTEM_PROMPT, rawMapSchema, type RawSkillMap } from "./prompt";
import { cleanText, validateNodes } from "./validate";

export const MIN_POSTING_LENGTH = 80;
export const MAX_POSTING_LENGTH = 12_000;
/** Below this, the map is too thin to be worth showing. */
const MIN_USABLE_NODES = 5;

/** A problem we can explain to the user. The message is safe to show them. */
export class SkillMapError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SkillMapError";
  }
}

/** Returns the trimmed posting, or throws with a sentence the user can act on. */
export function checkPostingText(text: string): string {
  const posting = text.trim();
  if (posting.length < MIN_POSTING_LENGTH) {
    throw new SkillMapError(
      "That is too short to be a full job posting. Paste all of it, including the requirements.",
      400,
    );
  }
  if (posting.length > MAX_POSTING_LENGTH) {
    throw new SkillMapError(
      "That is too long for one job posting. Paste up to 12,000 characters, keeping the duties and requirements.",
      413,
    );
  }
  return posting;
}

/** One real model call. It can take a while, since it writes the whole map in one go. */
export async function askModelForMap(posting: string): Promise<RawSkillMap> {
  return chatJSON({
    label: "skill-map",
    system: MAP_SYSTEM_PROMPT,
    prompt: buildMapPrompt(posting),
    schema: rawMapSchema,
    maxTokens: 12_000,
    timeoutMs: 55_000,
  });
}

/** Turns model output into a finished map. Everything the model said gets checked here. */
export function buildSkillMap(
  raw: RawSkillMap,
  posting: string,
  kind: SourceKind,
  ownerId: string,
): SkillMap {
  if (!raw.isJobPosting) {
    throw new SkillMapError(
      "That does not look like a job posting. Paste one with its duties and requirements, then try again.",
      422,
    );
  }

  const nodes = validateNodes(raw.nodes, posting, kind);

  // A real posting always gives the model something to quote. Random text does not.
  const hasVerifiedCitation = nodes.some((node) => node.citation?.verified);
  if (nodes.length < MIN_USABLE_NODES || !hasVerifiedCitation) {
    throw new SkillMapError(
      "We could not find enough skills in that text. Check that it is a job posting with its duties and requirements, then try again.",
      422,
    );
  }

  return {
    id: randomUUID(),
    ownerId,
    title: cleanText(raw.title) || "Skill map",
    subtitle: cleanText(raw.subtitle),
    sourceKind: kind,
    sourceText: posting,
    nodes,
    createdAt: new Date().toISOString(),
  };
}

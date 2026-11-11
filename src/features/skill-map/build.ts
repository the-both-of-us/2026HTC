import { randomUUID } from "node:crypto";
import { chatJSON } from "@/features/ai";
import { HttpError } from "@/shared/http";
import type { SkillMap, SourceKind } from "@/shared/types";
import {
  buildMapPrompt,
  buildPdfPrompt,
  MAP_SYSTEM_PROMPT,
  pdfSystemPrompt,
  rawMapSchema,
  rawPdfMapSchema,
  buildUnitPrompt,
  rawUnitSchema,
  unitSystemPrompt,
  type RawSkillMap,
  type RawUnitMap,
  type UnitPromptInput,
} from "./prompt";
import { cleanText, validateNodes } from "./validate";

export const MIN_POSTING_LENGTH = 80;
export const MAX_POSTING_LENGTH = 12_000;
export const MIN_TOPIC_LENGTH = 2;
export const MAX_TOPIC_LENGTH = 120;
/** Below this, the map is too thin to be worth showing. */
const MIN_USABLE_NODES = 5;

/** A problem we can explain to the user. The message is safe to show them. */
export class SkillMapError extends HttpError {
  constructor(message: string, status: number) {
    super(message, status);
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

/** Returns the topic on one line, or throws with a sentence the user can act on. */
export function checkTopicText(text: string): string {
  const topic = text.replace(/\s+/g, " ").trim();
  if (topic.length < MIN_TOPIC_LENGTH) {
    throw new SkillMapError('Name a topic first, such as "SQL window functions".', 400);
  }
  if (topic.length > MAX_TOPIC_LENGTH) {
    throw new SkillMapError(
      "That is long for a topic. Name it in a few words, or paste it as a job posting instead.",
      413,
    );
  }
  return topic;
}

/** A posting or PDF map: the plan profile, 32k tokens and 100 s (design2 section A). */
const MAP_MAX_TOKENS = 32_000;
const MAP_TOTAL_MS = 100_000;

/** One real model call. It can take a while, since it writes the whole map in one go. */
export async function askModelForMap(posting: string): Promise<RawSkillMap> {
  return chatJSON({
    profile: "plan",
    label: "skill-map",
    system: MAP_SYSTEM_PROMPT,
    prompt: buildMapPrompt(posting),
    schema: rawMapSchema,
    maxTokens: MAP_MAX_TOKENS,
    totalMs: MAP_TOTAL_MS,
  });
}

/** The same call for a PDF. Each node names the page its quote is on. An audience pitches it at that level. */
export async function askModelForPdfMap(pages: string[], audience = ""): Promise<RawSkillMap> {
  const reply = await chatJSON({
    profile: "plan",
    label: "skill-map-pdf",
    system: pdfSystemPrompt(audience),
    prompt: buildPdfPrompt(pages),
    schema: rawPdfMapSchema,
    maxTokens: MAP_MAX_TOKENS,
    totalMs: MAP_TOTAL_MS,
  });
  return {
    isJobPosting: reply.hasSkills,
    title: reply.title,
    subtitle: reply.subtitle,
    nodes: reply.nodes,
  };
}

/** A unit call: the plan profile, 16k tokens, and at most 60 s for the whole call (repair separate). */
const UNIT_MAX_TOKENS = 16_000;
export const UNIT_TOTAL_MS = 60_000;

/**
 * One unit of a syllabus course. The topics are fixed, so the reply is only each node's why,
 * links and checkpoints. With `missing` set it is the repair call, asking for those topics only.
 * `totalMs` is what is left of the caller's deadline, at most UNIT_TOTAL_MS.
 */
export async function askModelForUnit(input: UnitPromptInput, totalMs: number = UNIT_TOTAL_MS): Promise<RawUnitMap> {
  const repair = Boolean(input.missing?.length);
  return chatJSON({
    profile: "plan",
    label: repair ? "skill-map-unit-repair" : "skill-map-unit",
    system: unitSystemPrompt(input.audience),
    prompt: buildUnitPrompt(input),
    schema: rawUnitSchema,
    maxTokens: UNIT_MAX_TOKENS,
    totalMs: Math.max(1_000, Math.min(UNIT_TOTAL_MS, totalMs)),
  });
}

/** What to tell the user when the model says the input is not something to learn from. */
const NOT_USABLE: Record<SourceKind, string> = {
  posting: "That does not look like a job posting. Paste one with its duties and requirements, then try again.",
  pdf: "That PDF does not seem to teach or ask for any skills. Upload course notes, a syllabus or a job description, then try again.",
  topic: 'We could not make a study plan from that. Name a skill or subject, such as "SQL window functions", then try again.',
};

/** What to tell the user when too few skills survive the checks. */
const TOO_FEW_SKILLS: Record<SourceKind, string> = {
  posting:
    "We could not find enough skills in that text. Check that it is a job posting with its duties and requirements, then try again.",
  pdf: "We could not find enough skills in that PDF that we could check against its pages. Try one with more text about the skills, such as course notes or a job description.",
  topic: "We could not build a full map for that topic. Try a broader one, then try again.",
};

/** Turns model output into a finished map. Everything the model said gets checked here. */
export function buildSkillMap(
  raw: RawSkillMap,
  source: string,
  kind: SourceKind,
  ownerId: string,
): SkillMap {
  if (!raw.isJobPosting) throw new SkillMapError(NOT_USABLE[kind], 422);

  const nodes = validateNodes(raw.nodes, source, kind);

  // A real posting or PDF always gives the model something to quote. Random text does not.
  // A topic has nothing to quote, so it is held to the node count alone.
  const hasVerifiedCitation = kind === "topic" || nodes.some((node) => node.citation?.verified);
  if (nodes.length < MIN_USABLE_NODES || !hasVerifiedCitation) {
    throw new SkillMapError(TOO_FEW_SKILLS[kind], 422);
  }

  return {
    id: randomUUID(),
    ownerId,
    title: cleanText(raw.title) || (kind === "topic" ? source : "Skill map"),
    subtitle: cleanText(raw.subtitle),
    sourceKind: kind,
    sourceText: source,
    nodes,
    createdAt: new Date().toISOString(),
  };
}

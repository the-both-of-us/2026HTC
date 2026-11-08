import { randomUUID } from "node:crypto";
import { chatJSON, type Tier } from "@/features/ai";
import { HttpError } from "@/shared/http";
import type { SkillMap, SourceKind } from "@/shared/types";
import {
  buildCoursePrompt,
  buildMapPrompt,
  buildPdfPrompt,
  buildTopicPrompt,
  courseSystemPrompt,
  type CourseContext,
  MAP_SYSTEM_PROMPT,
  pdfSystemPrompt,
  rawMapSchema,
  rawPdfMapSchema,
  rawTopicMapSchema,
  topicSystemPrompt,
  type RawSkillMap,
  type RawTopicNode,
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

/** One real model call. It can take a while, since it writes the whole map in one go. */
export async function askModelForMap(posting: string, tier?: Tier): Promise<RawSkillMap> {
  return chatJSON({
    label: "skill-map",
    system: MAP_SYSTEM_PROMPT,
    prompt: buildMapPrompt(posting),
    schema: rawMapSchema,
    maxTokens: 12_000,
    timeoutMs: 55_000,
    tier,
  });
}

/** The same call for a PDF. Each node names the page its quote is on. An audience pitches it at that level. */
export async function askModelForPdfMap(pages: string[], audience = "", tier?: Tier): Promise<RawSkillMap> {
  const reply = await chatJSON({
    label: "skill-map-pdf",
    system: pdfSystemPrompt(audience),
    prompt: buildPdfPrompt(pages),
    schema: rawPdfMapSchema,
    maxTokens: 12_000,
    timeoutMs: 55_000,
    tier,
  });
  return {
    isJobPosting: reply.hasSkills,
    title: reply.title,
    subtitle: reply.subtitle,
    nodes: reply.nodes,
    difficulty: reply.difficulty,
    stakes: reply.stakes,
  };
}

/** The same call for a topic. Nothing can be quoted, so no node counts as from the source. */
export async function askModelForTopicMap(topic: string, audience = "", tier?: Tier): Promise<RawSkillMap> {
  const reply = await chatJSON({
    label: "skill-map-topic",
    system: topicSystemPrompt(audience),
    prompt: buildTopicPrompt(topic),
    schema: rawTopicMapSchema,
    maxTokens: 12_000,
    timeoutMs: 55_000,
    tier,
  });
  return topicReplyToRaw(reply);
}

/** One course of a program. Like a topic, nothing can be quoted. */
export async function askModelForCourseMap(course: CourseContext, tier?: Tier): Promise<RawSkillMap> {
  const reply = await chatJSON({
    label: "skill-map-course",
    system: courseSystemPrompt(course.audience),
    prompt: buildCoursePrompt(course),
    schema: rawTopicMapSchema,
    maxTokens: 10_000,
    timeoutMs: 55_000,
    tier,
  });
  return topicReplyToRaw(reply);
}

/** A topic or course reply has no quotes, so every node is a foundation with no citation. */
export function topicReplyToRaw(reply: {
  isTopic: boolean;
  title: string;
  nodes: RawTopicNode[];
  difficulty?: number | null;
  stakes?: number | null;
}): RawSkillMap {
  const nodes = reply.nodes.map((node) => ({ ...node, fromSource: false, quote: null }));
  return { isJobPosting: reply.isTopic, title: reply.title, subtitle: "", nodes, difficulty: reply.difficulty, stakes: reply.stakes };
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

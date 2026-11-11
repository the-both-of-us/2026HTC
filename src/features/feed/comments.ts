import { createHash, randomBytes } from "node:crypto";
import { chatJSON } from "@/features/ai";
import { HttpError } from "@/shared/http";
import { claimDoc, deleteDoc, getDoc, listKeys, putDoc } from "@/shared/store";
import { commentProblem, cleanComment } from "./commentRules";
import { UUID_PATTERN, writeEvent } from "./events";
import { findItemTitle } from "./pool";
import { buildCommentCheckPrompt, COMMENT_CHECK_PROMPT, commentCheckSchema } from "./prompt";
import type { FeedComment } from "./types";
import { slugOfItem } from "./validate";

/**
 * Public comments on cards and Shorts. One document per comment, so two people commenting at
 * once never overwrite each other:
 *   feed-comments/<itemId>/<13-digit ms>-<8 hex>   the comment (with the author id, never sent out)
 *   feed-comment-by/<userId>/<itemId>/<same id>    the author's index, for "Delete my data"
 *   feed-comment-rate/<userId>/<minute>/<0..4>     rate-limit slots, taken with claimDoc
 * Item ids start with the interest slug, so one listing per interest counts every comment in it.
 */
const MAX_READ = 50;
const PER_MINUTE = 5;
const CHECK_TIMEOUT_MS = 4_000;
const COUNT_CACHE_MS = 60_000;
const COMMENT_ID = /^\d{13}-[0-9a-f]{8}$/;

type StoredComment = { id: string; itemId: string; authorId: string; name: string; text: string; at: string };

const globalState = globalThis as typeof globalThis & { oryxFeedCommentCounts?: Map<string, { at: number; counts: Map<string, number> }> };
const countCache = (globalState.oryxFeedCommentCounts ??= new Map());

const commentKey = (itemId: string, id: string) => `feed-comments/${itemId}/${id}`;
const authorKey = (userId: string, itemId: string, id: string) => `feed-comment-by/${userId}/${itemId}/${id}`;

/** "Guest" plus a short tag that is stable per viewer but says nothing about their id. */
export function guestName(userId: string): string {
  return `Guest ${createHash("sha256").update(`oryx-feed-guest:${userId}`).digest("hex").slice(0, 4).toUpperCase()}`;
}

const toPublic = (comment: StoredComment, viewerId: string | null): FeedComment => ({
  id: comment.id,
  name: comment.name,
  text: comment.text,
  at: comment.at,
  mine: viewerId !== null && comment.authorId === viewerId,
});

/** Comment counts for every item of one interest, from a listing at most a minute old. */
export async function commentCounts(slug: string, now = Date.now()): Promise<Map<string, number>> {
  const cached = countCache.get(slug);
  if (cached && now - cached.at < COUNT_CACHE_MS) return cached.counts;
  const counts = new Map<string, number>();
  for (const key of await listKeys(`feed-comments/${slug}.`)) {
    const itemId = key.split("/")[1];
    if (itemId) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }
  countCache.set(slug, { at: now, counts });
  return counts;
}

function touchCount(itemId: string, change: number) {
  const slug = slugOfItem(itemId);
  const counts = slug ? countCache.get(slug)?.counts : undefined;
  if (counts) counts.set(itemId, Math.max(0, (counts.get(itemId) ?? 0) + change));
}

function checkItem(itemId: string): string {
  const slug = slugOfItem(itemId);
  if (!slug) throw new HttpError("We could not find that card. Please refresh the feed.", 404);
  return slug;
}

/** The newest comments on an item, newest first, at most 50. */
export async function listComments(itemId: string, viewerId: string | null): Promise<FeedComment[]> {
  checkItem(itemId);
  const keys = (await listKeys(`feed-comments/${itemId}/`)).sort().reverse().slice(0, MAX_READ);
  const docs = await Promise.all(keys.map((key) => getDoc<StoredComment>(key)));
  return docs.filter((doc): doc is StoredComment => doc !== null).map((doc) => toPublic(doc, viewerId));
}

const AI_REFUSALS: Record<string, string> = {
  "off-topic": "That comment doesn't seem to be about this card. Say something about the idea or ask a question about it.",
  abusive: "That comment reads as unkind. Comments here have to be respectful.",
  sexual: "That comment isn't suitable here. Some learners are kids.",
  hateful: "That comment attacks a group of people, so it can't be posted.",
  "self-harm":
    "We can't post that. If you're going through something hard, please talk to someone you trust, or call or text 988 (Suicide Crisis Helpline, Canada).",
  "personal-info": "That comment has personal details. Keep names, places and contact details private.",
  spam: "That looks like spam. Write a real comment about the card.",
};

/** One cheap model check. On a failure or timeout it returns null, so the rules alone decide. */
async function aiProblem(cardTitle: string, text: string): Promise<string | null> {
  try {
    const reply = await chatJSON({
      profile: "check",
      label: "feed-comment-check",
      system: COMMENT_CHECK_PROMPT,
      prompt: buildCommentCheckPrompt(cardTitle, text),
      schema: commentCheckSchema,
      maxTokens: 60,
      totalMs: CHECK_TIMEOUT_MS,
    });
    if (reply.ok) return null;
    return AI_REFUSALS[reply.problem] ?? "That comment can't be posted here. Keep it kind, and about the card.";
  } catch (error) {
    console.warn("[feed] comment check unavailable, rules only", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Takes one of this minute's 5 slots, race-free across servers. False when all are gone. */
async function takeRateSlot(userId: string, now: number): Promise<boolean> {
  const minute = new Date(now).toISOString().slice(0, 16);
  for (let slot = 0; slot < PER_MINUTE; slot++) {
    if (await claimDoc(`feed-comment-rate/${userId}/${minute}/${slot}`, { at: new Date(now).toISOString() })) return true;
  }
  return false;
}

/**
 * Posts a comment: the rules, a rate limit of 5 a minute, then one AI check. Throws a 400 (or
 * 429) with a plain sentence when it can't be posted. Records a "comment" engagement event.
 */
export async function postComment(userId: string, displayName: string | null, itemId: string, raw: string, now = Date.now()): Promise<FeedComment> {
  if (!UUID_PATTERN.test(userId)) throw new HttpError("Please refresh the page and try again.", 400);
  const slug = checkItem(itemId);
  const problem = commentProblem(raw);
  if (problem) throw new HttpError(problem, 400);
  const title = await findItemTitle(slug, itemId);
  if (title === null) throw new HttpError("We could not find that card. Please refresh the feed.", 404);
  if (!(await takeRateSlot(userId, now))) throw new HttpError("You're commenting quickly. Wait a minute, then try again.", 429);

  const text = cleanComment(raw);
  const refusal = await aiProblem(title, text);
  if (refusal) throw new HttpError(refusal, 400);

  const id = `${String(now).padStart(13, "0")}-${randomBytes(4).toString("hex")}`;
  const name = displayName?.replace(/\s+/g, " ").trim().slice(0, 40) || guestName(userId);
  const comment: StoredComment = { id, itemId, authorId: userId, name, text, at: new Date(now).toISOString() };
  await putDoc(commentKey(itemId, id), comment);
  await Promise.all([putDoc(authorKey(userId, itemId, id), { at: comment.at }), writeEvent(userId, itemId, "comment")]);
  touchCount(itemId, 1);
  return toPublic(comment, userId);
}

/** Deletes one of the viewer's own comments. Someone else's, or a missing one, is a 404. */
export async function deleteComment(userId: string, itemId: string, commentId: string): Promise<void> {
  checkItem(itemId);
  const missing = new HttpError("We could not find that comment. It may already be deleted.", 404);
  if (!UUID_PATTERN.test(userId) || !COMMENT_ID.test(commentId)) throw missing;
  const comment = await getDoc<StoredComment>(commentKey(itemId, commentId));
  if (!comment || comment.authorId !== userId) throw missing;
  await Promise.all([deleteDoc(commentKey(itemId, commentId)), deleteDoc(authorKey(userId, itemId, commentId))]);
  touchCount(itemId, -1);
}

/** For "Delete my data": every comment this viewer wrote, and their rate-limit slots. Running it twice is harmless. */
export async function deleteViewerComments(userId: string): Promise<void> {
  if (!UUID_PATTERN.test(userId)) return;
  const [mine, slots] = await Promise.all([listKeys(`feed-comment-by/${userId}/`), listKeys(`feed-comment-rate/${userId}/`)]);
  await Promise.all([
    ...mine.flatMap((key) => {
      const [, , itemId, id] = key.split("/");
      return [deleteDoc(key), itemId && id ? deleteDoc(commentKey(itemId, id)) : Promise.resolve()];
    }),
    ...slots.map((key) => deleteDoc(key)),
  ]);
  if (mine.length > 0) countCache.clear();
}

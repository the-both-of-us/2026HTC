import { createHash, randomBytes } from "node:crypto";
import { copySkillMap, deriveNodeStates, deleteSkillMap, getSkillMap, toPublicMap, type PublicSkillMap } from "@/features/skill-map";
import { listProvedNodes } from "@/features/teachback";
import { HttpError } from "@/shared/http";
import type { NodeState } from "@/shared/types";
import { claimDoc, deleteDoc, getDoc, listKeys, putDoc } from "@/shared/store";

/**
 * Study circles: a group learns the same map together. Each member proves skills on their
 * own copy, and the circle page shows who proved what. Explanations are never shared.
 *
 * Keys: circles/<code> holds the circle, circles/<code>/members/<userId> one member, and
 * circles/<code>/cheers/<itemId>/<userId> one cheer on one proof.
 * The user id only ever appears in a key, never in what the API returns.
 */

export class CircleError extends HttpError {
  name = "CircleError";
}

type Circle = { code: string; title: string; sourceMapId: string; createdBy: string; createdAt: string };
type Member = { name: string; mapId: string; joinedAt: string };
type Cheer = { name: string; at: string };

export type CircleMember = { name: string; proved: number; isYou: boolean };
/** One proof in the feed. `id` is a hash, so it names the proof without naming its user. */
export type CircleActivity = {
  id: string;
  name: string;
  nodeId: string;
  nodeTitle: string;
  at: string;
  /** The viewer proved this one, so it can't be cheered by them. */
  isYou: boolean;
  cheers: number;
  youCheered: boolean;
  /** A pre-test pass, not an explanation: show "Known: passed a pre-test question". */
  pretest?: true;
};
/** Who proved a skill on the shared map: initials on the card, names in its tooltip. */
export type CircleAvatar = { initials: string; name: string; pretest?: true };
/** A cheer on one of the viewer's own proofs. */
export type CircleCheer = { id: string; name: string; nodeTitle: string; at: string };

/** What GET /api/circles/<code> returns: names, skills and times only. */
export type CircleView = {
  code: string;
  title: string;
  /** Only what the read-only map needs: no map id, so no one's copy can be found from here. */
  map: Pick<PublicSkillMap, "nodes" | "sourceKind">;
  members: CircleMember[];
  feed: CircleActivity[];
  /** The members who proved each skill, in the order they joined, for the map. */
  provedBy: Record<string, CircleAvatar[]>;
  /**
   * What each skill looks like on the shared map: proven once anyone proved it, otherwise open
   * or locked by the viewer's own progress (a visitor who has not joined has proved nothing).
   */
  states: Record<string, NodeState>;
  /** The viewer's own copy, only when they are a member. */
  yourMapId: string | null;
  /** Cheers on the viewer's own proofs, newest first. Empty for a visitor. */
  cheersForYou: CircleCheer[];
};

/** 10 base32 characters is 50 random bits: short enough to type, far too many to guess. */
const CODE_PATTERN = /^[a-z2-7]{10}$/;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
export const MAX_NAME_LENGTH = 24;

function newCode(): string {
  return Array.from(randomBytes(10), (byte) => BASE32[byte % 32]).join("");
}

const circleKey = (code: string) => `circles/${code}`;
const memberKey = (code: string, userId: string) => `circles/${code}/members/${userId}`;
const cheersPrefix = (code: string) => `circles/${code}/cheers/`;
const cheerKey = (code: string, itemId: string, userId: string) => `${cheersPrefix(code)}${itemId}/${userId}`;

/** 16 base64url characters of a hash: names one proof in one circle without its user id. */
const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;
function proofItemId(code: string, userId: string, nodeId: string): string {
  return createHash("sha256").update(`circle-proof:${code}:${userId}:${nodeId}`).digest("base64url").slice(0, 16);
}

function checkName(name: string): string {
  // Control and invisible characters go, so nobody can join as a blank name.
  const trimmed = name.replace(/\p{C}/gu, "").trim();
  if (trimmed.length < 1 || trimmed.length > MAX_NAME_LENGTH) {
    throw new CircleError(`Please use a name between 1 and ${MAX_NAME_LENGTH} characters.`, 400);
  }
  return trimmed;
}

/** Codes are lower case, but a code typed in capitals still finds its circle. */
async function getCircle(code: string): Promise<Circle | null> {
  const clean = code.toLowerCase();
  if (!CODE_PATTERN.test(clean)) return null;
  return getDoc<Circle>(circleKey(clean));
}

async function loadCircle(code: string): Promise<Circle> {
  const circle = await getCircle(code);
  if (!circle) throw new CircleError("We could not find that circle. Check the link, or ask for a new one.", 404);
  return circle;
}

/** Every circle code, read from the keys: circles/<code> has exactly two parts. */
async function listCircleCodes(): Promise<string[]> {
  return (await listKeys("circles/")).map((key) => key.split("/")).filter((parts) => parts.length === 2).map((parts) => parts[1]);
}

/** Every member's user id and record, read from circles/<code>/members/<userId>. */
async function listMembers(code: string): Promise<{ userId: string; member: Member }[]> {
  const keys = await listKeys(`circles/${code}/members/`);
  const rows = await Promise.all(
    keys.map(async (key) => ({ userId: key.split("/")[3], member: await getDoc<Member>(key) })),
  );
  return rows.filter((row): row is { userId: string; member: Member } => row.member !== null);
}

/**
 * Starts a circle for a map its owner holds, with the owner as the first member on their own map.
 * Starting again for the same map returns the circle that already exists.
 */
export async function startCircle(userId: string, mapId: string, name: string): Promise<{ code: string; title: string }> {
  const ownerName = checkName(name);
  const map = await getSkillMap(mapId);
  if (!map || map.ownerId !== userId) {
    throw new CircleError("Only the person who built this map can start a circle for it.", 404);
  }

  const now = new Date().toISOString();
  for (const code of await listCircleCodes()) {
    const existing = await getDoc<Circle>(circleKey(code));
    if (existing?.createdBy === userId && existing.sourceMapId === mapId) {
      const joinedAt = (await getDoc<Member>(memberKey(code, userId)))?.joinedAt ?? now;
      await putDoc(memberKey(code, userId), { name: ownerName, mapId, joinedAt } satisfies Member);
      forget(code);
      return { code, title: existing.title };
    }
  }

  const circle: Circle = { code: newCode(), title: map.title, sourceMapId: mapId, createdBy: userId, createdAt: now };
  if (!(await claimDoc(circleKey(circle.code), circle))) {
    throw new CircleError("That took a wrong turn on our side. Please try again.", 409);
  }
  const member: Member = { name: ownerName, mapId, joinedAt: now };
  await putDoc(memberKey(circle.code, userId), member);
  return { code: circle.code, title: circle.title };
}

/**
 * Joins a circle: the joiner gets their own copy of the map. Joining again returns the same copy,
 * and two joins at once still make only one membership.
 */
export async function joinCircle(userId: string, code: string, name: string): Promise<{ mapId: string }> {
  const memberName = checkName(name);
  const circle = await loadCircle(code);
  code = circle.code;
  forget(code);

  const existing = await getDoc<Member>(memberKey(code, userId));
  if (existing && (await getSkillMap(existing.mapId))) {
    if (existing.name !== memberName) await putDoc(memberKey(code, userId), { ...existing, name: memberName });
    return { mapId: existing.mapId };
  }

  const copy = await copySkillMap(circle.sourceMapId, userId);
  const member: Member = { name: memberName, mapId: copy.id, joinedAt: new Date().toISOString() };
  if (existing) {
    await putDoc(memberKey(code, userId), member);
  } else if (!(await claimDoc(memberKey(code, userId), member))) {
    // Another join for this person got there first: keep theirs and drop this copy.
    await deleteSkillMap(copy.id);
    const winner = await getDoc<Member>(memberKey(code, userId));
    return { mapId: winner?.mapId ?? copy.id };
  }
  return { mapId: copy.id };
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => (Array.from(word)[0] ?? "").toUpperCase())
    .join("");
}

/** Everything a circle page needs, read from the store. It holds user ids, so it never leaves the server. */
async function readCircle(code: string) {
  const circle = await loadCircle(code);
  const source = await getSkillMap(circle.sourceMapId);
  if (!source) throw new CircleError("This circle's map was deleted, so the circle has closed.", 404);

  const rows = await listMembers(circle.code);
  rows.sort((a, b) => a.member.joinedAt.localeCompare(b.member.joinedAt));
  const [proved, cheerKeys] = await Promise.all([
    Promise.all(rows.map((row) => listProvedNodes(row.member.mapId, row.userId))),
    listKeys(cheersPrefix(circle.code)),
  ]);
  // circles/<code>/cheers/<itemId>/<userId>
  const cheers = cheerKeys
    .map((key) => key.split("/"))
    .filter((parts) => parts.length === 5)
    .map((parts) => ({ key: parts.join("/"), itemId: parts[3], userId: parts[4] }));
  return { circle, source, rows, proved, cheers };
}

/** A cheer never changes once made, so each server reads each one once. */
const cheerDocs = new Map<string, Cheer>();
async function readCheer(key: string): Promise<Cheer | null> {
  const known = cheerDocs.get(key);
  if (known) return known;
  const cheer = await getDoc<Cheer>(key);
  if (cheer) cheerDocs.set(key, cheer);
  return cheer;
}

/**
 * A projector and every phone in the room poll the same circle every few seconds. Each server
 * keeps one read per circle for CACHE_MS, so 30 screens cost about one store read, not 30.
 */
const CACHE_MS = 1500;
const recentReads = new Map<string, { at: number; read: ReturnType<typeof readCircle> }>();

function readCircleCached(code: string): ReturnType<typeof readCircle> {
  const now = Date.now();
  for (const [key, entry] of recentReads) if (now - entry.at >= CACHE_MS) recentReads.delete(key);
  const hit = recentReads.get(code);
  if (hit) return hit.read;
  const read = readCircle(code);
  recentReads.set(code, { at: now, read });
  read.catch(() => forget(code));
  return read;
}

/** After a join or a change, the next read goes to the store. */
function forget(code: string): void {
  recentReads.delete(code.toLowerCase());
}

/** The circle as anyone with its link sees it. `viewerId` only decides isYou and yourMapId. */
export async function getCircleView(code: string, viewerId: string | null): Promise<CircleView> {
  const { circle, source, rows, proved, cheers } = await readCircleCached(code.toLowerCase());

  const cheerCount = new Map<string, number>();
  for (const cheer of cheers) cheerCount.set(cheer.itemId, (cheerCount.get(cheer.itemId) ?? 0) + 1);
  const cheeredByYou = new Set(cheers.filter((cheer) => cheer.userId === viewerId).map((cheer) => cheer.itemId));

  const titles = new Map(source.nodes.map((node) => [node.id, node.title]));
  const provedBy: Record<string, CircleAvatar[]> = {};
  const feed: CircleActivity[] = [];
  const yourItems = new Map<string, string>();
  rows.forEach((row, index) => {
    const isYou = row.userId === viewerId;
    for (const { nodeId, provenAt, pretest } of proved[index]) {
      const nodeTitle = titles.get(nodeId);
      if (!nodeTitle) continue;
      const id = proofItemId(circle.code, row.userId, nodeId);
      if (isYou) yourItems.set(id, nodeTitle);
      (provedBy[nodeId] ??= []).push({ initials: initials(row.member.name), name: row.member.name, ...(pretest && { pretest }) });
      feed.push({
        ...(pretest && { pretest }),
        id,
        name: row.member.name,
        nodeId,
        nodeTitle,
        at: provenAt,
        isYou,
        cheers: cheerCount.get(id) ?? 0,
        youCheered: cheeredByYou.has(id),
      });
    }
  });
  feed.sort((a, b) => b.at.localeCompare(a.at));

  // Cheers on the viewer's own proofs, for "Lee cheered your proof".
  const forYou = cheers.filter((cheer) => yourItems.has(cheer.itemId));
  const cheersForYou = (
    await Promise.all(
      forYou.map(async (cheer) => {
        const doc = await readCheer(cheer.key);
        if (!doc) return null;
        const id = createHash("sha256").update(cheer.key).digest("base64url").slice(0, 12);
        return { id, name: doc.name, nodeTitle: yourItems.get(cheer.itemId) ?? "", at: doc.at };
      }),
    )
  )
    .filter((cheer): cheer is CircleCheer => cheer !== null)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10);

  const you = rows.find((row) => row.userId === viewerId);
  const yourProven = Object.fromEntries(
    (you ? proved[rows.indexOf(you)] : []).filter(({ nodeId }) => titles.has(nodeId)).map(({ nodeId }) => [nodeId, "x"]),
  );
  const states = deriveNodeStates(source, { proven: yourProven });
  for (const nodeId of Object.keys(provedBy)) if (nodeId in states) states[nodeId] = "proven";
  return {
    code: circle.code,
    title: circle.title,
    map: { nodes: toPublicMap(source).nodes, sourceKind: source.sourceKind },
    members: rows.map((row, index) => ({
      name: row.member.name,
      proved: proved[index].filter(({ nodeId }) => titles.has(nodeId)).length,
      isYou: row.userId === viewerId,
    })),
    feed: feed.slice(0, 30),
    provedBy,
    states,
    yourMapId: you?.member.mapId ?? null,
    cheersForYou,
  };
}

/**
 * One cheer from a member on someone else's proof. Cheering twice counts once, because the
 * key holds the cheerer. Returns the proof's new count.
 */
export async function cheerProof(userId: string, code: string, itemId: string): Promise<{ cheers: number }> {
  const circle = await loadCircle(code);
  const notFound = new CircleError("That proof is not in this circle any more. Refresh the page.", 404);
  if (!ITEM_ID_PATTERN.test(itemId)) throw notFound;

  const member = await getDoc<Member>(memberKey(circle.code, userId));
  if (!member) throw new CircleError("Join the circle to cheer its proofs.", 403);

  const { rows, proved } = await readCircleCached(circle.code);
  const owner = rows.find((row, index) =>
    proved[index].some(({ nodeId }) => proofItemId(circle.code, row.userId, nodeId) === itemId),
  );
  if (!owner) throw notFound;
  if (owner.userId === userId) throw new CircleError("That one is yours. Cheer someone else's proof.", 400);

  const cheer: Cheer = { name: member.name, at: new Date().toISOString() };
  await claimDoc(cheerKey(circle.code, itemId, userId), cheer);
  forget(circle.code);
  return { cheers: (await listKeys(`${cheersPrefix(circle.code)}${itemId}/`)).length };
}

/** For the map page's banner: the circle this map belongs to, if its owner is a member. */
export async function findCircleForMap(mapId: string, userId: string): Promise<{ code: string; title: string } | null> {
  const keys = (await listKeys("circles/")).filter((key) => key.endsWith(`/members/${userId}`));
  for (const key of keys) {
    const member = await getDoc<Member>(key);
    if (member?.mapId !== mapId) continue;
    const circle = await getCircle(key.split("/")[1]);
    if (circle) return { code: circle.code, title: circle.title };
  }
  return null;
}

/**
 * For "Delete my data": leaves every circle this user joined, and closes the circles they started.
 * Members' own map copies are theirs and stay. Safe to run twice.
 */
export async function deleteCircleData(userId: string): Promise<{ circles: number; memberships: number; cheers: number }> {
  const keys = await listKeys("circles/");
  const parts = (key: string) => key.split("/");
  const memberships = keys.filter((key) => parts(key)[2] === "members" && parts(key)[3] === userId);
  const cheersGiven = keys.filter((key) => parts(key)[2] === "cheers" && parts(key)[4] === userId);

  let circles = 0;
  for (const code of await listCircleCodes()) {
    const circle = await getDoc<Circle>(circleKey(code));
    if (circle?.createdBy !== userId) continue;
    // Closing a circle takes its members and cheers with it.
    const inside = keys.filter((key) => key.startsWith(`circles/${code}/`));
    await Promise.all(inside.map((key) => deleteDoc(key)));
    await deleteDoc(circleKey(code));
    forget(code);
    circles += 1;
  }
  await Promise.all([...memberships, ...cheersGiven].map((key) => deleteDoc(key)));
  [...memberships, ...cheersGiven].forEach((key) => {
    cheerDocs.delete(key);
    forget(parts(key)[1]);
  });
  return { circles, memberships: memberships.length, cheers: cheersGiven.length };
}

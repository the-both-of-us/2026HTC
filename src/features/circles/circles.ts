import { randomBytes } from "node:crypto";
import { copySkillMap, deleteSkillMap, getSkillMap, toPublicMap, type PublicSkillMap } from "@/features/skill-map";
import { listProvedNodes } from "@/features/teachback";
import { HttpError } from "@/shared/http";
import { claimDoc, deleteDoc, getDoc, listKeys, putDoc } from "@/shared/store";

/**
 * Study circles: a group learns the same map together. Each member proves skills on their
 * own copy, and the circle page shows who proved what. Explanations are never shared.
 *
 * Keys: circles/<code> holds the circle, circles/<code>/members/<userId> one member.
 * The user id only ever appears in a key, never in what the API returns.
 */

export class CircleError extends HttpError {
  name = "CircleError";
}

type Circle = { code: string; title: string; sourceMapId: string; createdBy: string; createdAt: string };
type Member = { name: string; mapId: string; joinedAt: string };

export type CircleMember = { name: string; proved: number; isYou: boolean };
export type CircleActivity = { name: string; nodeId: string; nodeTitle: string; at: string };

/** What GET /api/circles/<code> returns: names, skills and times only. */
export type CircleView = {
  code: string;
  title: string;
  /** Only what the read-only map needs: no map id, so no one's copy can be found from here. */
  map: Pick<PublicSkillMap, "nodes" | "sourceKind">;
  members: CircleMember[];
  feed: CircleActivity[];
  /** Initials of the members who proved each skill, for the map. */
  provedBy: Record<string, string[]>;
  /** The viewer's own copy, only when they are a member. */
  yourMapId: string | null;
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

function checkName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_NAME_LENGTH) {
    throw new CircleError(`Please use a name between 1 and ${MAX_NAME_LENGTH} characters.`, 400);
  }
  return trimmed;
}

async function getCircle(code: string): Promise<Circle | null> {
  if (!CODE_PATTERN.test(code)) return null;
  return getDoc<Circle>(circleKey(code));
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
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

/** The circle as anyone with its link sees it. `viewerId` only decides isYou and yourMapId. */
export async function getCircleView(code: string, viewerId: string | null): Promise<CircleView> {
  const circle = await loadCircle(code);
  const source = await getSkillMap(circle.sourceMapId);
  if (!source) throw new CircleError("This circle's map was deleted, so the circle has closed.", 404);

  const rows = await listMembers(code);
  rows.sort((a, b) => a.member.joinedAt.localeCompare(b.member.joinedAt));
  const proved = await Promise.all(rows.map((row) => listProvedNodes(row.member.mapId, row.userId)));

  const titles = new Map(source.nodes.map((node) => [node.id, node.title]));
  const provedBy: Record<string, string[]> = {};
  const feed: CircleActivity[] = [];
  rows.forEach((row, index) => {
    for (const { nodeId, provenAt } of proved[index]) {
      const nodeTitle = titles.get(nodeId);
      if (!nodeTitle) continue;
      (provedBy[nodeId] ??= []).push(initials(row.member.name));
      feed.push({ name: row.member.name, nodeId, nodeTitle, at: provenAt });
    }
  });
  feed.sort((a, b) => b.at.localeCompare(a.at));

  const you = rows.find((row) => row.userId === viewerId);
  return {
    code,
    title: circle.title,
    map: { nodes: toPublicMap(source).nodes, sourceKind: source.sourceKind },
    members: rows.map((row, index) => ({
      name: row.member.name,
      proved: proved[index].filter(({ nodeId }) => titles.has(nodeId)).length,
      isYou: row.userId === viewerId,
    })),
    feed: feed.slice(0, 30),
    provedBy,
    yourMapId: you?.member.mapId ?? null,
  };
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
export async function deleteCircleData(userId: string): Promise<{ circles: number; memberships: number }> {
  const keys = await listKeys("circles/");
  const memberships = keys.filter((key) => key.split("/")[3] === userId);

  let circles = 0;
  for (const code of await listCircleCodes()) {
    const circle = await getDoc<Circle>(circleKey(code));
    if (circle?.createdBy !== userId) continue;
    const memberKeys = keys.filter((key) => key.startsWith(`circles/${code}/members/`));
    await Promise.all(memberKeys.map((key) => deleteDoc(key)));
    await deleteDoc(circleKey(code));
    circles += 1;
  }
  await Promise.all(memberships.map((key) => deleteDoc(key)));
  return { circles, memberships: memberships.length };
}

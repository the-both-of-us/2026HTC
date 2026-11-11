/** Join, leave, and the page's view: who could mentor you and who is learning the same skills. */
import { ensureDemoProfiles } from "./demo";
import { NetworkError } from "./errors";
import { groupMatches, matchProfile } from "./matching";
import {
  addFriendship,
  areFriends,
  deleteFriendData,
  getInvite as getInviteRecord,
  listFriendIds,
  ownInviteCode,
  removeFriendship,
} from "./friends";
import { deleteProfile, getProfile, isInNetwork, listProfiles, saveProfile, setProfileInNetwork } from "./profiles";
import { checkProfileInput, firstError } from "./rules";
import { assertUserId, requireJoiner, viewerAccess } from "./session";
import { computeSkills, demoSkillSet, NO_SKILLS } from "./skills";
import {
  deleteSocialData,
  friendCourses,
  listFriendRequests,
  listPings,
  outgoingRequestIds,
  privacyOf,
  setPrivacy,
} from "./social";
import type {
  InviteView,
  Match,
  MyProfileView,
  NetworkView,
  ProfileInput,
  ProfileRecord,
  PublicProfile,
  PrivacySettings,
  SkillSet,
} from "./types";

/**
 * Worked out fresh on every listing, so a skill proved a moment ago shows, and a revoked
 * evidence page loses its link at once. Each profile is listed once, so nothing is reused.
 */
function skillsOf(record: ProfileRecord): Promise<SkillSet> {
  // Only a seeded demo profile's skills come from its record. A real one's are always computed.
  if (record.isDemo) return Promise.resolve(demoSkillSet(record.demo));
  return computeSkills(record.userId);
}

/** Builds the public shape field by field, so a server-only field can never slip through. */
export function toPublicProfile(record: ProfileRecord, skills: SkillSet): PublicProfile {
  return {
    publicId: record.publicId,
    displayName: record.displayName,
    city: record.city,
    lookingFor: record.lookingFor,
    contactUrl: record.isDemo ? null : record.contactUrl,
    isDemo: record.isDemo,
    provenSkills: skills.proven.map((skill) => ({
      title: skill.title,
      mapTitle: skill.mapTitle,
      evidenceUrl: skill.evidenceUrl,
      ...(skill.pretest && { pretest: true as const }),
    })),
    joinedAt: record.joinedAt,
  };
}

function toMyProfile(record: ProfileRecord, skills: SkillSet): MyProfileView {
  return {
    publicId: record.publicId,
    displayName: record.displayName,
    city: record.city,
    lookingFor: record.lookingFor,
    contactUrl: record.contactUrl,
    joinedAt: record.joinedAt,
    updatedAt: record.updatedAt,
    inNetwork: isInNetwork(record),
    provenSkills: skills.proven.map((skill) => ({ ...skill })),
    learning: [...skills.learning],
    ...privacyOf(record),
  };
}

/**
 * People who share a proven skill with the viewer first (best first), then real people,
 * newest first, then the demo profiles in their seeded order of names.
 */
function directoryOrder(left: Match, right: Match): number {
  const a = left.profile;
  const b = right.profile;
  return (
    right.score - left.score ||
    Number(a.isDemo) - Number(b.isDemo) ||
    (a.isDemo ? 0 : b.joinedAt.localeCompare(a.joinedAt)) ||
    a.displayName.localeCompare(b.displayName)
  );
}

/**
 * Everything /people shows to this viewer.
 *
 * - Friends always show, whatever either side's network setting.
 * - Opted out (the default): nobody else at all.
 * - Opted in: everyone else who opted in (and the demo profiles), matched by skills.
 *
 * Matching needs the viewer to have a profile or at least one map.
 */
export async function getNetwork(userId: string): Promise<NetworkView> {
  assertUserId(userId);
  const [profiles, viewer, access, friendIds, friendRequests, pings] = await Promise.all([
    listProfiles(),
    computeSkills(userId),
    viewerAccess(),
    listFriendIds(userId),
    listFriendRequests(userId),
    listPings(userId),
  ]);
  const mine = profiles.find((profile) => profile.userId === userId && !profile.isDemo) ?? null;
  const viewerIn = mine !== null && isInNetwork(mine);
  const friendSet = new Set(friendIds);
  const isFriend = (record: ProfileRecord) =>
    !record.isDemo && record.userId !== userId && friendSet.has(record.userId);

  const inView = (record: ProfileRecord) => record.userId !== userId && !isFriend(record) && isInNetwork(record);
  // Friends only: nobody outside your friends is read, let alone listed.
  let others: ProfileRecord[] = [];
  if (viewerIn) {
    let listed = profiles;
    try {
      // The demo profiles are a nicety, only seen in the network. Real profiles still list without them.
      await ensureDemoProfiles();
      if (!profiles.some((record) => record.isDemo)) listed = await listProfiles();
    } catch (error) {
      console.error("[network] could not seed the demo profiles", error);
    }
    others = listed.filter(inView);
  }

  const canMatch = mine !== null || viewer.hasMaps;
  const matchAll = (records: ProfileRecord[]) =>
    Promise.all(
      records.map(async (record) => {
        const skills = await skillsOf(record);
        return matchProfile(canMatch ? viewer : NO_SKILLS, skills, toPublicProfile(record, skills));
      }),
    );
  const friendRecords = profiles.filter(isFriend);
  const realOthers = others.filter((record) => !record.isDemo);
  const [friendMatches, otherMatches, sent, courses] = await Promise.all([
    matchAll(friendRecords),
    matchAll(others),
    mine ? outgoingRequestIds(userId, realOthers.map((record) => record.userId)) : Promise.resolve(new Set<string>()),
    Promise.all(friendRecords.map((record) => friendCourses(record))),
  ]);
  const friends = friendMatches.map((match, index) => ({
    ...match,
    canPing: mine !== null && privacyOf(friendRecords[index]).allowPings,
    courses: courses[index],
  }));
  const matches = otherMatches.map((match, index) => {
    const record = others[index];
    if (record.isDemo || !mine) return match;
    return { ...match, canRequest: privacyOf(record).allowRequests, requestSent: sent.has(record.userId) };
  });
  const { mentors, peers, rest } = canMatch ? groupMatches(matches) : { mentors: [], peers: [], rest: matches };

  return {
    me: mine ? toMyProfile(mine, viewer) : null,
    inNetwork: viewerIn,
    friends: friends.sort(directoryOrder),
    mentors,
    peers,
    everyone: [...rest].sort(directoryOrder),
    friendRequests,
    pings,
    viewerHasMaps: viewer.hasMaps,
    signedIn: access.signedIn,
    signInRequired: access.signInRequired,
    displayName: access.displayName,
  };
}

/**
 * Creates or updates the viewer's profile. Signed in, once Auth0 is set up. `inNetwork`
 * opts in or out at the same time; left out, the profile keeps its setting.
 */
export async function joinNetwork(userId: string, input: ProfileInput): Promise<MyProfileView> {
  await requireJoiner(userId);
  const checked = checkProfileInput(input);
  if (!checked.ok) throw new NetworkError(firstError(checked.errors), 400);
  const record = await saveProfile(userId, checked.value, input.inNetwork ?? undefined);
  return toMyProfile(record, await computeSkills(userId));
}

const MAKE_PROFILE_FIRST = "Make your profile first, so people know who you are.";

/**
 * Opts in to the network, or out of it. Opting in needs a profile (and a sign-in, once Auth0
 * is set up). Opting out never needs a sign-in, hides you from the network at once, and
 * keeps your friends.
 */
export async function setInNetwork(userId: string, inNetwork: boolean): Promise<MyProfileView | null> {
  if (inNetwork) await requireJoiner(userId);
  else assertUserId(userId);
  const record = await setProfileInNetwork(userId, inNetwork);
  if (!record && inNetwork) throw new NetworkError(MAKE_PROFILE_FIRST, 400);
  return record ? toMyProfile(record, await computeSkills(userId)) : null;
}

/** Saves the friends and privacy settings. Needs a profile; never needs a sign-in. */
export async function setPrivacySettings(
  userId: string,
  settings: Partial<PrivacySettings>,
): Promise<MyProfileView> {
  const record = await setPrivacy(userId, settings);
  return toMyProfile(record, await computeSkills(userId));
}

/**
 * Deletes the viewer's profile, their friend links (both ways) and their invite link.
 * Never needs a sign-in, and deleting twice is fine.
 */
export async function leaveNetwork(userId: string): Promise<void> {
  assertUserId(userId);
  await deleteFriendData(userId);
  await deleteSocialData(userId);
  await deleteProfile(userId);
}

/** The viewer's invite code: the same each time, or a new one with `fresh`, which retires the old link. */
export async function createInvite(userId: string, fresh: boolean): Promise<{ code: string }> {
  await requireJoiner(userId);
  const profile = await getProfile(userId);
  if (!profile || profile.isDemo) throw new NetworkError(MAKE_PROFILE_FIRST, 400);
  return { code: await ownInviteCode(userId, fresh) };
}

const INVITE_GONE = "This invite link doesn't work any more. Ask your friend for a new one.";

/** The invite and its sender's profile, or a 404 that says what to do. */
async function loadInvite(code: string): Promise<{ inviterId: string; inviter: ProfileRecord }> {
  const invite = await getInviteRecord(code);
  const inviter = invite ? await getProfile(invite.userId) : null;
  if (!invite || !inviter || inviter.isDemo) throw new NetworkError(INVITE_GONE, 404);
  return { inviterId: invite.userId, inviter };
}

/** What the invite page shows: who invited you, and whether you can accept. */
export async function getInvite(viewerId: string, code: string): Promise<InviteView> {
  assertUserId(viewerId);
  const { inviterId, inviter } = await loadInvite(code);
  const [access, mine, alreadyFriends] = await Promise.all([
    viewerAccess(),
    getProfile(viewerId),
    areFriends(viewerId, inviterId),
  ]);
  return {
    inviter: { displayName: inviter.displayName, city: inviter.city },
    isYou: inviterId === viewerId,
    alreadyFriends,
    hasProfile: mine !== null && !mine.isDemo,
    signInRequired: access.signInRequired,
    displayName: access.displayName,
  };
}

/**
 * Accepts an invite: both people become friends. A viewer with no profile gets one, friends
 * only, under `displayName`. Signed in, once Auth0 is set up, like joining.
 */
export async function acceptInvite(
  viewerId: string,
  code: string,
  displayName: string | null,
): Promise<{ friend: string }> {
  await requireJoiner(viewerId);
  const { inviterId, inviter } = await loadInvite(code);
  if (inviterId === viewerId) throw new NetworkError("This is your own invite link. Send it to a friend.", 400);
  const mine = await getProfile(viewerId);
  if (!mine || mine.isDemo) {
    const checked = checkProfileInput({ displayName: displayName ?? "" });
    if (!checked.ok) throw new NetworkError(firstError(checked.errors), 400);
    await saveProfile(viewerId, checked.value, false);
  }
  await addFriendship(viewerId, inviterId);
  return { friend: inviter.displayName };
}

/** Removes a friend, both ways, by their public id. Never needs a sign-in, and removing twice is fine. */
export async function removeFriend(userId: string, publicId: string): Promise<void> {
  assertUserId(userId);
  const friendIds = await listFriendIds(userId);
  const profiles = await Promise.all(friendIds.map((id) => getProfile(id)));
  const index = profiles.findIndex((profile) => profile?.publicId === publicId);
  if (index >= 0) await removeFriendship(userId, friendIds[index]);
}

/** The viewer's own profile, or null. */
export async function getMyProfile(userId: string): Promise<MyProfileView | null> {
  assertUserId(userId);
  const record = await getProfile(userId);
  return record && !record.isDemo ? toMyProfile(record, await computeSkills(userId)) : null;
}

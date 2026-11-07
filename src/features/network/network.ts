/** Join, leave, and the page's view: who could mentor you and who is learning the same skills. */
import { ensureDemoProfiles } from "./demo";
import { NetworkError } from "./errors";
import { groupMatches, matchProfile } from "./matching";
import { deleteProfile, getProfile, listProfiles, saveProfile } from "./profiles";
import { checkProfileInput, firstError } from "./rules";
import { assertUserId, requireJoiner, viewerAccess } from "./session";
import { computeSkills, demoSkillSet, NO_SKILLS } from "./skills";
import type {
  Match,
  MyProfileView,
  NetworkView,
  ProfileInput,
  ProfileRecord,
  PublicProfile,
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
    provenSkills: skills.proven.map((skill) => ({ ...skill })),
    learning: [...skills.learning],
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
 * Everything /people shows to this viewer. Matching needs the viewer to have a profile or
 * at least one map; without either, everyone is listed with no match sections.
 */
export async function getNetwork(userId: string): Promise<NetworkView> {
  assertUserId(userId);
  try {
    await ensureDemoProfiles();
  } catch (error) {
    // The demo profiles are a nicety. Real profiles still list without them.
    console.error("[network] could not seed the demo profiles", error);
  }

  const [profiles, viewer, access] = await Promise.all([listProfiles(), computeSkills(userId), viewerAccess()]);
  const mine = profiles.find((profile) => profile.userId === userId && !profile.isDemo) ?? null;
  const others = profiles.filter((profile) => profile.userId !== userId);
  const othersWithSkills = await Promise.all(
    others.map(async (record) => ({ record, skills: await skillsOf(record) })),
  );

  const canMatch = mine !== null || viewer.hasMaps;
  const matches = othersWithSkills.map(({ record, skills }) =>
    matchProfile(canMatch ? viewer : NO_SKILLS, skills, toPublicProfile(record, skills)),
  );
  const { mentors, peers, rest } = canMatch ? groupMatches(matches) : { mentors: [], peers: [], rest: matches };

  return {
    me: mine ? toMyProfile(mine, viewer) : null,
    mentors,
    peers,
    everyone: [...rest].sort(directoryOrder),
    viewerHasMaps: viewer.hasMaps,
    signedIn: access.signedIn,
    signInRequired: access.signInRequired,
    displayName: access.displayName,
  };
}

/** Creates or updates the viewer's profile. Signed in, once Auth0 is set up. */
export async function joinNetwork(userId: string, input: ProfileInput): Promise<MyProfileView> {
  await requireJoiner(userId);
  const checked = checkProfileInput(input);
  if (!checked.ok) throw new NetworkError(firstError(checked.errors), 400);
  const record = await saveProfile(userId, checked.value);
  return toMyProfile(record, await computeSkills(userId));
}

/** Deletes the viewer's profile. Never needs a sign-in, and leaving twice is fine. */
export async function leaveNetwork(userId: string): Promise<void> {
  assertUserId(userId);
  await deleteProfile(userId);
}

/** The viewer's own profile, or null. */
export async function getMyProfile(userId: string): Promise<MyProfileView | null> {
  assertUserId(userId);
  const record = await getProfile(userId);
  return record && !record.isDemo ? toMyProfile(record, await computeSkills(userId)) : null;
}

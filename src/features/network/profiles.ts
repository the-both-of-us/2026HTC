/** Store reads and writes for profiles. */
import { randomUUID } from "node:crypto";
import { deleteDoc, getDoc, listDocs, putDoc } from "@/shared/store";
import type { CleanProfile, ProfileRecord } from "./types";

const PREFIX = "network/profiles/";

export function profileKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

export function getProfile(userId: string): Promise<ProfileRecord | null> {
  return getDoc<ProfileRecord>(profileKey(userId));
}

/** Every profile, real and demo. */
export function listProfiles(): Promise<ProfileRecord[]> {
  return listDocs<ProfileRecord>(PREFIX);
}

/**
 * Creates or updates a real person's profile. Updating keeps the public id and the join
 * date. Two first joins at once each pick a public id and the last write wins, which only
 * means the id was never shown to anyone.
 */
export async function saveProfile(userId: string, fields: CleanProfile, inNetwork?: boolean): Promise<ProfileRecord> {
  const existing = await getProfile(userId);
  const now = new Date().toISOString();
  const record: ProfileRecord = {
    userId,
    publicId: existing?.publicId ?? randomUUID(),
    displayName: fields.displayName,
    city: fields.city,
    lookingFor: fields.lookingFor,
    contactUrl: fields.contactUrl,
    joinedAt: existing?.joinedAt ?? now,
    updatedAt: now,
    isDemo: false,
    // Left out, an edit keeps the setting, and a new profile starts as friends only.
    inNetwork: inNetwork ?? existing?.inNetwork ?? false,
  };
  await putDoc(profileKey(userId), record);
  return record;
}

/** Opts in or out. Returns the updated record, or null when there is no profile. */
export async function setProfileInNetwork(userId: string, inNetwork: boolean): Promise<ProfileRecord | null> {
  const existing = await getProfile(userId);
  if (!existing || existing.isDemo) return null;
  const record: ProfileRecord = {
    ...existing,
    inNetwork,
    updatedAt: new Date().toISOString(),
  };
  await putDoc(profileKey(userId), record);
  return record;
}

/** Demo profiles are always in the network. Real ones only once they opt in. */
export function isInNetwork(record: ProfileRecord): boolean {
  return record.isDemo || record.inNetwork === true;
}

/** Returns true if there was a profile to delete. */
export async function deleteProfile(userId: string): Promise<boolean> {
  const existed = (await getProfile(userId)) !== null;
  await deleteDoc(profileKey(userId));
  return existed;
}

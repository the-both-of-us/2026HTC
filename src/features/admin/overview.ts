import { getDoc, listKeys } from "@/shared/store";
import type { SkillMap } from "@/shared/types";

/**
 * Everything the admin page shows, read straight from the store. Read-only. The stored
 * documents belong to other features, so only the fields used here are typed, and each is
 * checked before use: an old or odd document is skipped, never a crash.
 */

export type AdminMap = {
  id: string;
  title: string;
  kind: string;
  /** What the person typed or pasted to build it. */
  typed: string;
  audience: string | null;
  skills: number;
  proven: number;
  published: boolean;
  /** Started from someone else's course. */
  copied: boolean;
  programTitle: string | null;
  createdAt: string;
};

export type AdminProgram = {
  id: string;
  title: string;
  kind: string;
  typed: string;
  audience: string | null;
  courses: number;
  coursesBuilt: number;
  createdAt: string;
};

export type AdminUser = {
  id: string;
  /** "Google", "Email" and the like for a signed-in account; null for a guest. */
  account: string | null;
  accountSince: string | null;
  /** From their People profile or a course they published. Names are only stored when someone types one. */
  name: string | null;
  city: string | null;
  lookingFor: string | null;
  inNetwork: boolean;
  interests: string[];
  streak: { current: number; best: number } | null;
  maps: AdminMap[];
  programs: AdminProgram[];
  firstSeen: string | null;
  lastActive: string | null;
};

export type AdminSearch = {
  at: string;
  userId: string;
  kind: string;
  typed: string;
  /** What it became. */
  result: string;
  what: "map" | "program";
};

export type AdminOverview = {
  generatedAt: string;
  totals: {
    people: number;
    accounts: number;
    maps: number;
    programs: number;
    published: number;
    proven: number;
  };
  users: AdminUser[];
  searches: AdminSearch[];
};

type AccountDoc = { userId?: unknown; sub?: unknown; createdAt?: unknown };
type ProfileDoc = { userId?: unknown; displayName?: unknown; city?: unknown; lookingFor?: unknown; inNetwork?: unknown; isDemo?: unknown };
type ListingDoc = { mapId?: unknown; authorId?: unknown; authorName?: unknown };
type ProgramDoc = {
  id?: unknown;
  ownerId?: unknown;
  title?: unknown;
  sourceKind?: unknown;
  sourceText?: unknown;
  audience?: unknown;
  courses?: unknown;
  createdAt?: unknown;
};
type InterestsDoc = { interests?: unknown };
type StreakDoc = { current?: unknown; best?: unknown };

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Auth0's subject starts with the connection: "google-oauth2|…", "auth0|…". */
export function accountKind(sub: unknown): string {
  const provider = typeof sub === "string" ? sub.split("|")[0] : "";
  if (provider === "google-oauth2") return "Google";
  if (provider === "auth0") return "Email";
  if (provider === "github") return "GitHub";
  if (provider === "windowslive") return "Microsoft";
  return provider || "Account";
}

/** The id after a prefix, when the key is `<prefix><id>` or `<prefix><id>/<more>`. */
const idAfter = (key: string, prefix: string) => key.slice(prefix.length).split("/")[0];

const latest = (dates: (string | null)[]) => dates.filter((d): d is string => !!d).sort().at(-1) ?? null;
const earliest = (dates: (string | null)[]) => dates.filter((d): d is string => !!d).sort()[0] ?? null;

/** Every document under a prefix with its key. One that can't be read or parsed is skipped. */
async function entries<T>(prefix: string): Promise<[string, T][]> {
  const keys = await listKeys(prefix);
  const docs = await Promise.all(keys.map((key) => getDoc<T>(key).catch(() => null)));
  return keys.flatMap((key, index): [string, T][] => (docs[index] ? [[key, docs[index] as T]] : []));
}

const docs = async <T>(prefix: string): Promise<T[]> => (await entries<T>(prefix)).map(([, doc]) => doc);

export async function loadAdminOverview(now = new Date()): Promise<AdminOverview> {
  const [maps, programs, accounts, profiles, listings, provenKeys, interests, streaks] = await Promise.all([
    docs<SkillMap>("maps/"),
    docs<ProgramDoc>("programs/"),
    docs<AccountDoc>("accounts/"),
    docs<ProfileDoc>("network/profiles/"),
    docs<ListingDoc>("courses/"),
    listKeys("progress/"),
    entries<InterestsDoc>("feed-interests/"),
    entries<StreakDoc>("streaks/"),
  ]);

  // progress/<mapId>/<ownerId>/<nodeId>: one key per proven skill.
  const provenByMap = new Map<string, number>();
  for (const key of provenKeys) {
    const parts = key.split("/");
    if (parts.length < 4) continue;
    provenByMap.set(parts[1], (provenByMap.get(parts[1]) ?? 0) + 1);
  }

  const published = new Map<string, string | null>();
  for (const listing of listings) {
    const mapId = str(listing.mapId);
    if (mapId) published.set(mapId, str(listing.authorName));
  }

  const users = new Map<string, AdminUser>();
  const user = (id: string): AdminUser => {
    let found = users.get(id);
    if (!found) {
      found = {
        id,
        account: null,
        accountSince: null,
        name: null,
        city: null,
        lookingFor: null,
        inNetwork: false,
        interests: [],
        streak: null,
        maps: [],
        programs: [],
        firstSeen: null,
        lastActive: null,
      };
      users.set(id, found);
    }
    return found;
  };

  const searches: AdminSearch[] = [];

  for (const map of maps) {
    const owner = str(map?.ownerId);
    const id = str(map?.id);
    if (!owner || !id || !Array.isArray(map.nodes)) continue;
    const entry: AdminMap = {
      id,
      title: str(map.title) ?? "(untitled)",
      kind: str(map.sourceKind) ?? "?",
      typed: str(map.sourceText) ?? "",
      audience: str(map.audience),
      skills: map.nodes.length,
      proven: provenByMap.get(id) ?? 0,
      published: published.has(id),
      copied: !!str(map.forkedFrom),
      programTitle: str(map.program?.title),
      createdAt: str(map.createdAt) ?? "",
    };
    const owned = user(owner);
    owned.maps.push(entry);
    const authorName = published.get(id);
    if (authorName && !owned.name) owned.name = authorName;
    // A copy of a course or a course inside a program was not typed by this person.
    if (!entry.copied && !entry.programTitle && entry.typed) {
      searches.push({ at: entry.createdAt, userId: owner, kind: entry.kind, typed: entry.typed, result: entry.title, what: "map" });
    }
  }

  for (const program of programs) {
    const owner = str(program?.ownerId);
    const id = str(program?.id);
    if (!owner || !id) continue;
    const courses = Array.isArray(program.courses) ? (program.courses as { mapId?: unknown }[]) : [];
    const entry: AdminProgram = {
      id,
      title: str(program.title) ?? "(untitled)",
      kind: str(program.sourceKind) ?? "?",
      typed: str(program.sourceText) ?? "",
      audience: str(program.audience),
      courses: courses.length,
      coursesBuilt: courses.filter((course) => !!str(course?.mapId)).length,
      createdAt: str(program.createdAt) ?? "",
    };
    user(owner).programs.push(entry);
    if (entry.typed) {
      searches.push({ at: entry.createdAt, userId: owner, kind: entry.kind, typed: entry.typed, result: entry.title, what: "program" });
    }
  }

  for (const account of accounts) {
    const id = str(account?.userId);
    if (!id) continue;
    const found = user(id);
    found.account = accountKind(account.sub);
    found.accountSince = str(account.createdAt);
  }

  for (const profile of profiles) {
    const id = str(profile?.userId);
    if (!id || profile.isDemo === true) continue;
    const found = user(id);
    found.name = str(profile.displayName) ?? found.name;
    found.city = str(profile.city);
    found.lookingFor = str(profile.lookingFor);
    found.inNetwork = profile.inNetwork !== false;
  }

  // These documents don't hold the user id, so it comes from the key.
  for (const [key, doc] of interests) {
    const list = Array.isArray(doc?.interests) ? (doc.interests as { name?: unknown }[]) : [];
    const names = list.map((item) => str(item?.name)).filter((name): name is string => !!name);
    if (names.length) user(idAfter(key, "feed-interests/")).interests = names;
  }
  for (const [key, doc] of streaks) {
    if (num(doc.best) > 0 || num(doc.current) > 0) {
      user(idAfter(key, "streaks/")).streak = { current: num(doc.current), best: num(doc.best) };
    }
  }

  for (const found of users.values()) {
    found.maps.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    found.programs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const dates = [...found.maps.map((m) => m.createdAt), ...found.programs.map((p) => p.createdAt), found.accountSince];
    found.firstSeen = earliest(dates);
    found.lastActive = latest(dates);
  }

  const sorted = [...users.values()].sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));
  searches.sort((a, b) => b.at.localeCompare(a.at));

  return {
    generatedAt: now.toISOString(),
    totals: {
      people: sorted.length,
      accounts: sorted.filter((u) => u.account).length,
      maps: maps.length,
      programs: programs.length,
      published: published.size,
      proven: provenKeys.length,
    },
    users: sorted,
    searches,
  };
}

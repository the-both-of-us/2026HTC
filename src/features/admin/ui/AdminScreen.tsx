"use client";

import clsx from "clsx";
import { ChevronRight, LogOut, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Button } from "@/shared/ui";
import type { AdminMap, AdminOverview, AdminProgram, AdminSearch, AdminUser } from "../overview";

type View = "people" | "searches";

/**
 * Alberta time, worked out by hand: Alberta stays on UTC-6 from November 2026, and doing it
 * here keeps the server and browser text identical (no hydration mismatch, no stale tz data).
 */
function when(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(Date.parse(iso) - 6 * 3_600_000);
  if (Number.isNaN(date.getTime())) return "";
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const time = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  return `${month} ${date.getUTCDate()}, ${time}`;
}

const shortId = (id: string) => id.slice(0, 8);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
/** The newest this many rows show; the filter finds older ones. */
const MAX_ROWS = 400;
const nameOf = (user: AdminUser) => user.name ?? `Guest ${shortId(user.id)}`;

function userText(user: AdminUser): string {
  return [
    user.id,
    user.name,
    user.account ?? "guest",
    user.city,
    user.lookingFor,
    ...user.interests,
    ...user.maps.flatMap((m) => [m.title, m.typed]),
    ...user.programs.flatMap((p) => [p.title, p.typed]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function AdminScreen({ overview }: { overview: AdminOverview }) {
  const router = useRouter();
  const [view, setView] = useState<View>("people");
  const [query, setQuery] = useState("");
  const [onlyAccounts, setOnlyAccounts] = useState(false);
  const q = query.trim().toLowerCase();

  const names = useMemo(() => new Map(overview.users.map((user) => [user.id, nameOf(user)])), [overview.users]);
  const people = useMemo(
    () => overview.users.filter((user) => (!onlyAccounts || user.account) && (!q || userText(user).includes(q))),
    [overview.users, q, onlyAccounts],
  );
  const searches = useMemo(
    () =>
      overview.searches.filter(
        (search) =>
          (!onlyAccounts || overview.users.find((user) => user.id === search.userId)?.account) &&
          (!q || `${search.typed} ${search.result} ${names.get(search.userId) ?? ""}`.toLowerCase().includes(q)),
      ),
    [overview.searches, overview.users, names, q, onlyAccounts],
  );

  async function signOut() {
    await fetch("/api/admin/session", { method: "DELETE" }).catch(() => null);
    router.refresh();
  }

  const { totals } = overview;
  const stats: [string, number][] = [
    ["people", totals.people],
    ["signed in", totals.accounts],
    ["maps", totals.maps],
    ["programs", totals.programs],
    ["public courses", totals.published],
    ["skills proven", totals.proven],
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-medium">Admin</h1>
          <p className="mt-1 text-sm text-ink-soft">Everyone who has used OryxLearn, read live from the store at {when(overview.generatedAt)}.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
            Refresh
          </Button>
          <Button variant="subtle" size="sm" onClick={signOut}>
            <LogOut aria-hidden="true" size={16} />
            Lock
          </Button>
        </div>
      </header>

      <dl className="flex flex-wrap gap-x-8 gap-y-3 border-y border-rule py-4">
        {stats.map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <dt className="text-sm text-ink-soft">{label}</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Show" className="flex rounded-control border border-rule-strong p-0.5">
          {(["people", "searches"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={clsx(
                "min-h-9 cursor-pointer rounded-[inherit] px-4 text-sm font-medium transition-control",
                view === option ? "bg-accent text-on-dark" : "text-ink-soft hover:bg-raised hover:text-ink",
              )}
            >
              {option === "people" ? `People (${people.length})` : `What they typed (${searches.length})`}
            </button>
          ))}
        </div>
        <label className="relative min-w-60 flex-1">
          <span className="sr-only">Filter</span>
          <Search aria-hidden="true" size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name, id, topic or anything they typed"
            className="min-h-10 w-full rounded-control border border-control-edge bg-sheet pr-3 pl-9 text-sm"
          />
        </label>
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyAccounts} onChange={(event) => setOnlyAccounts(event.target.checked)} />
          Signed-in accounts only
        </label>
      </div>

      {view === "people" ? (
        <ul className="flex flex-col gap-2">
          {people.map((user) => (
            <li key={user.id}>
              <UserRow user={user} />
            </li>
          ))}
          {people.length === 0 && <p className="text-ink-soft">No one matches that filter.</p>}
        </ul>
      ) : (
        <SearchList searches={searches} names={names} />
      )}
    </div>
  );
}

function UserRow({ user }: { user: AdminUser }) {
  const proven = user.maps.reduce((sum, map) => sum + map.proven, 0);
  return (
    <details className="group rounded-control border border-rule-strong bg-sheet">
      <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden="true" size={16} className="shrink-0 transition-transform group-open:rotate-90" />
        <span className="min-w-40 font-medium">{nameOf(user)}</span>
        {user.account ? <Badge tone="proven">{user.account}</Badge> : <Badge>Guest</Badge>}
        <span className="text-sm text-ink-soft tabular-nums">
          {plural(user.maps.length, "map")} · {plural(user.programs.length, "program")} · {proven} proven
        </span>
        <span className="ml-auto text-sm text-ink-soft">{when(user.lastActive)}</span>
      </summary>
      <div className="flex flex-col gap-5 border-t border-rule px-4 py-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-ink-soft">User id</dt>
          <dd className="font-mono break-all">{user.id}</dd>
          {user.account && (
            <>
              <dt className="text-ink-soft">Account</dt>
              <dd>
                {user.account}, since {when(user.accountSince)}
              </dd>
            </>
          )}
          <dt className="text-ink-soft">First seen</dt>
          <dd>{when(user.firstSeen) || "Unknown"}</dd>
          {user.city && (
            <>
              <dt className="text-ink-soft">City</dt>
              <dd>{user.city}</dd>
            </>
          )}
          {user.lookingFor && (
            <>
              <dt className="text-ink-soft">Looking for</dt>
              <dd>{user.lookingFor}</dd>
            </>
          )}
          {user.name && (
            <>
              <dt className="text-ink-soft">People network</dt>
              <dd>{user.inNetwork ? "Opted in" : "Friends only"}</dd>
            </>
          )}
          {user.streak && (
            <>
              <dt className="text-ink-soft">Streak</dt>
              <dd>
                {user.streak.current} days now, best {user.streak.best}
              </dd>
            </>
          )}
          {user.interests.length > 0 && (
            <>
              <dt className="text-ink-soft">Feed interests</dt>
              <dd>{user.interests.join(", ")}</dd>
            </>
          )}
        </dl>
        {user.programs.length > 0 && <ProgramTable programs={user.programs} />}
        {user.maps.length > 0 && <MapTable maps={user.maps} />}
      </div>
    </details>
  );
}

function Typed({ text }: { text: string }) {
  if (text.length <= 140) return <span className="whitespace-pre-wrap">{text}</span>;
  return (
    <details>
      <summary className="cursor-pointer">
        {text.slice(0, 140).trimEnd()}… <span className="text-accent-bright underline">more</span>
      </summary>
      <p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap">{text}</p>
    </details>
  );
}

const TH = "px-2 py-1.5 text-left font-medium text-ink-soft";
const TD = "px-2 py-1.5 align-top";

function MapTable({ maps }: { maps: AdminMap[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse">
        <caption className="mb-1 text-left font-medium">Maps and courses</caption>
        <thead>
          <tr className="border-b border-rule">
            <th className={TH}>Title</th>
            <th className={TH}>From</th>
            <th className={clsx(TH, "w-[40%]")}>What they typed</th>
            <th className={TH}>Proven</th>
            <th className={TH}>Made</th>
          </tr>
        </thead>
        <tbody>
          {maps.map((map) => (
            <tr key={map.id} className="border-b border-rule last:border-0">
              <td className={TD}>
                {map.published ? (
                  <Link href={`/courses/${map.id}`} className="underline">
                    {map.title}
                  </Link>
                ) : (
                  map.title
                )}
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {map.published && <Badge tone="proven">Public</Badge>}
                  {map.copied && <Badge>Started from a course</Badge>}
                  {map.programTitle && <Badge>In {map.programTitle}</Badge>}
                  {map.audience && <Badge>{map.audience}</Badge>}
                </div>
              </td>
              <td className={TD}>{map.kind}</td>
              <td className={TD}>{map.copied || map.programTitle ? <span className="text-ink-soft">(not typed)</span> : <Typed text={map.typed} />}</td>
              <td className={clsx(TD, "tabular-nums")}>
                {map.proven}/{map.skills}
              </td>
              <td className={clsx(TD, "whitespace-nowrap")}>{when(map.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProgramTable({ programs }: { programs: AdminProgram[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse">
        <caption className="mb-1 text-left font-medium">Programs</caption>
        <thead>
          <tr className="border-b border-rule">
            <th className={TH}>Title</th>
            <th className={TH}>From</th>
            <th className={clsx(TH, "w-[40%]")}>What they typed</th>
            <th className={TH}>Courses built</th>
            <th className={TH}>Made</th>
          </tr>
        </thead>
        <tbody>
          {programs.map((program) => (
            <tr key={program.id} className="border-b border-rule last:border-0">
              <td className={TD}>
                {program.title}
                {program.audience && (
                  <div className="mt-0.5">
                    <Badge>{program.audience}</Badge>
                  </div>
                )}
              </td>
              <td className={TD}>{program.kind}</td>
              <td className={TD}>
                <Typed text={program.typed} />
              </td>
              <td className={clsx(TD, "tabular-nums")}>
                {program.coursesBuilt}/{program.courses}
              </td>
              <td className={clsx(TD, "whitespace-nowrap")}>{when(program.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SearchList({ searches, names }: { searches: AdminSearch[]; names: Map<string, string> }) {
  if (searches.length === 0) return <p className="text-ink-soft">Nothing matches that filter.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule">
            <th className={TH}>When</th>
            <th className={TH}>Who</th>
            <th className={TH}>From</th>
            <th className={clsx(TH, "w-[45%]")}>What they typed</th>
            <th className={TH}>Became</th>
          </tr>
        </thead>
        <tbody>
          {searches.slice(0, MAX_ROWS).map((search, index) => (
            <tr key={`${search.userId}-${search.at}-${index}`} className="border-b border-rule last:border-0">
              <td className={clsx(TD, "whitespace-nowrap")}>{when(search.at)}</td>
              <td className={TD}>{names.get(search.userId) ?? shortId(search.userId)}</td>
              <td className={TD}>{search.kind}</td>
              <td className={TD}>
                <Typed text={search.typed} />
              </td>
              <td className={TD}>
                {search.result}
                <span className="text-ink-soft"> ({search.what})</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {searches.length > MAX_ROWS && (
        <p className="mt-2 text-ink-soft">
          Showing the newest {MAX_ROWS} of {searches.length}. Filter to find older ones.
        </p>
      )}
    </div>
  );
}

"use client";

import {
  BellRing,
  Check,
  Dumbbell,
  ExternalLink,
  FileCheck,
  Filter,
  Globe,
  GraduationCap,
  Heart,
  MapPin,
  Search,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Badge, Button, buttonClasses, Card, ErrorNotice, Field, PageShell, Spinner, TextInput } from "@/shared/ui";
import {
  checkProfileInput,
  MAX_CITY_LENGTH,
  MAX_CONTACT_LENGTH,
  MAX_LOOKING_FOR_LENGTH,
  MAX_NAME_LENGTH,
  type ProfileErrors,
} from "../rules";
import { PRETEST_PROOF_LABEL } from "@/shared/types";
import { skillsMatch } from "../matching";
import type { FriendCourse, Match, MyProfileView, NetworkView, ProvenSkill, PublicProfile } from "../types";
import {
  acceptFriendRequest,
  deleteProfile,
  dismissPing,
  fetchNetwork,
  pingFriend,
  removeFriend,
  removeFriendRequest,
  saveProfile,
  sendFriendRequest,
  setInNetwork,
  type Result,
} from "./api";
import { FriendInviteDialog, type FriendInviteHandle } from "./FriendInvite";
import {
  canMatch,
  contactHost,
  countLabel,
  DEMO_NOTE,
  everyoneDescription,
  everyoneHeading,
  hasAnyMatch,
  hasDemo,
  LOGIN_HREF,
  NETWORK_OFF_NOTE,
  NETWORK_ON_NOTE,
  peopleCount,
  SIGN_IN_LEAD,
  SKILLS_SHOWN,
} from "./view";

type Loaded = { attempt: number; result: Result<{ view: NetworkView }> };
/** What a viewer with no profile asked for, so making the profile finishes it. */
type Intent = "network" | "invite" | null;

/** /people: your friends, and, once you join the network, people who proved what you're learning. */
export function NetworkScreen() {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  /** The newest view, kept while a reload runs, so the page doesn't flash back to a spinner. */
  const [view, setView] = useState<NetworkView | null>(null);
  const focusAfterLoad = useRef<"profile" | "join" | "status" | null>(null);
  const profileHeading = useRef<HTMLHeadingElement>(null);
  const joinHeading = useRef<HTMLHeadingElement>(null);
  const statusLine = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let current = true;
    fetchNetwork().then((result) => {
      if (!current) return;
      setLoaded({ attempt, result });
      if (result.ok) setView(result.view);
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  const stale = loaded?.attempt !== attempt;
  const failed = loaded && !loaded.result.ok && !stale ? loaded.result : null;

  // After joining, leaving or "Try again", focus follows the content that replaced the control.
  useEffect(() => {
    const target = focusAfterLoad.current;
    if (!target) return;
    const element =
      target === "profile" ? profileHeading.current : target === "join" ? joinHeading.current : statusLine.current;
    if (element) {
      focusAfterLoad.current = null;
      element.focus();
    }
  }, [view, loaded]);

  function reload(focus: "profile" | "join" | "status" | null = null) {
    focusAfterLoad.current = focus;
    setAttempt((count) => count + 1);
  }

  function onSaved(me: MyProfileView) {
    setView((previous) => (previous ? { ...previous, me } : previous));
    reload("profile");
  }

  function onLeft() {
    setView((previous) => (previous ? { ...previous, me: null } : previous));
    reload("join");
  }

  return (
    <PageShell width="wide">
      <h1 className="text-3xl font-medium">Network</h1>
      <p className="mt-2 max-w-2xl text-lg text-ink-soft">
        See what your friends have proved. Join the network to find people who proved the skills you&apos;re learning.
      </p>

      <div className="mt-6">
        {failed && !view ? (
          <ErrorNotice message={failed.message} onRetry={() => reload("status")} />
        ) : !view ? (
          <p ref={statusLine} tabIndex={-1} role="status" className="flex items-center gap-3 text-lg outline-none">
            <Spinner size={22} />
            Loading people.
          </p>
        ) : (
          <LoadedNetwork
            view={view}
            stale={stale}
            failedMessage={failed?.message ?? null}
            onRetry={() => reload("status")}
            onSaved={onSaved}
            onLeft={onLeft}
            onChanged={() => reload()}
            profileHeading={profileHeading}
            joinHeading={joinHeading}
            statusLine={statusLine}
          />
        )}
      </div>
    </PageShell>
  );
}

function LoadedNetwork({
  view,
  stale,
  failedMessage,
  onRetry,
  onSaved,
  onLeft,
  onChanged,
  profileHeading,
  joinHeading,
  statusLine,
}: {
  view: NetworkView;
  stale: boolean;
  failedMessage: string | null;
  onRetry: () => void;
  onSaved: (me: MyProfileView) => void;
  onLeft: () => void;
  /** Reloads the view after a change elsewhere on the page, such as the network setting. */
  onChanged: () => void;
  profileHeading: RefObject<HTMLHeadingElement | null>;
  joinHeading: RefObject<HTMLHeadingElement | null>;
  statusLine: RefObject<HTMLParagraphElement | null>;
}) {
  const matching = canMatch(view);
  const total = peopleCount(view);
  const inviteDialog = useRef<FriendInviteHandle>(null);
  const [intent, setIntent] = useState<Intent>(null);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  /** Joining the network or inviting needs a profile first: without one, the form finishes the job. */
  function ask(next: "network" | "invite") {
    if (!view.me) {
      setIntent(next);
      requestAnimationFrame(() => joinHeading.current?.focus());
      return;
    }
    if (next === "invite") inviteDialog.current?.open();
    else void toggleNetwork(true);
  }

  async function toggleNetwork(on: boolean) {
    setToggling(true);
    setToggleError(null);
    const result = await setInNetwork(on);
    setToggling(false);
    if (result.ok) onChanged();
    else setToggleError(result.message);
  }

  function onProfileMade(me: MyProfileView) {
    const opened = intent;
    setIntent(null);
    onSaved(me);
    if (opened === "invite") inviteDialog.current?.open();
  }

  async function unfriend(publicId: string): Promise<string | null> {
    const result = await removeFriend(publicId);
    if (!result.ok) return result.message;
    onChanged();
    return null;
  }
  // Clicking a skill on any card shows only the people who proved it.
  const [skillFilter, setSkillFilter] = useState<string | null>(null);
  // Typing narrows by name, city, what they're looking for, or a skill.
  const [search, setSearch] = useState("");
  const filterBar = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const needle = search.trim().toLowerCase();
  const keep = (entries: Match[]) =>
    entries.filter(
      ({ profile }) =>
        (!skillFilter || profile.provenSkills.some((skill) => skillsMatch(skill.title, skillFilter))) &&
        (!needle || searchText(profile).includes(needle)),
    );
  const friends = keep(view.friends);
  const mentors = keep(view.mentors);
  const peers = keep(view.peers);
  const everyone = keep(view.everyone);
  const shownCount = friends.length + mentors.length + peers.length + everyone.length;
  const narrowed = skillFilter !== null || needle !== "";

  function pickSkill(title: string) {
    setSkillFilter((current) => (current !== null && skillsMatch(current, title) ? null : title));
    // Move to the bar, so the change is announced and "Show everyone" is one Tab away.
    requestAnimationFrame(() => filterBar.current?.focus());
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:items-start">
      <aside className="order-2 flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:order-1">
        {view.me ? (
          <MyProfileCard me={view.me} headingRef={profileHeading} onSaved={onSaved} onLeft={onLeft} />
        ) : (
          <JoinCard view={view} intent={intent} headingRef={joinHeading} onSaved={onProfileMade} />
        )}
        {!view.viewerHasMaps && <NoMapsCard />}
      </aside>

      {/* First on a phone, so the network setting and your friends come before the profile form. */}
      <div className="order-1 flex min-w-0 flex-col gap-6 lg:order-2">
        <FriendInviteDialog ref={inviteDialog} />
        <Inbox view={view} onChanged={onChanged} />
        <NetworkControl
          inNetwork={view.inNetwork}
          // The empty state below carries the same two buttons, so they show once.
          showActions={view.inNetwork || view.friends.length > 0}
          pending={toggling}
          error={toggleError}
          onJoin={() => ask("network")}
          onLeave={() => toggleNetwork(false)}
          onInvite={() => ask("invite")}
        />

        {!view.inNetwork && view.friends.length === 0 ? (
          <FriendsOnlyEmpty onInvite={() => ask("invite")} onJoin={() => ask("network")} pending={toggling} />
        ) : (
          <>
            <div className="flex flex-col gap-3 border-b border-rule pb-5">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p
                  ref={statusLine}
                  tabIndex={-1}
                  role="status"
                  className="flex flex-wrap items-center gap-2.5 text-base outline-none"
                >
                  <span className="font-medium">
                    {total === 0
                      ? "Nobody else is in the network yet."
                      : narrowed
                        ? `Showing ${shownCount} of ${countLabel(total, "person", "people")}`
                        : countLabel(total, "person", "people")}
                  </span>
                  {stale && (
                    <span className="inline-flex items-center gap-2 text-ink-soft">
                      <Spinner size={16} />
                      Updating.
                    </span>
                  )}
                </p>
                {total > 0 && (
                  <div className="relative w-full sm:w-72">
                    <label htmlFor={searchId} className="sr-only">
                      Search people by name, skill or city
                    </label>
                    <Search
                      aria-hidden="true"
                      size={17}
                      className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
                    />
                    <TextInput
                      id={searchId}
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search name, skill or city"
                      className="py-2! pl-9 text-sm"
                    />
                  </div>
                )}
              </div>
              {(hasDemo(view) || total > 0) && (
                <p className="text-sm text-ink-soft">
                  {hasDemo(view) && <>{DEMO_NOTE} </>}
                  {total > 0 && "Click any skill to see everyone who proved it."}
                </p>
              )}
            </div>

            {failedMessage && <ErrorNotice message={failedMessage} onRetry={onRetry} />}

            {view.inNetwork && matching && !hasAnyMatch(view) && total > 0 && !narrowed && (
              <p className="text-base text-ink-soft">
                Nobody matches your skills yet. As you and others prove more skills, matches show up here.
              </p>
            )}

            {skillFilter && (
              <div
                ref={filterBar}
                tabIndex={-1}
                role="status"
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-l-4 border-proven bg-proven/10 px-4 py-3 outline-none"
              >
                <p className="flex min-w-0 flex-1 basis-56 items-start gap-2 text-base">
                  <Filter aria-hidden="true" size={17} className="mt-1 shrink-0 text-proven" />
                  <span className="min-w-0 break-words">
                    {shownCount === 0 ? (
                      <>
                        Nobody here has proved <strong className="font-medium">{skillFilter}</strong> yet.
                      </>
                    ) : (
                      <>
                        {countLabel(shownCount, "person", "people")} proved{" "}
                        <strong className="font-medium">{skillFilter}</strong>.
                      </>
                    )}
                  </span>
                </p>
                <a href={practiseHref(skillFilter)} className={buttonClasses("secondary", "sm")}>
                  <Dumbbell aria-hidden="true" size={16} />
                  Practise it
                </a>
                <Button variant="quiet" size="sm" onClick={() => setSkillFilter(null)}>
                  <X aria-hidden="true" size={16} />
                  Show everyone
                </Button>
              </div>
            )}

            {narrowed && shownCount === 0 && !skillFilter && (
              <p className="text-base text-ink-soft">Nobody matches “{search.trim()}”.</p>
            )}

            {(friends.length > 0 || (!narrowed && view.inNetwork)) && (
              <PeopleSection
                id="friends"
                icon={<Heart aria-hidden="true" size={20} className="text-proven" />}
                title="Friends"
                description={
                  view.friends.length === 0
                    ? "No friends yet. Invite one with a link or QR code, and you'll always see each other here."
                    : "You always see each other, whatever your network setting."
                }
                entries={friends}
                activeSkill={skillFilter}
                onPickSkill={pickSkill}
                onRemove={unfriend}
                onChanged={onChanged}
              />
            )}
            {mentors.length > 0 && (
              <PeopleSection
                id="mentors"
                icon={<GraduationCap aria-hidden="true" size={20} className="text-proven" />}
                title="Could mentor you"
                description="They proved skills that you're still learning."
                entries={mentors}
                activeSkill={skillFilter}
                onPickSkill={pickSkill}
                onChanged={onChanged}
              />
            )}
            {peers.length > 0 && (
              <PeopleSection
                id="peers"
                icon={<Users aria-hidden="true" size={20} className="text-accent-bright" />}
                title="Learning what you're learning"
                description="Study together: they're working on the same skills as you."
                entries={peers}
                activeSkill={skillFilter}
                onPickSkill={pickSkill}
                onChanged={onChanged}
              />
            )}
            {everyone.length > 0 && (
              <PeopleSection
                id="everyone"
                icon={<Users aria-hidden="true" size={20} className="text-ink-soft" />}
                title={everyoneHeading(view)}
                description={everyoneDescription(view)}
                entries={everyone}
                activeSkill={skillFilter}
                onPickSkill={pickSkill}
                onChanged={onChanged}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** "Network: on/off", with what each means, and "Invite a friend". */
function NetworkControl({
  inNetwork,
  showActions,
  pending,
  error,
  onJoin,
  onLeave,
  onInvite,
}: {
  inNetwork: boolean;
  showActions: boolean;
  pending: boolean;
  error: string | null;
  onJoin: () => void;
  onLeave: () => void;
  onInvite: () => void;
}) {
  return (
    <Card className="border-rule sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <Globe aria-hidden="true" size={19} className={inNetwork ? "text-proven" : "text-ink-soft"} />
            Network: {inNetwork ? "on" : "off"}
          </h2>
          <p className="mt-1 text-sm text-ink-soft">{inNetwork ? NETWORK_ON_NOTE : NETWORK_OFF_NOTE}</p>
        </div>
        {showActions && (
          <div className="flex flex-wrap gap-2">
            {inNetwork ? (
              <Button variant="secondary" size="sm" pending={pending} onClick={onLeave}>
                Leave the network
              </Button>
            ) : (
              <Button variant="secondary" size="sm" pending={pending} onClick={onJoin}>
                Join the network
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={onInvite}>
              <UserPlus aria-hidden="true" size={16} />
              Invite a friend
            </Button>
          </div>
        )}
      </div>
      {error && (
        <div className="mt-3">
          <ErrorNotice message={error} />
        </div>
      )}
    </Card>
  );
}

/** Friends only, and no friends yet: nobody else is shown, so say what to do. */
function FriendsOnlyEmpty({
  onInvite,
  onJoin,
  pending,
}: {
  onInvite: () => void;
  onJoin: () => void;
  pending: boolean;
}) {
  return (
    <section
      aria-labelledby="friends-empty"
      className="flex flex-col gap-3 rounded-sheet border border-rule p-5 sm:p-6"
    >
      <h2 id="friends-empty" className="flex items-center gap-2 text-xl font-medium">
        <Heart aria-hidden="true" size={20} className="text-proven" />
        No friends here yet
      </h2>
      <p className="text-base text-ink-soft">
        With the network off, you only see friends. Invite a friend with a link or QR code, or join the network to see
        everyone in it.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onInvite}>
          <UserPlus aria-hidden="true" size={16} />
          Invite a friend
        </Button>
        <Button variant="secondary" size="sm" pending={pending} onClick={onJoin}>
          Join the network
        </Button>
      </div>
    </section>
  );
}

function PeopleSection({
  id,
  icon,
  title,
  description,
  entries,
  activeSkill,
  onPickSkill,
  onRemove,
  onChanged,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  entries: Match[];
  activeSkill: string | null;
  onPickSkill: (title: string) => void;
  /** On friends' cards: removes the friend, or returns a sentence saying why it failed. */
  onRemove?: (publicId: string) => Promise<string | null>;
  /** Reloads the page after a friend request turns into a friendship. */
  onChanged: () => void;
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div>
        <h2 id={headingId} className="flex items-center gap-2 text-xl font-medium">
          <span className="shrink-0">{icon}</span>
          <span className="min-w-0">
            {title} <span className="text-base font-normal text-ink-soft">{entries.length}</span>
          </span>
        </h2>
        <p className="mt-0.5 text-sm text-ink-soft">{description}</p>
      </div>
      {/* Columns, not a grid: a short card never stretches to match a tall neighbour. */}
      <ul className="columns-1 gap-4 xl:columns-2">
        {entries.map((match) => (
          <li key={match.profile.publicId} className="mb-4 min-w-0 break-inside-avoid">
            <PersonCard
              profile={match.profile}
              reasons={match.reasons}
              mentorFor={match.mentorFor}
              activeSkill={activeSkill}
              onPickSkill={onPickSkill}
              onRemove={onRemove}
              match={match}
              onChanged={onChanged}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PersonCard({
  profile,
  reasons,
  mentorFor,
  activeSkill,
  onPickSkill,
  onRemove,
  match,
  onChanged,
}: {
  profile: PublicProfile;
  reasons: string[];
  /** Their proven skills that the viewer is still learning. */
  mentorFor: string[];
  activeSkill: string | null;
  onPickSkill: (title: string) => void;
  onRemove?: (publicId: string) => Promise<string | null>;
  match: Match;
  onChanged: () => void;
}) {
  const host = contactHost(profile.contactUrl);
  return (
    <article className="flex flex-col gap-3.5 rounded-sheet border border-rule bg-sheet p-4 transition-control hover:border-rule-strong sm:p-5">
      <header className="flex items-start gap-3">
        <Initials name={profile.displayName} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 text-lg leading-snug font-medium break-words">{profile.displayName}</h3>
            {profile.isDemo && (
              <Badge tone="sample" className="text-xs">
                Demo profile
              </Badge>
            )}
          </div>
          {profile.city && (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-ink-soft">
              <MapPin aria-hidden="true" size={13} className="shrink-0" />
              <span className="sr-only">City: </span>
              <span className="min-w-0 break-words">{profile.city}</span>
            </p>
          )}
        </div>
      </header>

      {profile.lookingFor && (
        <p className="text-base break-words">
          <span className="text-ink-soft">Looking for </span>
          {lowerFirst(profile.lookingFor)}
        </p>
      )}

      {reasons.length > 0 && (
        <ul className="flex flex-col gap-1 border-l-2 border-proven pl-3 text-sm">
          {reasons.map((reason) => (
            <li key={reason} className="break-words">
              {reason}
            </li>
          ))}
        </ul>
      )}

      <SkillChips
        skills={profile.provenSkills}
        owner={profile.displayName}
        activeSkill={activeSkill}
        onPickSkill={onPickSkill}
      />

      {mentorFor.length > 0 && (
        <a
          href={practiseHref(mentorFor[0])}
          className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-accent-bright underline underline-offset-4 hover:text-ink"
        >
          <Dumbbell aria-hidden="true" size={14} className="shrink-0" />
          <span className="break-words">Practise {mentorFor[0]} on your map</span>
        </a>
      )}

      {profile.contactUrl && host && (
        <a
          href={profile.contactUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-accent-bright underline underline-offset-4 hover:text-ink"
        >
          Contact on {host}
          <ExternalLink aria-hidden="true" size={14} />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}

      {onRemove && match.courses !== undefined && <FriendCourses name={profile.displayName} courses={match.courses} />}

      {!onRemove && match.canRequest && (
        <AddFriend
          publicId={profile.publicId}
          name={profile.displayName}
          initiallySent={match.requestSent === true}
          onFriends={onChanged}
        />
      )}

      {onRemove && match.canPing && <PingButton publicId={profile.publicId} name={profile.displayName} />}

      {onRemove && <RemoveFriend name={profile.displayName} onRemove={() => onRemove(profile.publicId)} />}
    </article>
  );
}

/** Friend requests and pings waiting for the viewer, at the top of the page. */
function Inbox({ view, onChanged }: { view: NetworkView; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const requests = view.friendRequests.filter((entry) => !gone.has(`r:${entry.publicId}`));
  const pings = view.pings.filter((entry) => !gone.has(`p:${entry.publicId}`));
  if (requests.length === 0 && pings.length === 0 && !error) return null;

  /** `busyKey` marks the pressed button; `doneKey` (`r:<publicId>` or `p:<publicId>`) hides the row. */
  async function act(busyKey: string, doneKey: string, run: () => Promise<Result<object>>, reload: boolean) {
    setBusy(busyKey);
    setError(null);
    const result = await run();
    setBusy(null);
    if (!result.ok) return setError(result.message);
    setGone((previous) => new Set(previous).add(doneKey));
    if (reload) onChanged();
  }

  return (
    <div className="flex flex-col gap-4">
      {requests.length > 0 && (
        <section aria-labelledby="requests-heading" className="flex flex-col gap-3 rounded-sheet border border-proven bg-sheet p-4 sm:p-5">
          <h2 id="requests-heading" className="flex items-center gap-2 text-lg font-medium">
            <UserPlus aria-hidden="true" size={19} className="text-proven" />
            Friend requests <span className="text-base font-normal text-ink-soft">{requests.length}</span>
          </h2>
          <ul className="flex flex-col gap-3">
            {requests.map((entry) => (
              <li key={entry.publicId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="min-w-0 text-base break-words">
                  <span className="font-medium">{entry.displayName}</span>
                  {entry.city && <span className="text-ink-soft"> · {entry.city}</span>}
                  <span className="text-ink-soft"> wants to be friends · {timeAgo(entry.since)}</span>
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    pending={busy === `r:accept:${entry.publicId}`}
                    disabled={busy !== null && busy !== `r:accept:${entry.publicId}`}
                    aria-label={`Accept ${entry.displayName}'s friend request`}
                    onClick={() => act(`r:accept:${entry.publicId}`, `r:${entry.publicId}`, () => acceptFriendRequest(entry.publicId), true)}
                  >
                    <Check aria-hidden="true" size={16} />
                    Accept
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    pending={busy === `r:decline:${entry.publicId}`}
                    disabled={busy !== null && busy !== `r:decline:${entry.publicId}`}
                    aria-label={`Decline ${entry.displayName}'s friend request`}
                    onClick={() => act(`r:decline:${entry.publicId}`, `r:${entry.publicId}`, () => removeFriendRequest(entry.publicId), false)}
                  >
                    <X aria-hidden="true" size={16} />
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {pings.length > 0 && (
        <section aria-labelledby="pings-heading" className="flex flex-col gap-3 rounded-sheet border border-rule-strong bg-sheet p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="pings-heading" className="flex items-center gap-2 text-lg font-medium">
              <BellRing aria-hidden="true" size={19} className="text-accent-bright" />
              Pings <span className="text-base font-normal text-ink-soft">{pings.length}</span>
            </h2>
            <Link href="/dashboard" className={buttonClasses("secondary", "sm")}>
              Keep learning
            </Link>
          </div>
          <ul className="flex flex-col gap-2">
            {pings.map((entry) => (
              <li key={entry.publicId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <p className="min-w-0 text-base break-words">
                  <span className="font-medium">{entry.displayName}</span> pinged you
                  <span className="text-ink-soft"> · {timeAgo(entry.at)}</span>
                </p>
                <Button
                  variant="quiet"
                  size="sm"
                  pending={busy === `p:${entry.publicId}`}
                  aria-label={`Dismiss ${entry.displayName}'s ping`}
                  onClick={() => act(`p:${entry.publicId}`, `p:${entry.publicId}`, () => dismissPing(entry.publicId), false)}
                >
                  <X aria-hidden="true" size={16} />
                  Dismiss
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && <ErrorNotice message={error} />}
    </div>
  );
}

/** "Add friend" on a network card, then "Request sent" with a way to cancel. */
function AddFriend({
  publicId,
  name,
  initiallySent,
  onFriends,
}: {
  publicId: string;
  name: string;
  initiallySent: boolean;
  onFriends: () => void;
}) {
  const [sent, setSent] = useState(initiallySent);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setPending(true);
    setError(null);
    const result = await sendFriendRequest(publicId);
    setPending(false);
    if (!result.ok) return setError(result.message);
    if (result.status === "friends") onFriends();
    else setSent(true);
  }

  async function cancel() {
    setPending(true);
    setError(null);
    const result = await removeFriendRequest(publicId);
    setPending(false);
    if (!result.ok) return setError(result.message);
    setSent(false);
  }

  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      {sent ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-1.5 text-sm text-ink-soft" role="status">
            <Check aria-hidden="true" size={15} className="text-proven" />
            Request sent
          </p>
          <Button variant="quiet" size="sm" pending={pending} aria-label={`Cancel your friend request to ${name}`} onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          pending={pending}
          aria-label={`Add ${name} as a friend`}
          onClick={send}
        >
          <UserPlus aria-hidden="true" size={16} />
          Add friend
        </Button>
      )}
      {error && <ErrorNotice message={error} />}
    </div>
  );
}

/** "Ping" on a friend's card: a nudge to study, at most once an hour. */
function PingButton({ publicId, name }: { publicId: string; name: string }) {
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function ping() {
    setPending(true);
    setNote(null);
    const result = await pingFriend(publicId);
    setPending(false);
    setNote(result.ok ? { ok: true, text: `Pinged ${name}.` } : { ok: false, text: result.message });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        pending={pending}
        disabled={note?.ok === true}
        aria-label={`Ping ${name}`}
        onClick={ping}
      >
        <BellRing aria-hidden="true" size={16} />
        Ping
      </Button>
      {note && (
        <p role="status" className={note.ok ? "text-sm text-ink-soft" : "text-sm text-ink"}>
          {note.text}
        </p>
      )}
    </div>
  );
}

/** A friend's courses: proven of total, with a thin bar like the course cards. */
function FriendCourses({ name, courses }: { name: string; courses: FriendCourse[] | null }) {
  if (courses === null) return <p className="text-sm text-ink-soft">{name} keeps their courses private.</p>;
  if (courses.length === 0) return <p className="text-sm text-ink-soft">No courses yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium text-ink-soft">Studying</h4>
      <ul className="flex flex-col gap-2.5">
        {courses.map((course, index) => {
          const percent = course.total > 0 ? Math.round((course.proven / course.total) * 100) : 0;
          return (
            <li key={`${course.title}-${index}`} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 break-words">{course.title}</span>
                <span className="shrink-0 text-ink-soft">
                  {course.proven} of {course.total} proven
                </span>
              </div>
              <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-raised">
                <div className="h-full rounded-full bg-proven" style={{ width: `${percent}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "5 min ago", "3 h ago", "2 days ago". */
function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** "Remove friend", with a second click to confirm, so a slip doesn't cost a friendship. */
function RemoveFriend({ name, onRemove }: { name: string; onRemove: () => Promise<string | null> }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    const failure = await onRemove();
    setPending(false);
    if (failure) setError(failure);
  }

  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      {confirming ? (
        <div role="group" aria-label={`Remove ${name}?`} className="flex flex-wrap items-center gap-2">
          <p className="text-sm">Remove {name}? You stop seeing each other.</p>
          <Button variant="secondary" size="sm" pending={pending} onClick={remove}>
            Remove
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <Button variant="quiet" size="sm" className="self-start" onClick={() => setConfirming(true)}>
          Remove friend
        </Button>
      )}
      {error && <ErrorNotice message={error} />}
    </div>
  );
}

/** A quiet circle with someone's initials, so each card has an anchor for the eye. */
function Initials({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full border border-rule-strong bg-raised text-sm font-semibold"
    >
      {letters || "?"}
    </span>
  );
}

function SkillChips({
  skills,
  owner,
  activeSkill = null,
  onPickSkill,
}: {
  skills: ProvenSkill[];
  owner: string;
  /** Without onPickSkill the chips are plain labels, as on your own profile. */
  activeSkill?: string | null;
  onPickSkill?: (title: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  if (skills.length === 0) {
    return <p className="text-sm text-ink-soft">No proven skills yet.</p>;
  }
  const shown = showAll ? skills : skills.slice(0, SKILLS_SHOWN);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-soft">
        Proved {countLabel(skills.filter((skill) => !skill.pretest).length, "skill", "skills")}
        {skills.some((skill) => skill.pretest) && (
          <>, and known from a pre-test: {skills.filter((skill) => skill.pretest).length}</>
        )}
      </p>
      <ul id={listId} className="flex flex-wrap gap-1.5">
        {shown.map((skill) => {
          const active = activeSkill !== null && skillsMatch(skill.title, activeSkill);
          return (
            <li key={skill.title} className="max-w-full min-w-0">
              <span
                className={`inline-flex max-w-full items-center rounded-full border text-[13px] leading-5 font-medium ${
                  skill.pretest ? "border-dashed" : ""
                } ${active ? "border-proven bg-proven text-paper" : "border-proven/50 bg-proven/10 text-proven"}`}
              >
                {onPickSkill ? (
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onPickSkill(skill.title)}
                    title={`On ${skill.mapTitle}. Show everyone who proved it.`}
                    className="min-h-7 min-w-0 cursor-pointer rounded-full px-2.5 py-0.5 break-words hover:underline"
                  >
                    {skill.title}
                  </button>
                ) : (
                  <span className="min-w-0 px-2.5 py-0.5 break-words" title={`On ${skill.mapTitle}`}>
                    {skill.title}
                  </span>
                )}
                {skill.pretest && (
                  <span className="-ml-1.5 pr-2.5 text-xs" title={PRETEST_PROOF_LABEL}>
                    <span aria-hidden="true">· Known (pre-test)</span>
                    <span className="sr-only">. {PRETEST_PROOF_LABEL}</span>
                  </span>
                )}
                {skill.evidenceUrl && (
                  <a
                    href={skill.evidenceUrl}
                    className="-ml-1 mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-proven/20 hover:text-ink"
                  >
                    <FileCheck aria-hidden="true" size={13} />
                    <span className="sr-only">
                      {skill.pretest
                        ? `Evidence page for ${skill.title}, known from a pre-test by ${owner}`
                        : `Evidence page for ${skill.title}, proved by ${owner}`}
                    </span>
                  </a>
                )}
              </span>
            </li>
          );
        })}
        {skills.length > SKILLS_SHOWN && (
          <li>
            <button
              type="button"
              aria-expanded={showAll}
              aria-controls={listId}
              onClick={() => setShowAll((value) => !value)}
              className="min-h-7 cursor-pointer rounded-full px-2 text-[13px] font-medium text-ink-soft underline underline-offset-4 hover:text-ink"
            >
              {showAll ? "Show fewer" : `+${skills.length - SKILLS_SHOWN} more`}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

function JoinCard({
  view,
  intent,
  headingRef,
  onSaved,
}: {
  view: NetworkView;
  intent: Intent;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onSaved: (me: MyProfileView) => void;
}) {
  const note =
    intent === "network"
      ? "Make your profile to join the network. Everyone in it can then see you and your proven skills."
      : intent === "invite"
        ? "Make your profile first, so your friends know who invited them."
        : "Your friends see this, and the network does too once you join it. Delete it any time.";
  return (
    <Card className={intent ? "border-proven sm:p-5" : "border-rule sm:p-5"}>
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-medium outline-none">
        Make your profile
      </h2>
      <p className="mt-1.5 text-sm text-ink-soft">{note}</p>
      <div className="mt-3">
        {view.signInRequired ? (
          <div className="flex flex-col gap-2">
            <a href={LOGIN_HREF} className={`${buttonClasses("primary", "sm")} self-start`}>
              {SIGN_IN_LEAD} to make a profile
            </a>
            <p className="text-xs text-ink-soft">Signing in shows people it&apos;s really you.</p>
          </div>
        ) : (
          <ProfileForm
            initial={{
              displayName: view.displayName ?? "",
              city: "",
              lookingFor: "",
              contactUrl: "",
            }}
            submitLabel={
              intent === "network" ? "Join the network" : intent === "invite" ? "Save and invite" : "Save profile"
            }
            inNetwork={intent === "network" ? true : undefined}
            onSaved={onSaved}
          />
        )}
      </div>
    </Card>
  );
}

function MyProfileCard({
  me,
  headingRef,
  onSaved,
  onLeft,
}: {
  me: MyProfileView;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onSaved: (me: MyProfileView) => void;
  onLeft: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const cardId = useId();
  const editButtonId = `${cardId}-edit`;
  const leaveButtonId = `${cardId}-leave`;
  const confirmButtonId = `${cardId}-confirm`;
  const focusLater = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

  // The confirmation replaces the button that opened it, so focus moves to its first button.
  useEffect(() => {
    if (confirmLeave) document.getElementById(confirmButtonId)?.focus();
  }, [confirmLeave, confirmButtonId]);
  const host = contactHost(me.contactUrl);

  async function leave() {
    setLeaving(true);
    setLeaveError(null);
    const result = await deleteProfile();
    setLeaving(false);
    if (result.ok) onLeft();
    else setLeaveError(result.message);
  }

  return (
    <Card className="border-rule sm:p-5">
      <h2 ref={headingRef} tabIndex={-1} className="text-lg font-medium outline-none">
        Your profile
      </h2>

      {editing ? (
        <div className="mt-4">
          <ProfileForm
            initial={{
              displayName: me.displayName,
              city: me.city,
              lookingFor: me.lookingFor,
              contactUrl: me.contactUrl ?? "",
            }}
            submitLabel="Save changes"
            focusOnOpen
            onSaved={(next) => {
              setEditing(false);
              onSaved(next);
            }}
            onCancel={() => {
              setEditing(false);
              focusLater(editButtonId);
            }}
          />
        </div>
      ) : (
        <>
          <p className="mt-3 text-xl font-medium break-words">{me.displayName}</p>
          <dl className="mt-2 flex flex-col gap-1 text-base">
            {me.city && (
              <div className="flex items-start gap-2">
                <dt className="mt-1 shrink-0">
                  <MapPin aria-hidden="true" size={16} className="text-ink-soft" />
                  <span className="sr-only">City</span>
                </dt>
                <dd className="min-w-0 break-words text-ink-soft">{me.city}</dd>
              </div>
            )}
            {me.lookingFor && (
              <div className="flex flex-wrap gap-x-1.5">
                <dt className="font-semibold">Looking for:</dt>
                <dd className="min-w-0 break-words">{me.lookingFor}</dd>
              </div>
            )}
            {me.contactUrl && host && (
              <div className="flex flex-wrap gap-x-1.5">
                <dt className="font-semibold">Contact:</dt>
                <dd className="min-w-0 break-all">
                  <a
                    href={me.contactUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-accent-bright underline underline-offset-4 hover:text-ink"
                  >
                    {host}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </dd>
              </div>
            )}
          </dl>

          <div className="mt-4">
            {me.provenSkills.length > 0 ? (
              <SkillChips skills={me.provenSkills} owner="you" />
            ) : (
              <p className="text-base text-ink-soft">
                No proven skills yet. Explain a skill in a teach-back to prove it, and it shows here for others to see.
              </p>
            )}
            {me.learning.length > 0 && (
              <p className="mt-3 text-sm text-ink-soft">
                Learning {countLabel(me.learning.length, "skill", "skills")}. Only matching uses this list.
              </p>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button id={editButtonId} variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Edit profile
            </Button>
            {!confirmLeave && (
              <Button id={leaveButtonId} variant="quiet" size="sm" onClick={() => setConfirmLeave(true)}>
                Delete profile
              </Button>
            )}
          </div>

          {confirmLeave && (
            <div
              role="group"
              aria-labelledby="leave-question"
              className="mt-4 flex flex-col gap-3 rounded-control border border-danger/70 bg-danger-surface p-4"
            >
              <p id="leave-question" className="text-base">
                Delete your profile? You leave the network and lose your friends here. Your maps and proven skills stay.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button id={confirmButtonId} variant="primary" size="sm" pending={leaving} onClick={leave}>
                  Delete my profile
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setConfirmLeave(false);
                    setLeaveError(null);
                    focusLater(leaveButtonId);
                  }}
                >
                  Stay
                </Button>
              </div>
              {leaveError && <ErrorNotice message={leaveError} />}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

type FormValues = {
  displayName: string;
  city: string;
  lookingFor: string;
  contactUrl: string;
};

function ProfileForm({
  initial,
  submitLabel,
  onSaved,
  onCancel,
  focusOnOpen = false,
  inNetwork,
}: {
  initial: FormValues;
  submitLabel: string;
  /** Sent with the profile: true joins the network as the profile is made. Left out, the setting stays. */
  inNetwork?: boolean;
  onSaved: (me: MyProfileView) => void;
  onCancel?: () => void;
  /** Moves focus to the first field, for a form that replaced the button that opened it. */
  focusOnOpen?: boolean;
}) {
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const formId = useId();
  const ids = {
    displayName: `${formId}-name`,
    city: `${formId}-city`,
    lookingFor: `${formId}-looking`,
    contactUrl: `${formId}-contact`,
  };

  useEffect(() => {
    if (focusOnOpen) document.getElementById(ids.displayName)?.focus();
    // Only when the form first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(field: keyof FormValues, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    if (errors[field]) setErrors((previous) => ({ ...previous, [field]: undefined }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setFailure(null);
    const checked = checkProfileInput(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      const first = (["displayName", "city", "lookingFor", "contactUrl"] as const).find(
        (field) => checked.errors[field],
      );
      if (first) document.getElementById(ids[first])?.focus();
      return;
    }
    setErrors({});
    setSaving(true);
    const result = await saveProfile(checked.value, inNetwork);
    setSaving(false);
    if (result.ok) onSaved(result.me);
    else setFailure(result.message);
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <Field id={ids.displayName} label="Name to show" error={errors.displayName}>
        {(control) => (
          <TextInput
            {...control}
            value={values.displayName}
            onChange={(event) => update("displayName", event.target.value)}
            maxLength={MAX_NAME_LENGTH * 2}
            autoComplete="name"
            required
          />
        )}
      </Field>
      <Field id={ids.city} label="City (optional)" error={errors.city}>
        {(control) => (
          <TextInput
            {...control}
            value={values.city}
            onChange={(event) => update("city", event.target.value)}
            maxLength={MAX_CITY_LENGTH * 2}
            autoComplete="address-level2"
          />
        )}
      </Field>
      <Field
        id={ids.lookingFor}
        label="Looking for (optional)"
        hint="One line, such as “a mentor for SQL”."
        error={errors.lookingFor}
      >
        {(control) => (
          <TextInput
            {...control}
            value={values.lookingFor}
            onChange={(event) => update("lookingFor", event.target.value)}
            maxLength={MAX_LOOKING_FOR_LENGTH * 2}
          />
        )}
      </Field>
      <Field
        id={ids.contactUrl}
        label="Contact link (optional)"
        hint="A link that starts with https://, such as your LinkedIn page. Everyone who can see your profile sees it."
        error={errors.contactUrl}
      >
        {(control) => (
          <TextInput
            {...control}
            type="url"
            inputMode="url"
            value={values.contactUrl}
            onChange={(event) => update("contactUrl", event.target.value)}
            maxLength={MAX_CONTACT_LENGTH * 2}
            placeholder="https://"
            autoComplete="url"
          />
        )}
      </Field>
      {failure && <ErrorNotice message={failure} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" pending={saving}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** Shown when the viewer has no maps, so there is nothing to match on yet. */
function NoMapsCard() {
  return (
    <Card className="border-rule bg-raised/40 sm:p-5">
      <h2 className="text-lg font-medium">No skill map yet</h2>
      <p className="mt-1.5 text-sm text-ink-soft">
        Matches come from the skills on your maps. Build one or start a course, and people who proved those skills show
        up first.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="/" className={buttonClasses("primary", "sm")}>
          Build a map
        </Link>
        <Link href="/courses" className={buttonClasses("secondary", "sm")}>
          Browse courses
        </Link>
      </div>
    </Card>
  );
}

/** "Practise this": the server redirects to that skill on your own map, or to courses teaching it. */
function practiseHref(skillTitle: string): string {
  return `/api/network/practise?skill=${encodeURIComponent(skillTitle)}`;
}

/** Everything the search box looks through on a card, in lower case. */
function searchText(profile: PublicProfile): string {
  return [profile.displayName, profile.city, profile.lookingFor, ...profile.provenSkills.map((skill) => skill.title)]
    .join(" ")
    .toLowerCase();
}

/** "A study partner" reads as "Looking for a study partner". Acronyms like "SQL" stay as they are. */
function lowerFirst(text: string): string {
  const [first, second] = Array.from(text);
  return first && second && second === second.toLowerCase() ? first.toLowerCase() + text.slice(first.length) : text;
}

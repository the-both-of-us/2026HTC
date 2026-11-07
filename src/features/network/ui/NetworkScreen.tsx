"use client";

import { ExternalLink, FileCheck, GraduationCap, MapPin, Search, Users } from "lucide-react";
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
import type { Match, MyProfileView, NetworkView, ProvenSkill, PublicProfile } from "../types";
import { fetchNetwork, leaveNetwork, saveProfile, type Result } from "./api";
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
  peopleCount,
  SIGN_IN_LEAD,
  SIGN_IN_REST,
  SKILLS_SHOWN,
} from "./view";

type Loaded = { attempt: number; result: Result<{ view: NetworkView }> };

/** /people: join the network, and find people who proved what you're learning. */
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
      <h1 className="text-3xl font-medium">People</h1>
      <p className="mt-2 max-w-2xl text-lg text-ink-soft">
        Find people who have proved the skills you&apos;re learning, or who are learning the same ones.
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
  profileHeading: RefObject<HTMLHeadingElement | null>;
  joinHeading: RefObject<HTMLHeadingElement | null>;
  statusLine: RefObject<HTMLParagraphElement | null>;
}) {
  const matching = canMatch(view);
  const total = peopleCount(view);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6">
        {view.me ? (
          <MyProfileCard me={view.me} headingRef={profileHeading} onSaved={onSaved} onLeft={onLeft} />
        ) : (
          <JoinCard view={view} headingRef={joinHeading} onSaved={onSaved} />
        )}
        {!view.viewerHasMaps && <NoMapsCard />}
      </div>

      <div className="flex min-w-0 flex-col gap-8">
        <p
          ref={statusLine}
          tabIndex={-1}
          role="status"
          className="flex flex-wrap items-center gap-2.5 text-base text-ink-soft outline-none"
        >
          {total === 0 ? "Nobody else has joined yet." : `${countLabel(total, "person", "people")} in the network.`}
          {stale && (
            <span className="inline-flex items-center gap-2">
              <Spinner size={16} />
              Updating.
            </span>
          )}
        </p>
        {failedMessage && <ErrorNotice message={failedMessage} onRetry={onRetry} />}

        {hasDemo(view) && (
          <p className="rounded-control border border-dashed border-amber/60 bg-amber/10 px-4 py-3 text-base">
            {DEMO_NOTE}
          </p>
        )}

        {matching && !hasAnyMatch(view) && total > 0 && (
          <p className="text-base">
            Nobody matches your skills yet. As you and others prove more skills, matches show up here.
          </p>
        )}

        {view.mentors.length > 0 && (
          <PeopleSection
            id="mentors"
            icon={<GraduationCap aria-hidden="true" size={22} className="text-proven" />}
            title="Could mentor you"
            description="They proved skills that you're still learning."
            entries={view.mentors}
          />
        )}
        {view.peers.length > 0 && (
          <PeopleSection
            id="peers"
            icon={<Users aria-hidden="true" size={22} className="text-accent-bright" />}
            title="Learning what you're learning"
            description="Study together: they're working on the same skills as you."
            entries={view.peers}
          />
        )}
        {view.everyone.length > 0 && (
          <PeopleSection
            id="everyone"
            icon={<Search aria-hidden="true" size={22} className="text-ink-soft" />}
            title={everyoneHeading(view)}
            description={everyoneDescription(view)}
            entries={view.everyone}
          />
        )}
      </div>
    </div>
  );
}

function PeopleSection({
  id,
  icon,
  title,
  description,
  entries,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  entries: Match[];
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div>
        <h2 id={headingId} className="flex items-start gap-2.5 text-2xl font-medium">
          <span className="mt-1 shrink-0">{icon}</span>
          <span className="min-w-0">
            {title} <span className="text-base font-normal text-ink-soft">({entries.length})</span>
          </span>
        </h2>
        <p className="mt-1 text-base text-ink-soft">{description}</p>
      </div>
      <ul className="grid gap-4 xl:grid-cols-2">
        {entries.map(({ profile, reasons }) => (
          <li key={profile.publicId} className="min-w-0">
            <PersonCard profile={profile} reasons={reasons} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PersonCard({ profile, reasons }: { profile: PublicProfile; reasons: string[] }) {
  const host = contactHost(profile.contactUrl);
  return (
    <article className="flex h-full flex-col gap-3 rounded-sheet border border-control-edge bg-sheet p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 text-xl leading-snug font-medium break-words">{profile.displayName}</h3>
        {profile.isDemo && (
          <Badge tone="sample" className="shrink-0">
            Demo profile
          </Badge>
        )}
      </div>
      {(profile.city || profile.lookingFor) && (
        <dl className="flex flex-col gap-1 text-base">
          {profile.city && (
            <div className="flex items-start gap-2">
              <dt className="mt-1 shrink-0">
                <MapPin aria-hidden="true" size={16} className="text-ink-soft" />
                <span className="sr-only">City</span>
              </dt>
              <dd className="min-w-0 break-words text-ink-soft">{profile.city}</dd>
            </div>
          )}
          {profile.lookingFor && (
            <div className="flex flex-wrap gap-x-1.5">
              <dt className="font-semibold">Looking for:</dt>
              <dd className="min-w-0 break-words">{profile.lookingFor}</dd>
            </div>
          )}
        </dl>
      )}

      {reasons.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-control bg-raised/70 px-3.5 py-2.5 text-base">
          {reasons.map((reason) => (
            <li key={reason} className="break-words">
              {reason}
            </li>
          ))}
        </ul>
      )}

      <SkillChips skills={profile.provenSkills} owner={profile.displayName} />

      {profile.contactUrl && host && (
        <a
          href={profile.contactUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-auto inline-flex items-center gap-1.5 self-start font-semibold text-accent-bright underline underline-offset-4 hover:text-ink"
        >
          Contact on {host}
          <ExternalLink aria-hidden="true" size={15} />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
    </article>
  );
}

function SkillChips({ skills, owner }: { skills: ProvenSkill[]; owner: string }) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  if (skills.length === 0) {
    return <p className="text-base text-ink-soft">No proven skills yet.</p>;
  }
  const shown = showAll ? skills : skills.slice(0, SKILLS_SHOWN);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">Proven skills ({skills.length})</p>
      <ul id={listId} className="flex flex-wrap gap-1.5">
        {shown.map((skill) => (
          <li key={skill.title} className="min-w-0 max-w-full">
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-proven/70 bg-proven/10 py-0.5 pr-1 pl-2.5 text-sm font-medium text-proven">
              <span className="min-w-0 break-words" title={`On ${skill.mapTitle}`}>
                {skill.title}
              </span>
              {skill.evidenceUrl ? (
                <a
                  href={skill.evidenceUrl}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-proven/20 hover:text-ink"
                >
                  <FileCheck aria-hidden="true" size={14} />
                  <span className="sr-only">
                    {`Evidence page for ${skill.title}, proved by ${owner}`}
                  </span>
                </a>
              ) : (
                <span className="w-1" aria-hidden="true" />
              )}
            </span>
          </li>
        ))}
      </ul>
      {skills.length > SKILLS_SHOWN && (
        <Button
          variant="quiet"
          size="sm"
          className="self-start"
          aria-expanded={showAll}
          aria-controls={listId}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? "Show fewer" : `Show all ${skills.length}`}
        </Button>
      )}
    </div>
  );
}

function JoinCard({
  view,
  headingRef,
  onSaved,
}: {
  view: NetworkView;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onSaved: (me: MyProfileView) => void;
}) {
  return (
    <Card>
      <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-medium outline-none">
        Join the network
      </h2>
      <p className="mt-2 text-base text-ink-soft">
        Your profile shows everyone the skills you&apos;ve proved and the map each one is on. You can leave at any
        time, which deletes it.
      </p>
      <div className="mt-4">
        {view.signInRequired ? (
          <p className="text-base">
            <a
              href={LOGIN_HREF}
              className="font-semibold text-accent-bright underline underline-offset-4 hover:text-ink"
            >
              {SIGN_IN_LEAD}
            </a>
            {SIGN_IN_REST}
          </p>
        ) : (
          <ProfileForm
            initial={{ displayName: view.displayName ?? "", city: "", lookingFor: "", contactUrl: "" }}
            submitLabel="Join the network"
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
    const result = await leaveNetwork();
    setLeaving(false);
    if (result.ok) onLeft();
    else setLeaveError(result.message);
  }

  return (
    <Card>
      <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-medium outline-none">
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
                No proven skills yet. Explain a skill in a teach-back to prove it, and it shows here for others to
                see.
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
                Leave the network
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
                Leave the network? Your profile is deleted and nobody can find you here. Your maps and proven skills
                stay.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button id={confirmButtonId} variant="primary" size="sm" pending={leaving} onClick={leave}>
                  Leave and delete my profile
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

type FormValues = { displayName: string; city: string; lookingFor: string; contactUrl: string };

function ProfileForm({
  initial,
  submitLabel,
  onSaved,
  onCancel,
  focusOnOpen = false,
}: {
  initial: FormValues;
  submitLabel: string;
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
      const first = (["displayName", "city", "lookingFor", "contactUrl"] as const).find((field) => checked.errors[field]);
      if (first) document.getElementById(ids[first])?.focus();
      return;
    }
    setErrors({});
    setSaving(true);
    const result = await saveProfile(checked.value);
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
        hint="A link that starts with https://, such as your LinkedIn page. Everyone can see it."
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
    <Card>
      <h2 className="text-xl font-medium">No skill map yet</h2>
      <p className="mt-2 text-base text-ink-soft">
        Matching works from the skills on your maps. Build a map from a job posting, or start a course, and people who
        proved those skills show up here.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
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

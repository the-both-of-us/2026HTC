"use client";

import { MapCanvas } from "@/features/skill-map/client";
import { QrCode, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, buttonClasses, ErrorNotice, Field, PageShell, StateMark, TextInput } from "@/shared/ui";
import type { CircleActivity, CircleView } from "../circles";
import { cheerProof, circleUrl, fetchCircle, joinCircle } from "./api";
import { CircleFeed, CircleRaceBoard } from "./CirclePanels";
import { CircleToasts, useToasts } from "./CircleToasts";
import { InviteDialog, ShareInviteButton, type InviteDialogHandle } from "./Invite";
import "./circles.css";

/**
 * Often enough that a proof shows on the projector within about 4 seconds (the server keeps
 * each read for 1.5 s). A poll never starts while the last one is still out.
 */
const POLL_MS = 2500;
const MAX_NAME = 24;
/** How long a newly proved card pulses on the shared map. */
const PULSE_MS = 3200;

type Load = { status: "loading" } | { status: "missing" } | { status: "failed" } | { status: "ready"; view: CircleView; now: number };

/** The circle page: join on a phone, or watch everyone's progress live on a big screen. */
export function CircleScreen({ code }: { code: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [stale, setStale] = useState(false);
  const [retry, setRetry] = useState(0);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let stopped = false;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The next poll waits for this one to finish, and a hidden tab does not poll at all.
    async function poll() {
      if (busy || stopped) return;
      busy = true;
      clearTimeout(timer);
      if (!document.hidden) {
        try {
          const result = await fetchCircle(code);
          if (!stopped) {
            setLoad(result === "missing" ? { status: "missing" } : { status: "ready", view: result, now: Date.now() });
            setStale(false);
          }
        } catch {
          // Keep showing the last good view; only an empty page turns into an error.
          if (!stopped) {
            setLoad((current) => (current.status === "ready" ? current : { status: "failed" }));
            setStale(true);
          }
        }
      }
      busy = false;
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    }
    const wake = () => void poll();
    document.addEventListener("visibilitychange", wake);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [code, retry, refresh]);

  if (load.status === "loading") return <CircleSkeleton />;
  if (load.status === "missing") {
    return (
      <PageShell width="reading">
        <h1 className="text-3xl font-medium">This circle is not here</h1>
        <p className="mt-3 text-lg text-ink-soft">
          The link may be incomplete, or the person who started it closed it. Ask them for a new QR code.
        </p>
        <Link href="/" className={`${buttonClasses("primary")} mt-6`}>
          Build your own map
        </Link>
      </PageShell>
    );
  }
  if (load.status === "failed") {
    return (
      <PageShell width="reading">
        <ErrorNotice
          message="The circle could not be loaded. Check your connection and try again."
          onRetry={() => {
            setLoad({ status: "loading" });
            setRetry((count) => count + 1);
          }}
        />
      </PageShell>
    );
  }
  return (
    <LoadedCircle view={load.view} now={load.now} stale={stale} onChanged={() => setRefresh((count) => count + 1)} />
  );
}

/** "Sam", "Sam and Lee", "Sam, Lee and Priya", "Sam, Lee, Priya and 4 others". */
function memberLine(view: CircleView): string {
  const names = view.members.map((member) => (member.isYou ? `${member.name} (you)` : member.name));
  if (names.length === 1) return view.members[0].isYou ? "Just you so far" : `Started by ${names[0]}`;
  const shown = names.length > 4 ? names.slice(0, 3) : names;
  const rest = names.length - shown.length;
  const list = rest > 0 ? `${shown.join(", ")} and ${rest} others` : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return `Learning together: ${list}`;
}

const SEEN_CHEERS = (code: string) => `oryx-circle-cheers-seen:${code}`;
/** On the first load, a cheer this recent still gets a toast: they probably just missed it. */
const RECENT_CHEER_MS = 2 * 60_000;

/** `now` is when this view arrived, so times move on with each poll. */
function LoadedCircle({
  view: served,
  now,
  stale,
  onChanged,
}: {
  view: CircleView;
  now: number;
  stale: boolean;
  onChanged: () => void;
}) {
  const inviteRef = useRef<InviteDialogHandle>(null);
  const { toasts, push, dismiss } = useToasts();
  const [pulseId, setPulseId] = useState<string | null>(null);
  /** Cheers sent from here that the next poll may not show yet. */
  const [sent, setSent] = useState<Record<string, number>>({});
  const seenProofs = useRef<Set<string> | null>(null);
  const seenCheers = useRef<Set<string> | null>(null);
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(pulseTimer.current), []);

  // Only ever rendered in the browser: the first view arrives from a fetch.
  const url = circleUrl(served.code);

  const view = useMemo<CircleView>(
    () => ({
      ...served,
      feed: served.feed.map((item) =>
        item.id in sent ? { ...item, youCheered: true, cheers: Math.max(item.cheers, sent[item.id]) } : item,
      ),
    }),
    [served, sent],
  );

  // New proofs since the last poll get a toast and a pulse on the map. The first load only
  // remembers what is already there, so nobody's history is replayed.
  useEffect(() => {
    const ids = served.feed.map((item) => item.id);
    if (!seenProofs.current) {
      seenProofs.current = new Set(ids);
      return;
    }
    const seen = seenProofs.current;
    const fresh = served.feed.filter((item) => !seen.has(item.id)).reverse();
    ids.forEach((id) => seen.add(id));
    if (fresh.length === 0) return;
    for (const item of fresh.slice(-3)) {
      push({
        id: `proof-${item.id}`,
        kind: "proof",
        fingerprint: item.nodeId,
        text: item.isYou ? `You just proved ${item.nodeTitle}` : `${item.name} just proved ${item.nodeTitle}`,
      });
    }
    // Off, then on: a second proof of the same skill pulses again.
    clearTimeout(pulseTimer.current);
    setPulseId(null);
    const nodeId = fresh[fresh.length - 1].nodeId;
    requestAnimationFrame(() => setPulseId(nodeId));
    pulseTimer.current = setTimeout(() => setPulseId(null), PULSE_MS);
  }, [served.feed, push]);

  // Cheers on your proofs: a toast on the next poll. On the first load, only ones newer than
  // the last you saw here, or from the last two minutes.
  useEffect(() => {
    const cheers = served.cheersForYou;
    let fresh: typeof cheers;
    if (!seenCheers.current) {
      let since = now - RECENT_CHEER_MS;
      try {
        const stored = Date.parse(localStorage.getItem(SEEN_CHEERS(served.code)) ?? "");
        if (Number.isFinite(stored)) since = Math.min(since, stored);
      } catch {
        // Storage blocked: fall back to the last two minutes.
      }
      fresh = cheers.filter((cheer) => Date.parse(cheer.at) > since);
      seenCheers.current = new Set(cheers.map((cheer) => cheer.id));
    } else {
      const seen = seenCheers.current;
      fresh = cheers.filter((cheer) => !seen.has(cheer.id));
      cheers.forEach((cheer) => seen.add(cheer.id));
    }
    if (cheers[0]) {
      try {
        localStorage.setItem(SEEN_CHEERS(served.code), cheers[0].at);
      } catch {
        // Fine: it only decides what the next visit toasts.
      }
    }
    if (fresh.length === 0) return;
    const [newest, ...older] = fresh;
    push({
      id: `cheer-${newest.id}`,
      kind: "cheer",
      text:
        older.length === 0
          ? `${newest.name} cheered your proof of ${newest.nodeTitle}`
          : `${newest.name} and ${older.length} more cheered your proofs`,
    });
  }, [served.cheersForYou, served.code, now, push]);

  async function cheer(item: CircleActivity) {
    setSent((current) => ({ ...current, [item.id]: item.cheers + 1 }));
    try {
      const { cheers } = await cheerProof(view.code, item.id);
      setSent((current) => ({ ...current, [item.id]: cheers }));
      onChanged();
    } catch (caught) {
      setSent((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      push({ id: `cheer-error-${item.id}`, kind: "error", text: (caught as Error).message });
    }
  }

  const member = view.yourMapId !== null;
  const openInvite = () => inviteRef.current?.open();

  return (
    <PageShell width="full">
      <div className="flex flex-col lg:h-dvh">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-rule px-4 pt-5 pb-4 sm:px-6">
          <div className="min-w-0">
            <h1 className="text-[1.75rem] leading-tight font-medium text-balance sm:text-[2.125rem]">{view.title}</h1>
            <p className="mt-1 text-lg text-ink-soft">{memberLine(view)}</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            {member && (
              <Link href={`/map/${view.yourMapId}`} className={`${buttonClasses("primary", "lg")} sm:order-last`}>
                Open my map
              </Link>
            )}
            {/* A projector gets the big QR code; a phone gets its share sheet and the code too. */}
            <div className="hidden lg:block">
              <Button variant="secondary" size="lg" onClick={openInvite}>
                <UserPlus aria-hidden="true" size={18} />
                Invite
              </Button>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 lg:hidden">
              {url && <ShareInviteButton title={view.title} url={url} />}
              <Button variant="secondary" onClick={openInvite}>
                <QrCode aria-hidden="true" size={17} />
                QR code
              </Button>
            </div>
          </div>
        </header>

        <div className="grid gap-4 px-4 py-4 sm:px-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_18.5rem] min-[1400px]:grid-cols-[minmax(0,1fr)_21rem]">
          <section
            aria-labelledby="circle-map"
            className="order-last flex h-[30rem] min-h-0 flex-col rounded-sheet border border-rule-strong bg-paper lg:order-none lg:h-auto"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-rule px-4 py-2">
              <h2 id="circle-map" className="text-lg font-medium">
                Shared map
              </h2>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
                <li className="inline-flex items-center gap-1.5">
                  <StateMark state="proven" size={13} />
                  Proved in the circle
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <StateMark state="available" size={13} />
                  {member ? "Open for you" : "Open to start"}
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <StateMark state="locked" size={13} />
                  Locked
                </li>
              </ul>
            </div>
            <div className="relative min-h-0 flex-1">
              <MapCanvas
                skills={view.map.nodes}
                states={view.states}
                selectedId={null}
                sourceKind={view.map.sourceKind}
                reveal={false}
                justProvenId={pulseId}
                justUnlockedIds={NONE}
                onSelect={noop}
                avatars={view.provedBy}
                compact
              />
            </div>
          </section>

          <aside aria-label="Race and live activity" className="flex flex-col gap-4 lg:min-h-0">
            {!member && <JoinForm code={view.code} />}
            <CircleRaceBoard view={view} now={now} onInvite={openInvite} />
            <CircleFeed
              feed={view.feed}
              now={now}
              canCheer={member}
              stale={stale}
              onCheer={cheer}
              className={view.feed.length > 0 ? "max-h-[28rem] lg:max-h-none lg:min-h-0 lg:flex-1" : undefined}
            />
          </aside>
        </div>
      </div>

      {url && <InviteDialog ref={inviteRef} title={view.title} url={url} />}
      <CircleToasts toasts={toasts} onDismiss={dismiss} />
    </PageShell>
  );
}

const NONE: string[] = [];
const noop = () => {};

function JoinForm({ code }: { code: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Please type the name your circle will see.");
    setPending(true);
    setError(null);
    try {
      const { mapId } = await joinCircle(code, name);
      router.push(`/map/${mapId}`);
    } catch (caught) {
      setError((caught as Error).message);
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-sheet border-[1.5px] border-ink bg-sheet p-4">
      <h2 className="text-lg font-medium">Join this circle</h2>
      <p className="text-ink-soft">
        You get your own copy of the map. Teach each topic back in your own words, and the circle sees it land.
      </p>
      <Field id="circle-join-name" label="Your name in the circle" hint={`Up to ${MAX_NAME} characters. Others see this.`}>
        {(control) => (
          <TextInput
            {...control}
            value={name}
            maxLength={MAX_NAME}
            autoComplete="nickname"
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      {error && <ErrorNotice message={error} />}
      <Button type="submit" size="lg" pending={pending}>
        Join circle
      </Button>
    </form>
  );
}

/** The first load: the page's shape in quiet blocks, so nothing jumps when it arrives. */
export function CircleSkeleton() {
  const block = "rounded-sheet bg-raised motion-safe:animate-pulse";
  return (
    <PageShell width="full">
      <div className="flex flex-col lg:h-dvh" aria-busy="true">
        <p role="status" className="sr-only">
          Loading the circle.
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-rule px-4 pt-5 pb-4 sm:px-6">
          <div className="flex flex-col gap-2.5">
            <div className={`${block} h-9 w-72 max-w-[80vw]`} />
            <div className={`${block} h-5 w-56`} />
          </div>
          <div className={`${block} h-13 w-40`} />
        </div>
        <div className="grid gap-4 px-4 py-4 sm:px-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_18.5rem] min-[1400px]:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="dotted-canvas order-last h-[30rem] rounded-sheet border border-rule-strong lg:order-none lg:h-auto" />
          <div className="flex flex-col gap-4">
            <div className={`${block} h-44`} />
            <div className={`${block} h-64 lg:flex-1`} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}

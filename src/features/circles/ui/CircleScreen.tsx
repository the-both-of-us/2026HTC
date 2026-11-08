"use client";

import { MapCanvas } from "@/features/skill-map/client";
import { CircleRace } from "@/features/streaks/client";
import { PartyPopper, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, buttonClasses, ErrorNotice, Field, PageShell, Spinner, TextInput } from "@/shared/ui";
import type { CircleView } from "../circles";
import { circleUrl, fetchCircle, joinCircle } from "./api";
import { CircleQr } from "./CircleQr";

/** Often enough that a judge sees their own pass on the projector within seconds. */
const POLL_MS = 3000;
const MAX_NAME = 24;

type Load = { status: "loading" } | { status: "missing" } | { status: "failed" } | { status: "ready"; view: CircleView; now: number };

/** The circle page: join on a phone, or watch everyone's progress live on a big screen. */
export function CircleScreen({ code }: { code: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [stale, setStale] = useState(false);
  const [retry, setRetry] = useState(0);

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
  }, [code, retry]);

  if (load.status === "loading") {
    return (
      <PageShell width="reading">
        <p role="status" className="flex items-center gap-3 text-ink-soft">
          <Spinner size={18} /> Loading the circle.
        </p>
      </PageShell>
    );
  }
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
  return <LoadedCircle view={load.view} now={load.now} stale={stale} />;
}

/** `now` is when this view arrived, so times move on with each poll. */
function LoadedCircle({ view, now, stale }: { view: CircleView; now: number; stale: boolean }) {
  const total = view.map.nodes.length;
  // Read-only: proven once anyone in the circle has proved it, else open or locked for the viewer.
  const states = view.states;

  return (
    <PageShell width="full">
      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:h-dvh lg:flex-row lg:py-5">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <header>
            <p className="text-sm font-medium tracking-wide text-proven uppercase">Study circle · Learn it together</p>
            <h1 className="mt-1 text-2xl font-medium sm:text-3xl">{view.title}</h1>
            <p className="mt-1 text-ink-soft">
              {view.members.length} {view.members.length === 1 ? "member" : "members"} · each on their own copy · prove it to
              your circle
            </p>
            <p className="mt-1 truncate lg:hidden">
              With {view.members.slice(0, 5).map((member) => member.name).join(", ")}
              {view.members.length > 5 && ` and ${view.members.length - 5} more`}
            </p>
          </header>

          {view.yourMapId ? (
            <Link href={`/map/${view.yourMapId}`} className={`${buttonClasses("primary", "lg")} self-start`}>
              Open my map
            </Link>
          ) : (
            <JoinForm code={view.code} />
          )}

          <div className="relative h-[60dvh] min-h-80 overflow-hidden rounded-sheet border border-rule-strong lg:h-auto lg:flex-1">
            <MapCanvas
              skills={view.map.nodes}
              states={states}
              selectedId={null}
              sourceKind={view.map.sourceKind}
              reveal={false}
              justProvenId={null}
              justUnlockedIds={[]}
              onSelect={() => {}}
              avatars={view.provedBy}
            />
          </div>
        </div>

        <aside className="flex flex-col gap-5 lg:w-88 lg:shrink-0 lg:overflow-y-auto">
          <CircleRace view={view} now={now} />
          <section aria-labelledby="circle-scan" className="hidden rounded-sheet border border-rule-strong bg-sheet/80 p-4 lg:block">
            <h2 id="circle-scan" className="mb-3 text-lg font-medium">Scan to join</h2>
            <CircleQr url={circleUrl(view.code)} size={256} />
          </section>

          <section aria-labelledby="circle-members" className="rounded-sheet border border-rule-strong bg-sheet/80 p-4">
            <h2 id="circle-members" className="mb-3 flex items-center gap-2 text-lg font-medium">
              <Users aria-hidden="true" size={18} /> Who&apos;s in
            </h2>
            <ul className="flex flex-col gap-2">
              {view.members.map((member, index) => (
                <li key={index} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {member.name}
                    {member.isYou && <span className="text-ink-soft"> (you)</span>}
                  </span>
                  <span className="shrink-0 text-sm text-ink-soft tabular-nums">
                    {member.proved} of {total} proved
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="circle-feed" className="rounded-sheet border border-rule-strong bg-sheet/80 p-4">
            <h2 id="circle-feed" className="mb-3 flex items-center gap-2 text-lg font-medium">
              <PartyPopper aria-hidden="true" size={18} /> Live activity
            </h2>
            {stale && <p className="mb-2 text-sm text-amber">Reconnecting. What you see may be a few seconds old.</p>}
            {view.feed.length === 0 ? (
              <p className="text-ink-soft">Nobody has proved a skill yet. The first one shows up here within seconds.</p>
            ) : (
              <ol aria-live="polite" className="flex flex-col gap-2.5">
                {view.feed.map((item) => (
                  <li key={`${item.name}-${item.nodeId}-${item.at}`} className="leading-snug">
                    <strong className="font-medium">{item.name}</strong> proved {item.nodeTitle}
                    <span className="text-sm text-ink-soft"> · {timeAgo(item.at, now)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </PageShell>
  );
}

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
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-sheet border border-accent/50 bg-sheet/80 p-4 sm:max-w-md">
      <p>You get your own copy of this map. Teach each skill back in your own words, and your circle sees it land.</p>
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

/** "just now", "4 min ago", "2 h ago", then "3 days ago". */
function timeAgo(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

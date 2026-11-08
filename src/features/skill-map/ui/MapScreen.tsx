"use client";

import { PublishCourseButton } from "@/features/courses/client";
import { LiveGridCard, LiveGridStrip } from "@/features/grid/client";
import { HowItWorksButton } from "@/features/landing/client";
import { ProgramCrumb } from "@/features/programs/client";
import { ShareProofButton } from "@/features/proof/client";
import { ProofReward, RelightCheck, StreakNudge, useMapHabits, type ProofRewardData } from "@/features/streaks/client";
import { FinalInterview } from "@/features/teachback/client";
import clsx from "clsx";
import { BookOpen, Compass, Lock, Network, Sparkles, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { Badge, Button, buttonClasses, ErrorNotice, PageShell, Spinner } from "@/shared/ui";
import { deriveNodeStates } from "../states";
import type { PublicSkillMap } from "../storage";
import { MapCanvas } from "./MapCanvas";
import { fetchMapWithProgress, fetchProven } from "./mapApi";
import { SkillList } from "./SkillList";
import { SkillPanel, type ProvenNotice } from "./SkillPanel";

const PHONE_SCREEN = "(max-width: 640px)";
/** Long enough for the entrance to finish on a map of about eight rows. */
const REVEAL_MS = 1800;

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "failed" }
  | { status: "ready"; map: PublicSkillMap; proven: Record<string, string>; isOwner: boolean };

/** The whole map screen: loads the map, then shows it. */
/**
 * voiceReady comes from the server, which checked that its voice key works.
 * banner shows above the header (the study circle line), ownerActions beside the owner's buttons.
 */
export function MapScreen({
  mapId,
  voiceReady = false,
  banner,
  ownerActions,
}: {
  mapId: string;
  voiceReady?: boolean;
  banner?: ReactNode;
  ownerActions?: ReactNode;
}) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    fetchMapWithProgress(mapId, abort.signal)
      .then((result) => {
        setLoad(
          result.kind === "missing"
            ? { status: "missing" }
            : { status: "ready", map: result.map, proven: result.proven, isOwner: result.isOwner },
        );
      })
      .catch(() => {
        if (!abort.signal.aborted) setLoad({ status: "failed" });
      });
    return () => abort.abort();
  }, [mapId, attempt]);

  if (load.status === "loading") return <MapScreenLoading />;

  if (load.status === "missing") {
    return (
      <StateCard icon={<Compass aria-hidden="true" size={24} />} title="This map is not here">
        <p className="text-ink-soft">
          The link may be incomplete, or the map may have been deleted. You can build a new one
          from a job posting, a PDF or a topic.
        </p>
        <Link href="/" className={buttonClasses("primary")}>
          Build a new map
        </Link>
      </StateCard>
    );
  }

  if (load.status === "failed") {
    return (
      <StateCard icon={<Network aria-hidden="true" size={24} />} title="Your skill map">
        <ErrorNotice
          className="w-full text-left"
          message="The map could not be loaded. Your progress is saved, so try again."
          onRetry={() => {
            setLoad({ status: "loading" });
            setAttempt((count) => count + 1);
          }}
        />
      </StateCard>
    );
  }

  return (
    <LoadedMap
      map={load.map}
      initialProven={load.proven}
      isOwner={load.isOwner}
      voiceReady={voiceReady}
      banner={banner}
      ownerActions={ownerActions}
    />
  );
}

/** A calm centred card for a screen with nothing to show yet. */
function StateCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <PageShell width="reading">
      <div className="my-auto flex flex-col items-center gap-4 rounded-sheet border border-rule-strong bg-sheet px-6 py-12 text-center">
        <span className="flex size-13 items-center justify-center rounded-control border border-accent/40 bg-accent/10 text-accent-bright">
          {icon}
        </span>
        <h1 className="text-2xl font-medium">{title}</h1>
        {children}
      </div>
    </PageShell>
  );
}

/** How many ghost cards sit in each row of the loading picture. */
const GHOST_ROWS = [2, 4, 3, 1];

/** Shown while the map loads, and by the route while it resolves: a ghost of the map to come. */
export function MapScreenLoading() {
  return (
    <PageShell width="full">
      <div className="flex flex-1 flex-col lg:h-dvh lg:flex-none">
        <div aria-hidden="true" className="flex items-center gap-4 border-b border-rule px-4 py-4 sm:px-6">
          <div className="animate-placeholder size-13 rounded-sheet bg-raised" />
          <div className="flex flex-col gap-2.5">
            <div className="animate-placeholder h-5 w-56 max-w-full rounded-full bg-raised" />
            <div className="animate-placeholder h-2 w-40 rounded-full bg-raised" />
          </div>
        </div>
        <div className="dotted-canvas relative flex min-h-[70dvh] flex-1 flex-col items-center justify-center gap-10 overflow-hidden px-4 lg:min-h-0">
          <div aria-hidden="true" className="flex flex-col items-center gap-10">
            {GHOST_ROWS.map((count, row) => (
              <div key={row} className="flex gap-4">
                {Array.from({ length: count }, (_, index) => (
                  <div
                    key={index}
                    style={{ "--placeholder-delay": `${row * 0.18}s` } as CSSProperties}
                    className="animate-placeholder h-14 w-20 rounded-sheet border-[1.5px] border-dashed border-control-edge/70 bg-raised/70 sm:w-44"
                  />
                ))}
              </div>
            ))}
          </div>
          <p
            role="status"
            className="absolute bottom-6 flex items-center gap-2.5 rounded-control border border-rule-strong bg-sheet/95 px-4 py-2 text-ink-soft"
          >
            <Spinner size={16} />
            Loading your skill map.
          </p>
        </div>
      </div>
    </PageShell>
  );
}

function LoadedMap({
  map,
  initialProven,
  isOwner,
  voiceReady,
  banner,
  ownerActions,
}: {
  map: PublicSkillMap;
  initialProven: Record<string, string>;
  isOwner: boolean;
  voiceReady: boolean;
  banner?: ReactNode;
  ownerActions?: ReactNode;
}) {
  const [proven, setProven] = useState(initialProven);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // This component only mounts in the browser, after the fetch, so matchMedia is safe.
  const [view, setView] = useState<View>(() =>
    window.matchMedia(PHONE_SCREEN).matches ? "list" : "map",
  );
  const [playReveal, setPlayReveal] = useState(true);
  const [notice, setNotice] = useState<ProvenNotice | null>(null);
  // The habit loop: streak, topic of the day, fading. Only for the map's owner.
  const { habits, reload: reloadHabits, afterProof } = useMapHabits(map.id, isOwner);
  const [reward, setReward] = useState<ProofRewardData | null>(null);
  const [relitId, setRelitId] = useState<string | null>(null);

  // The entrance plays once: after this, nothing may replay it.
  useEffect(() => {
    if (view !== "map") return;
    const timer = setTimeout(() => setPlayReveal(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [view]);

  const states = useMemo(() => deriveNodeStates(map, { proven }), [map, proven]);
  const provenCount = map.nodes.filter((node) => states[node.id] === "proven").length;
  const allProven = map.nodes.length > 0 && provenCount === map.nodes.length;
  const selected = map.nodes.find((node) => node.id === selectedId) ?? null;
  const nextSkill = map.nodes.find((node) => states[node.id] === "available") ?? null;
  const featured = map.nodes.find((node) => node.id === habits?.topicOfTheDay) ?? null;
  const selectedDim = selected ? (habits?.dim[selected.id] ?? 0) : 0;

  const selectSkill = useCallback((nodeId: string) => {
    setSelectedId(nodeId);
    setNotice(null);
  }, []);

  const closePanel = useCallback(() => {
    const closedId = selectedId;
    setSelectedId(null);
    setNotice(null);
    // Put focus back on the skill that was open, in whichever view is showing.
    if (closedId) {
      const target = document.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(closedId)}"], [data-skill-button="${CSS.escape(closedId)}"]`,
      );
      target?.focus({ preventScroll: false });
    }
  }, [selectedId]);

  // Escape closes the panel, but not while typing: that could lose someone's answer.
  useEffect(() => {
    if (!selectedId) return;
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.key === "Escape" && !target.closest("textarea, input")) closePanel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, closePanel]);

  const handleProven = useCallback(
    async (nodeId: string) => {
      // Count the skill as proven even if the refresh fails or returns stale data.
      const fresh = await fetchProven(map.id).catch(() => proven);
      const next = { ...fresh, [nodeId]: fresh[nodeId] ?? "just-proven" };
      const before = deriveNodeStates(map, { proven });
      const after = deriveNodeStates(map, { proven: next });
      const unlockedIds = map.nodes
        .filter((node) => before[node.id] === "locked" && after[node.id] === "available")
        .map((node) => node.id);

      setPlayReveal(false);
      setProven(next);
      setNotice({ nodeId, unlockedIds });
      setReward(null);
      void afterProof(nodeId).then(setReward);
    },
    [map, proven, afterProof],
  );

  return (
    <PageShell width="full">
      <div className="flex flex-1 flex-col lg:h-dvh lg:flex-none">
        {/* The circle line stays one slim row, so the map keeps the height. */}
        {banner && <div className="[&>p]:py-1.5">{banner}</div>}
        {/*
          Two short rows: the title with its progress and the actions, then the streak, today's
          topic and the final interview beside the view tabs. Everything else is one click away.
        */}
        <header className="flex flex-col gap-2 border-b border-rule px-4 pt-2.5 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="min-w-0 flex-1 basis-72">
              {map.program && <ProgramCrumb program={map.program} proven={provenCount} total={map.nodes.length} />}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <h1 className="line-clamp-2 min-w-0 text-xl leading-tight font-medium break-words" title={map.title}>
                  {map.title}
                </h1>
                {map.subtitle && <p className="hidden truncate text-sm text-ink-soft xl:block">{map.subtitle}</p>}
                <Progress proven={provenCount} total={map.nodes.length} />
              </div>
            </div>
            {/* Compact buttons with one primary: the next skill. */}
            <div className="flex flex-wrap items-center gap-2 [&>button]:min-h-9! [&>button]:px-3! [&>button]:text-sm!">
              <HowItWorksButton />
              {isOwner && (
                <>
                  {ownerActions}
                  <PublishMenu mapId={map.id} />
                  {provenCount > 0 && <ShareProofButton mapId={map.id} provenCount={provenCount} />}
                  {nextSkill && (
                    <Button size="sm" onClick={() => selectSkill(nextSkill.id)} className="grow sm:grow-0">
                      <Sparkles aria-hidden="true" size={16} />
                      {provenCount === 0 ? "Start learning" : "Next skill"}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2 pb-2 text-sm">
              {isOwner && habits && (
                <StreakNudge
                  streak={habits.streak}
                  topicOfTheDay={
                    featured && states[featured.id] === "available"
                      ? { title: featured.title, onOpen: () => selectSkill(featured.id) }
                      : null
                  }
                />
              )}
              {isOwner && !allProven && (
                <p className="inline-flex min-h-8 items-center gap-1.5 text-ink-soft" title="The final interview unlocks when every topic is proven.">
                  <Lock aria-hidden="true" size={14} className="shrink-0" />
                  <span>
                    <span className="text-ink">Final interview</span>{" "}
                    <span className="tabular-nums">in {map.nodes.length - provenCount}</span>
                    <span className="sr-only"> topics: it unlocks when every topic is proven</span>
                  </span>
                </p>
              )}
              {/* A topic has no source, so say plainly where the map came from. */}
              {map.sourceKind === "topic" && (
                <Badge tone="sample" className="text-xs">
                  AI-generated from a topic, with no citations
                </Badge>
              )}
            </div>
            <div className="-mx-4 flex items-center gap-3 sm:mx-0">
              {map.energyRelated && <LiveGridStrip className="hidden lg:flex" />}
              <ViewTabs view={view} onChange={setView} />
            </div>
          </div>
        </header>

        {/* Once every topic is proven the final interview needs room, so it gets its own strip. */}
        {isOwner && allProven && (
          <FinalInterview mapId={map.id} provenCount={provenCount} topicCount={map.nodes.length} voiceReady={voiceReady} />
        )}

        <div className="relative flex min-h-[60dvh] flex-1 lg:min-h-0">
          <div
            id="skills-view"
            role="tabpanel"
            aria-labelledby={`tab-${view}`}
            className="relative min-w-0 flex-1"
          >
            {view === "map" ? (
              <div className="absolute inset-0">
                <MapCanvas
                  skills={map.nodes}
                  states={states}
                  selectedId={selectedId}
                  sourceKind={map.sourceKind}
                  reveal={playReveal}
                  justProvenId={notice?.nodeId ?? null}
                  justUnlockedIds={notice?.unlockedIds ?? []}
                  dim={habits?.dim}
                  featuredId={habits?.topicOfTheDay}
                  onSelect={selectSkill}
                />
              </div>
            ) : (
              <div className="px-4 pt-5 sm:px-6 lg:absolute lg:inset-0 lg:overflow-y-auto">
                <div className="mx-auto max-w-3xl">
                  <SkillList
                    skills={map.nodes}
                    states={states}
                    selectedId={selectedId}
                    sourceKind={map.sourceKind}
                    onSelect={selectSkill}
                    dim={habits?.dim}
                    featuredId={habits?.topicOfTheDay}
                  />
                </div>
              </div>
            )}
          </div>

          {selected && (
            <SkillPanel
              mapId={map.id}
              skills={map.nodes}
              skill={selected}
              states={states}
              sourceKind={map.sourceKind}
              notice={notice}
              isOwner={isOwner}
              voiceReady={voiceReady}
              onSelect={selectSkill}
              onProven={handleProven}
              onClose={closePanel}
              reward={reward && notice?.nodeId === selected.id && <ProofReward reward={reward} />}
              relight={
                states[selected.id] === "proven" &&
                (selectedDim > 0 || relitId === selected.id) && (
                  <RelightCheck
                    key={selected.id}
                    mapId={map.id}
                    nodeId={selected.id}
                    title={selected.title}
                    dim={selectedDim}
                    onRelit={(nodeId) => {
                      setRelitId(nodeId);
                      void reloadHabits();
                    }}
                  />
                )
              }
            />
          )}
        </div>
      </div>

      {/* Below the map on a phone. On a large screen the map fills the window, so the strip above stands in. */}
      {map.energyRelated && <LiveGridCard className="mx-4 mb-24 lg:hidden" />}
    </PageShell>
  );
}

/** Publishing is occasional, so it sits behind one small button instead of a sentence in the header. */
function PublishMenu({ mapId }: { mapId: string }) {
  return (
    <details className="relative">
      <summary className={clsx(buttonClasses("subtle", "sm"), "min-h-9! list-none px-3! [&::-webkit-details-marker]:hidden")}>
        <Upload aria-hidden="true" size={15} />
        Publish
      </summary>
      <div className="absolute top-full right-0 z-30 mt-1.5 w-80 max-w-[calc(100vw-2rem)] rounded-control border border-rule-strong bg-sheet p-3.5 shadow-panel">
        <PublishCourseButton mapId={mapId} />
      </div>
    </details>
  );
}

function Progress({ proven, total }: { proven: number; total: number }) {
  const percent = total === 0 ? 0 : (proven / total) * 100;

  return (
    <div className="flex items-center gap-2.5">
      <div aria-hidden="true" className="h-1.5 w-28 overflow-hidden rounded-full bg-rule-strong sm:w-36">
        <div className="progress-fill h-full rounded-full bg-proven" style={{ width: `${percent}%` }} />
      </div>
      <p role="status" className="text-sm text-ink-soft tabular-nums">
        <span aria-hidden="true">
          {proven}/{total} proven
        </span>
        <span className="sr-only">
          {proven} of {total} skills proven
        </span>
      </p>
    </div>
  );
}

type View = "map" | "list";

const TABS: { view: View; label: string; icon: typeof Network }[] = [
  { view: "map", label: "Knowledge Map", icon: Network },
  { view: "list", label: "All Skills", icon: BookOpen },
];

/** Tabs follow the usual keyboard pattern: Tab enters them, arrow keys move between them. */
function ViewTabs({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const listRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: View = view === "map" ? "list" : "map";
    onChange(next);
    listRef.current?.querySelector<HTMLElement>(`#tab-${next}`)?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="How to show the skills"
      onKeyDown={handleKeyDown}
      className="flex gap-1 px-2 sm:px-0"
    >
      {TABS.map(({ view: tab, label, icon: Icon }) => (
        <button
          key={tab}
          id={`tab-${tab}`}
          type="button"
          role="tab"
          aria-selected={view === tab}
          aria-controls="skills-view"
          tabIndex={view === tab ? 0 : -1}
          onClick={() => onChange(tab)}
          className={clsx(
            "-mb-px flex min-h-11 lg:min-h-10 cursor-pointer items-center gap-2 border-b-2 px-3.5 text-[0.9375rem] transition-control focus-visible:-outline-offset-2",
            view === tab
              ? "border-accent bg-accent/8 font-medium text-ink"
              : "border-transparent text-ink-soft hover:text-ink",
          )}
        >
          <Icon aria-hidden="true" size={16} />
          {label}
        </button>
      ))}
    </div>
  );
}

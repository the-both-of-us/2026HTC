"use client";

import { LiveGridCard } from "@/features/grid/client";
import { ShareProofButton } from "@/features/proof/client";
import clsx from "clsx";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { NodeState } from "@/shared/types";
import { Button, buttonClasses, ErrorNotice, PageShell, Spinner, StateMark } from "@/shared/ui";
import { deriveNodeStates } from "../states";
import type { PublicSkillMap } from "../storage";
import { MapCanvas } from "./MapCanvas";
import { fetchMapWithProgress, fetchProven } from "./mapApi";
import { SkillList } from "./SkillList";
import { SkillPanel, type ProvenNotice } from "./SkillPanel";
import { JobTab } from "./SkillNodeView";

const PHONE_SCREEN = "(max-width: 640px)";
/** Long enough for the entrance to finish on a map of about ten columns. */
const REVEAL_MS = 3000;

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "failed" }
  | { status: "ready"; map: PublicSkillMap; proven: Record<string, string> };

/** The whole map screen: loads the map, then shows it. */
export function MapScreen({ mapId }: { mapId: string }) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    fetchMapWithProgress(mapId, abort.signal)
      .then((result) => {
        setLoad(
          result.kind === "missing"
            ? { status: "missing" }
            : { status: "ready", map: result.map, proven: result.proven },
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
      <PageShell width="reading">
        <h1 className="text-3xl font-medium">This map is not here</h1>
        <p className="mt-3 text-lg">
          The link may be incomplete, or the map may have been deleted. You can build a new one
          from a job posting.
        </p>
        <Link href="/" className={`${buttonClasses("primary")} mt-6 self-start`}>
          Build a new map
        </Link>
      </PageShell>
    );
  }

  if (load.status === "failed") {
    return (
      <PageShell width="reading">
        <h1 className="mb-4 text-3xl font-medium">Your skill map</h1>
        <ErrorNotice
          message="The map could not be loaded. Your progress is saved, so try again."
          onRetry={() => {
            setLoad({ status: "loading" });
            setAttempt((count) => count + 1);
          }}
        />
      </PageShell>
    );
  }

  return <LoadedMap map={load.map} initialProven={load.proven} />;
}

/** Shown while the map loads, and by the route while it resolves. */
export function MapScreenLoading() {
  return (
    <PageShell width="reading">
      <p role="status" className="flex items-center gap-3 text-lg">
        <Spinner size={22} />
        Loading your skill map.
      </p>
    </PageShell>
  );
}

function LoadedMap({
  map,
  initialProven,
}: {
  map: PublicSkillMap;
  initialProven: Record<string, string>;
}) {
  const [proven, setProven] = useState(initialProven);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // This component only mounts in the browser, after the fetch, so matchMedia is safe.
  const [view, setView] = useState<"map" | "list">(() =>
    window.matchMedia(PHONE_SCREEN).matches ? "list" : "map",
  );
  const [playReveal, setPlayReveal] = useState(true);
  const [notice, setNotice] = useState<ProvenNotice | null>(null);

  // The entrance plays once: after this, nothing may replay it.
  useEffect(() => {
    if (view !== "map") return;
    const timer = setTimeout(() => setPlayReveal(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [view]);

  const states = useMemo(() => deriveNodeStates(map, { proven }), [map, proven]);
  const provenCount = map.nodes.filter((node) => states[node.id] === "proven").length;
  const selected = map.nodes.find((node) => node.id === selectedId) ?? null;

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
    function handleKeyDown(event: KeyboardEvent) {
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
    },
    [map, proven],
  );

  return (
    <PageShell width="full">
      <header className="flex flex-col gap-3 px-4 pb-3 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:gap-8 lg:px-10">
        <div className="min-w-0">
          <h1 className="text-[2rem] leading-[1.12] font-medium lg:text-3xl">{map.title}</h1>
          {map.subtitle && <p className="mt-1 text-lg text-ink-soft">{map.subtitle}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <Progress proven={provenCount} total={map.nodes.length} states={states} />
          <ShareProofButton mapId={map.id} provenCount={provenCount} />
          <div role="group" aria-label="How to show the skills" className="flex gap-1.5">
            <Button
              variant="subtle"
              size="sm"
              aria-pressed={view === "map"}
              onClick={() => setView("map")}
            >
              Map
            </Button>
            <Button
              variant="subtle"
              size="sm"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              List
            </Button>
          </div>
        </div>
      </header>

      <div className="relative flex min-h-[70dvh] flex-1 flex-col px-4 pb-4 sm:px-6 lg:min-h-[max(26rem,calc(100dvh-11rem))] lg:px-10">
        <div className="relative flex flex-1 flex-col">
          {view === "map" ? (
            <figure className="flex flex-1 flex-col border border-ink bg-sheet p-1.5">
              <div className="flex flex-1 flex-col border border-ink">
                <div className="relative flex-1">
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-[url(/contours.svg)] bg-cover bg-center opacity-40"
                  />
                  <div className="absolute inset-0">
                    <MapCanvas
                      skills={map.nodes}
                      states={states}
                      selectedId={selectedId}
                      reveal={playReveal}
                      justProvenId={notice?.nodeId ?? null}
                      justUnlockedIds={notice?.unlockedIds ?? []}
                      onSelect={selectSkill}
                    />
                  </div>
                </div>
                <Legend />
              </div>
            </figure>
          ) : (
            <div
              className={clsx(
                "pt-2 lg:absolute lg:inset-0 lg:overflow-y-auto",
                selected && "lg:pr-[31.5rem]",
              )}
            >
              <div className="max-w-3xl">
                <SkillList
                  skills={map.nodes}
                  states={states}
                  selectedId={selectedId}
                  onSelect={selectSkill}
                />
              </div>
            </div>
          )}

          {selected && (
            <SkillPanel
              mapId={map.id}
              skills={map.nodes}
              skill={selected}
              states={states}
              sourceKind={map.sourceKind}
              notice={notice}
              onSelect={selectSkill}
              onProven={handleProven}
              onClose={closePanel}
            />
          )}
        </div>
      </div>

      {map.energyRelated && <LiveGridCard className="mx-4 mb-4 sm:mx-6 lg:mx-10" />}
    </PageShell>
  );
}

/** "3 of 12 proven", with one map symbol per skill as a tally. */
function Progress({
  proven,
  total,
  states,
}: {
  proven: number;
  total: number;
  states: Record<string, NodeState>;
}) {
  const rank: Record<NodeState, number> = { proven: 0, available: 1, locked: 2 };
  const tally = Object.values(states).sort((a, b) => rank[a] - rank[b]);

  return (
    <div className="flex flex-col gap-1">
      <p role="status" className="font-display text-xl font-semibold">
        {proven} of {total} proven
      </p>
      <div aria-hidden="true" className="flex max-w-80 flex-wrap gap-0.5">
        {tally.map((state, index) => (
          <StateMark key={index} state={state} size={14} />
        ))}
      </div>
    </div>
  );
}

/** Like a map sheet's margin: how to read its symbols. */
function Legend() {
  return (
    <figcaption className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-ink bg-sheet px-3 py-2 text-sm">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <li className="inline-flex items-center gap-1.5">
          <StateMark state="proven" size={16} />
          Proven
        </li>
        <li className="inline-flex items-center gap-1.5">
          <StateMark state="available" size={16} />
          Available
        </li>
        <li className="inline-flex items-center gap-1.5">
          <StateMark state="locked" size={16} />
          Locked
        </li>
        <li className="inline-flex items-center gap-1.5">
          <JobTab inline />
          The posting asks for it
        </li>
        <li className="font-display italic">Foundation: leads to a skill the posting asks for</li>
      </ul>
      <p className="hidden font-display italic xl:block">Open any available skill to explain it.</p>
    </figcaption>
  );
}

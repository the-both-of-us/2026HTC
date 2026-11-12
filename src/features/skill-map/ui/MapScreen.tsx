"use client";

import { HowItWorksButton } from "@/features/landing/client";
import { PretestOffer, PretestScreen, usePretest } from "@/features/pretest/client";
import { ProgramCrumb } from "@/features/programs/client";
import { ShareProofButton } from "@/features/proof/client";
import { ProofReward, RelightCheck, StreakNudge, useMapHabits, type ProofRewardData } from "@/features/streaks/client";
import { FinalInterview, YoungLearnerProvider } from "@/features/teachback/client";
import { isYoungAudience } from "@/shared/audience";
import { isPretestProof } from "@/shared/types";
import clsx from "clsx";
import { BookOpen, Compass, ListChecks, Lock, Network, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { Badge, Button, buttonClasses, ErrorNotice, PageShell, Spinner, usePoll } from "@/shared/ui";
import { deriveNodeStates, unlockedEarlyIds } from "../states";
import type { PublicSkillMap } from "../storage";
import { computeNextStep, type NextStep } from "../nextStep";
import { initialUnitId, plannedTopicTotal, unitRail } from "../unitView";
import { BuildPanel } from "./BuildPanel";
import { canvasWait, MAP_POLL_MS, needsMapPoll } from "./buildState";
import { MapActions } from "./MapActions";
import { MapCanvas } from "./MapCanvas";
import { fetchMapOnly, fetchMapWithProgress, fetchProven, unlockSkill } from "./mapApi";
import { SkillList } from "./SkillList";
import { nextStepButtonLabel, NextStepView, SkillPanel, type ProvenNotice } from "./SkillPanel";
import { UnitRail, UnitStartPanel } from "./UnitRail";

const PHONE_SCREEN = "(max-width: 640px)";

/** The skill named by ?skill= in the address, if it is on this map. Only call in the browser. */
function linkedSkillId(map: PublicSkillMap): string | null {
  const id = new URLSearchParams(window.location.search).get("skill");
  return id && map.nodes.some((node) => node.id === id) ? id : null;
}
/** Long enough for the entrance to finish on a map of about eight rows. */
const REVEAL_MS = 1800;

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "failed" }
  | {
      status: "ready";
      map: PublicSkillMap;
      proven: Record<string, string>;
      unlocked: Record<string, string>;
    };

/**
 * The whole map screen: loads the map, then shows it. Only the owner reaches it. banner shows
 * above the header (the study circle line), ownerActions beside the header's other buttons.
 */
export function MapScreen({ mapId, banner, ownerActions }: { mapId: string; banner?: ReactNode; ownerActions?: ReactNode }) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const pollFailures = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    fetchMapWithProgress(mapId, abort.signal)
      .then((result) => {
        setLoad(
          result.kind === "missing"
            ? { status: "missing" }
            : {
                status: "ready",
                map: result.map,
                proven: result.proven,
                unlocked: result.unlocked,
              },
        );
      })
      .catch(() => {
        if (!abort.signal.aborted) setLoad({ status: "failed" });
      });
    return () => abort.abort();
  }, [mapId, attempt]);

  // After a unit is built: fetch the map again without leaving the screen, so the open unit stays open.
  const reloadMap = useCallback(async () => {
    const result = await fetchMapWithProgress(mapId, new AbortController().signal).catch(() => null);
    if (result?.kind !== "found") return;
    setLoad({ status: "ready", map: result.map, proven: result.proven, unlocked: result.unlocked });
  }, [mapId]);

  // While a catalog course is being written (its syllabus, then unit 1) ask for the map again:
  // one request at a time, paused while the tab is hidden, stopped when nothing is running.
  const pollable = load.status === "ready" && needsMapPoll(load.map);
  const pollMap = useCallback(
    async (signal: AbortSignal): Promise<boolean> => {
      try {
        const map = await fetchMapOnly(mapId, signal);
        if (signal.aborted) return false;
        if (!map) return false;
        pollFailures.current = 0;
        setLoad((current) => (current.status === "ready" ? { ...current, map } : current));
        return needsMapPoll(map);
      } catch {
        if (signal.aborted) return false;
        pollFailures.current += 1;
        return pollFailures.current < 5;
      }
    },
    [mapId],
  );
  usePoll(pollable, pollMap, MAP_POLL_MS);

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
      initialUnlocked={load.unlocked}
      banner={banner}
      ownerActions={ownerActions}
      onMapChanged={reloadMap}
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
  initialUnlocked,
  banner,
  ownerActions,
  onMapChanged,
}: {
  map: PublicSkillMap;
  initialProven: Record<string, string>;
  initialUnlocked: Record<string, string>;
  banner?: ReactNode;
  ownerActions?: ReactNode;
  onMapChanged: () => Promise<void>;
}) {
  const [proven, setProven] = useState(initialProven);
  const [unlocked, setUnlocked] = useState(initialUnlocked);
  // A link like /map/<id>?skill=<nodeId> (from "Practise this" on People) opens that skill as a full page.
  const [selectedId, setSelectedId] = useState<string | null>(() => linkedSkillId(map));
  const [openFullPage, setOpenFullPage] = useState(() => linkedSkillId(map) !== null);
  // This component only mounts in the browser, after the fetch, so matchMedia is safe.
  const [view, setView] = useState<View>(() =>
    window.matchMedia(PHONE_SCREEN).matches ? "list" : "map",
  );
  const [playReveal, setPlayReveal] = useState(true);
  const [notice, setNotice] = useState<ProvenNotice | null>(null);
  // The habit loop: streak, topic of the day, fading.
  const { habits, reload: reloadHabits, afterProof } = useMapHabits(map.id);
  const [reward, setReward] = useState<ProofRewardData | null>(null);
  const [relitId, setRelitId] = useState<string | null>(null);

  // The entrance plays once: after this, nothing may replay it.
  useEffect(() => {
    if (view !== "map") return;
    const timer = setTimeout(() => setPlayReveal(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [view]);

  const states = useMemo(() => deriveNodeStates(map, { proven, unlocked }), [map, proven, unlocked]);
  const unlockedEarly = useMemo(() => unlockedEarlyIds(map, { proven, unlocked }), [map, proven, unlocked]);
  // A course built from a syllabus: its units, with the topics each plans and how many are proven.
  const units = useMemo(() => (map.syllabus ? unitRail(map.syllabus, map.nodes, states, proven) : null), [map, states, proven]);
  // The rail and the one-unit canvas only matter with more than one unit (a degree course).
  // While the syllabus is still being written the rail shows from the first unit, with a planning pill.
  const syllabusPlanning = map.syllabus?.planning === true;
  const showUnits = units !== null && (units.length > 1 || syllabusPlanning);
  const [chosenUnitId, setChosenUnitId] = useState<string | null>(() => {
    if (!map.syllabus) return null;
    const atStart = deriveNodeStates(map, { proven: initialProven, unlocked: initialUnlocked });
    return initialUnitId(unitRail(map.syllabus, map.nodes, atStart, initialProven), linkedSkillId(map));
  });
  const activeUnit = showUnits ? (units.find((unit) => unit.id === chosenUnitId) ?? units[0] ?? null) : null;
  // A catalog course with no nodes yet: the canvas says what is being written instead of showing a graph.
  const wait = canvasWait(map);
  // Topics proved by a pre-test question (also those of units not built yet). Marked as such everywhere.
  const knownIds = useMemo(() => new Set(Object.keys(proven).filter((id) => isPretestProof(proven[id]))), [proven]);
  const knownCounts = useMemo(
    () =>
      Object.fromEntries((units ?? []).map((unit) => [unit.id, unit.built ? unit.nodeIds.filter((id) => knownIds.has(id)).length : unit.proved])),
    [units, knownIds],
  );
  const unitNumbers = useMemo(() => Object.fromEntries((units ?? []).map((unit) => [unit.id, unit.number])), [units]);
  // The optional pre-test of a syllabus course, never on a posting or PDF map.
  const [pretestOpen, setPretestOpen] = useState(false);
  const pretest = usePretest(
    map.id,
    map.syllabus !== undefined,
    pretestOpen,
    `${wait ?? "ready"}:${map.syllabus?.units.length ?? 0}:${map.syllabus?.planning === true}`,
  );
  const visibleSkills = useMemo(
    () => (activeUnit ? map.nodes.filter((node) => activeUnit.nodeIds.includes(node.id)) : map.nodes),
    [activeUnit, map.nodes],
  );
  const provenCount = map.nodes.filter((node) => states[node.id] === "proven").length;
  // Progress counts against every topic the syllabus plans, built or not; older maps count their nodes.
  const topicTotal = units ? plannedTopicTotal(units) : map.nodes.length;
  const allProven = map.nodes.length > 0 && provenCount >= topicTotal;
  const selected = map.nodes.find((node) => node.id === selectedId) ?? null;
  // Which unit tests and the course final are passed. Unknown (not loaded yet) counts as not passed.
  const [passed, setPassed] = useState<{ unitTests: ReadonlySet<string>; final: boolean }>({ unitTests: new Set(), final: false });
  const [lastNodeId, setLastNodeId] = useState<string | null>(null);
  const [selectCount, setSelectCount] = useState(0);
  const unitTestsRequired = map.syllabus?.assessment.unitTests === true;
  const fullyProvedUnitIds = (units ?? [])
    .filter((unit) => unit.built && unit.nodeIds.length > 0 && unit.proved >= unit.nodeIds.length)
    .map((unit) => unit.id)
    .join(",");
  useEffect(() => {
    const abort = new AbortController();
    const unitIds = unitTestsRequired && fullyProvedUnitIds ? fullyProvedUnitIds.split(",") : [];
    void fetchPassed(map.id, unitIds, allProven, abort.signal).then((result) => {
      if (result && !abort.signal.aborted) setPassed(result);
    });
    return () => abort.abort();
  }, [map.id, unitTestsRequired, fullyProvedUnitIds, allProven, notice]);

  // The one next step, for the after-proof notice, the Read tab and the header button alike.
  const nextStepFor = useCallback(
    (currentNodeId: string | null, justUnlockedIds: string[] = []): NextStep =>
      computeNextStep({
        skills: map.nodes,
        states,
        units,
        unitTestsRequired,
        passedUnitTests: passed.unitTests,
        finalPassed: passed.final,
        planning: syllabusPlanning,
        justUnlockedIds,
        currentNodeId,
        currentUnitId: activeUnit?.id ?? null,
        program: map.program ?? null,
      }),
    [map.nodes, map.program, states, units, unitTestsRequired, passed, syllabusPlanning, activeUnit?.id],
  );
  const headerStep = nextStepFor(lastNodeId);
  const featured = map.nodes.find((node) => node.id === habits?.topicOfTheDay) ?? null;
  const selectedDim = selected ? (habits?.dim[selected.id] ?? 0) : 0;
  // With a skill open, the header keeps only the title and progress: the actions and the habit row
  // are for the overview. "Start learning" also lives there, where it always opens something.
  const reading = selected !== null;

  const selectSkill = useCallback(
    (nodeId: string) => {
      setSelectedId(nodeId);
      setSelectCount((count) => count + 1);
      setLastNodeId(nodeId);
      setNotice(null);
      // A skill in another unit opens that unit's graph too.
      const holding = units?.find((unit) => unit.nodeIds.includes(nodeId));
      if (holding) setChosenUnitId(holding.id);
    },
    [units],
  );

  const closePanel = useCallback(() => {
    const closedId = selectedId;
    setSelectedId(null);
    setOpenFullPage(false);
    setNotice(null);
    // Put focus back on the skill that was open, in whichever view is showing.
    if (closedId) {
      const target = document.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(closedId)}"], [data-skill-button="${CSS.escape(closedId)}"]`,
      );
      target?.focus({ preventScroll: false });
    }
  }, [selectedId]);

  // Acts on a next step that is not a link: opens the skill, unit, unit test or final it names.
  const goToStep = useCallback(
    (step: NextStep) => {
      if (step.kind === "skill") return selectSkill(step.nodeId);
      setSelectedId(null);
      setOpenFullPage(false);
      setNotice(null);
      if (step.kind === "unit" || step.kind === "unit-test") setChosenUnitId(step.unitId);
      if (step.kind === "unit-test" || step.kind === "final") {
        // The test sits in a strip under the header; wait a frame for the panel to close.
        requestAnimationFrame(() => {
          const strip = document.getElementById(step.kind === "final" ? "next-final" : "next-unit-test");
          strip?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          strip?.focus({ preventScroll: true });
        });
      }
    },
    [selectSkill],
  );

  // The pre-test takes the place of the map. Opening it starts it, or picks it up where it was left.
  const openPretest = useCallback(() => {
    setSelectedId(null);
    setOpenFullPage(false);
    setNotice(null);
    setPretestOpen(true);
    if (pretest.view?.offer !== "taken") void pretest.start();
  }, [pretest]);
  const closePretest = useCallback(() => {
    setPretestOpen(false);
    requestAnimationFrame(() => document.getElementById("pretest-open-button")?.focus({ preventScroll: true }));
  }, []);
  // After a unit is graded: show what is now known on the map behind the pre-test.
  const refreshProven = useCallback(() => {
    void fetchProven(map.id)
      .then(setProven)
      .catch(() => {});
  }, [map.id]);

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
      const before = deriveNodeStates(map, { proven, unlocked });
      const after = deriveNodeStates(map, { proven: next, unlocked });
      const unlockedIds = map.nodes
        .filter((node) => before[node.id] === "locked" && after[node.id] === "available")
        .map((node) => node.id);

      setPlayReveal(false);
      setProven(next);
      setLastNodeId(nodeId);
      setNotice({ nodeId, unlockedIds });
      setReward(null);
      void afterProof(nodeId).then(setReward);
    },
    [map, proven, unlocked, afterProof],
  );

  // "Unlock anyway": the server saves it, then the skill opens here. Throws a sentence on failure.
  const handleUnlock = useCallback(
    async (nodeId: string) => {
      const next = await unlockSkill(map.id, nodeId);
      setUnlocked({ ...next, [nodeId]: next[nodeId] ?? new Date().toISOString() });
    },
    [map.id],
  );

  // On a map for young children, "Explain it to a 10-year-old" reads "Explain it to a friend".
  const screen = (
    <PageShell width="full">
      {/* group/map: in full-page reading (data-reading-page on the panel), the view tabs row hides. */}
      <div className="group/map flex flex-1 flex-col lg:h-dvh lg:flex-none">
        {/* The circle line stays one slim row, so the map keeps the height. */}
        {banner && <div className="[&>p]:py-1 max-sm:[&>p]:text-xs">{banner}</div>}
        {/*
          Short rows: the title with its progress and the actions, then the streak, today's
          topic and the final interview beside the view tabs. On a phone the actions fold into
          "More", so the map starts high on the screen. Everything else is one click away.
        */}
        <header className="flex flex-col gap-1.5 border-b border-rule px-4 pt-2 sm:gap-2 sm:px-6 sm:pt-2.5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <div className="min-w-0 flex-1 basis-full sm:basis-72">
              {map.program && <ProgramCrumb program={map.program} proven={provenCount} total={topicTotal} />}
              <div className="flex items-center gap-x-4 gap-y-1 sm:flex-wrap">
                <h1
                  className="min-w-0 text-lg leading-tight font-medium break-words max-sm:flex-1 max-sm:truncate sm:line-clamp-2 sm:text-xl"
                  title={map.title}
                >
                  {map.title}
                </h1>
                {map.subtitle && <p className="hidden truncate text-sm text-ink-soft xl:block">{map.subtitle}</p>}
                {map.audience && (
                  <p className="hidden truncate text-sm text-ink-soft sm:block" title={`Topics, lessons and grading are pitched for ${map.audience}.`}>
                    Pitched for {map.audience}
                  </p>
                )}
                <Progress proven={provenCount} total={topicTotal} planning={syllabusPlanning} />
              </div>
            </div>
            {/* Compact buttons with one primary: the next skill. Only on the overview. */}
            {reading ? null : (
              <MapActions
                more={
                  <>
                    <HowItWorksButton />
                    {ownerActions}
                    <PretestButton offer={pretest.view?.offer ?? "none"} onOpen={openPretest} />
                    {provenCount > 0 && <ShareProofButton mapId={map.id} provenCount={provenCount} />}
                  </>
                }
                primary={
                  headerStep.kind === "waiting" ? null : "href" in headerStep ? (
                    <Link href={headerStep.href} className={buttonClasses("primary", "sm")}>
                      <Sparkles aria-hidden="true" size={16} />
                      {nextStepButtonLabel(headerStep, provenCount === 0)}
                    </Link>
                  ) : (
                    <Button size="sm" onClick={() => goToStep(headerStep)}>
                      <Sparkles aria-hidden="true" size={16} />
                      {nextStepButtonLabel(headerStep, provenCount === 0)}
                    </Button>
                  )
                }
              />
            )}
          </div>

          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5 group-has-[[data-reading-page]]/map:hidden sm:gap-y-2">
            <div className="flex min-w-0 items-center gap-2 text-sm max-sm:w-full sm:flex-wrap sm:pb-2">
              {!reading && habits && (
                <StreakNudge
                  className="min-w-0"
                  streak={habits.streak}
                  topicOfTheDay={
                    featured && states[featured.id] === "available"
                      ? { title: featured.title, onOpen: () => selectSkill(featured.id) }
                      : null
                  }
                />
              )}
              {/* On a phone the progress count already says how many are left. */}
              {!reading && !allProven && (
                <p
                  className="inline-flex min-h-8 items-center gap-1.5 text-ink-soft max-sm:hidden"
                  title="The final interview unlocks when every topic is proven."
                >
                  <Lock aria-hidden="true" size={14} className="shrink-0" />
                  <span>
                    <span className="text-ink">Final interview</span>{" "}
                    <span className="tabular-nums">in {Math.max(topicTotal - provenCount, 0)}</span>
                    <span className="sr-only"> topics: it unlocks when every topic is proven</span>
                  </span>
                </p>
              )}
              {/* A topic has no source, so say plainly where the map came from. */}
              {!reading && map.sourceKind === "topic" && (
                <span title="AI-generated from a topic, with no source to cite" className="shrink-0">
                  <Badge tone="sample" className="text-xs">
                    AI-made, no citations
                  </Badge>
                </span>
              )}
            </div>
            <div className="-mx-4 flex items-center gap-3 sm:mx-0">
              <ViewTabs view={view} onChange={setView} />
            </div>
          </div>
        </header>

        {pretest.view?.offer === "suggest" && provenCount === 0 && !pretestOpen && (
          <PretestOffer
            onStart={openPretest}
            onDismiss={() => void pretest.dismiss()}
            pending={pretest.pending !== null}
            error={pretest.error}
          />
        )}

        {/* Once every topic is proven the final interview needs room, so it gets its own strip. */}
        {allProven && (
          <div id="next-final" tabIndex={-1} className="outline-none">
            <FinalInterview mapId={map.id} provenCount={provenCount} topicCount={topicTotal} />
          </div>
        )}

        {showUnits && (
          <UnitRail
            units={units}
            selectedId={activeUnit?.id ?? null}
            onSelect={setChosenUnitId}
            planning={syllabusPlanning}
            knownCounts={knownCounts}
          />
        )}

        {/* A degree unit's test, once every topic of the unit shown is proven. */}
        {showUnits && activeUnit?.built && map.syllabus?.assessment.unitTests && activeUnit.nodeIds.length > 0 && activeUnit.proved >= activeUnit.nodeIds.length && (
          <div id="next-unit-test" tabIndex={-1} className="outline-none">
            <FinalInterview
              key={activeUnit.id}
              mapId={map.id}
              unitId={activeUnit.id}
              unitTitle={activeUnit.title}
              provenCount={activeUnit.proved}
              topicCount={activeUnit.nodeIds.length}
            />
          </div>
        )}

        {pretestOpen ? (
          <div className="relative min-h-[60dvh] flex-1 overflow-y-auto lg:min-h-0">
            <PretestScreen
              session={pretest}
              unitNumbers={unitNumbers}
              onClose={closePretest}
              onProgress={refreshProven}
              nextStep={
                <NextStepView
                  step={nextStepFor(null, [])}
                  primary
                  onGo={(step) => {
                    setPretestOpen(false);
                    goToStep(step);
                  }}
                />
              }
            />
          </div>
        ) : (
        <div className="relative flex min-h-[60dvh] flex-1 lg:min-h-0">
          <div
            id="skills-view"
            role="tabpanel"
            aria-labelledby={`tab-${view}`}
            className="relative min-w-0 flex-1"
          >
            {wait ? (
              <div className="absolute inset-0">
                <BuildPanel mapId={map.id} wait={wait} onRestarted={onMapChanged} />
              </div>
            ) : activeUnit && !activeUnit.built ? (
              <div className="absolute inset-0">
                <UnitStartPanel
                  key={activeUnit.id}
                  mapId={map.id}
                  unit={activeUnit}
                  unitCount={units?.length ?? 0}
                  onBuilt={onMapChanged}
                />
              </div>
            ) : view === "map" ? (
              <div className="absolute inset-0">
                {/* Keyed by unit, so each unit's graph opens fitted to the screen. */}
                <MapCanvas
                  key={activeUnit?.id ?? "all"}
                  skills={visibleSkills}
                  states={states}
                  selectedId={selectedId}
                  sourceKind={map.sourceKind}
                  reveal={playReveal}
                  justProvenId={notice?.nodeId ?? null}
                  justUnlockedIds={notice?.unlockedIds ?? []}
                  dim={habits?.dim}
                  featuredId={habits?.topicOfTheDay}
                  unlockedEarly={unlockedEarly}
                  knownIds={knownIds}
                  onSelect={selectSkill}
                />
              </div>
            ) : (
              <div className="px-4 pt-5 sm:px-6 lg:absolute lg:inset-0 lg:overflow-y-auto">
                <div className="mx-auto max-w-3xl">
                  <SkillList
                    skills={visibleSkills}
                    states={states}
                    selectedId={selectedId}
                    sourceKind={map.sourceKind}
                    onSelect={selectSkill}
                    dim={habits?.dim}
                    featuredId={habits?.topicOfTheDay}
                    unlockedEarly={unlockedEarly}
                    knownIds={knownIds}
                  />
                </div>
              </div>
            )}
          </div>

          {selected && (
            <SkillPanel
              initialFullPage={openFullPage}
              mapId={map.id}
              skills={map.nodes}
              skill={selected}
              states={states}
              sourceKind={map.sourceKind}
              notice={notice}
              nextStepFor={nextStepFor}
              onNextStep={goToStep}
              selectCount={selectCount}
              onSelect={selectSkill}
              onProven={handleProven}
              onUnlock={handleUnlock}
              unlockedEarly={unlockedEarly.has(selected.id)}
              knownIds={knownIds}
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
        )}
      </div>

    </PageShell>
  );
  return <YoungLearnerProvider young={isYoungAudience(map.audience)}>{screen}</YoungLearnerProvider>;
}

/**
 * Which of the learner's unit tests and the course final are passed. Reads the same endpoint the
 * test strips use. Null when nothing could be read, so the caller keeps what it had.
 */
async function fetchPassed(
  mapId: string,
  unitIds: string[],
  includeFinal: boolean,
  signal: AbortSignal,
): Promise<{ unitTests: ReadonlySet<string>; final: boolean } | null> {
  const base = `/api/maps/${encodeURIComponent(mapId)}/final`;
  const isPassed = async (url: string): Promise<boolean> => {
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) return false;
      return ((await response.json()) as { state?: string }).state === "passed";
    } catch {
      return false;
    }
  };
  const unitTests = new Set<string>();
  await Promise.all(
    unitIds.map(async (id) => {
      if (await isPassed(`${base}?unit=${encodeURIComponent(id)}`)) unitTests.add(id);
    }),
  );
  const final = includeFinal ? await isPassed(base) : false;
  return signal.aborted ? null : { unitTests, final };
}

/** The way into the pre-test from the header, while it can still help (or to read its result). */
function PretestButton({ offer, onOpen }: { offer: string; onOpen: () => void }) {
  if (offer === "none") return null;
  const label =
    offer === "in-progress" ? "Continue the pre-test" : offer === "taken" ? "Pre-test results" : "Take the pre-test";
  return (
    <button
      id="pretest-open-button"
      type="button"
      onClick={onOpen}
      className={clsx(buttonClasses("subtle", "sm"), "min-h-9! px-3!")}
    >
      <ListChecks aria-hidden="true" size={15} />
      {label}
    </button>
  );
}

function Progress({ proven, total, planning = false }: { proven: number; total: number; planning?: boolean }) {
  const percent = total === 0 ? 0 : (proven / total) * 100;

  return (
    <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
      <div aria-hidden="true" className="h-1.5 w-12 overflow-hidden rounded-full bg-rule-strong sm:w-36">
        <div className="progress-fill h-full rounded-full bg-proven" style={{ width: `${percent}%` }} />
      </div>
      <p role="status" className="text-sm text-ink-soft tabular-nums">
        <span aria-hidden="true">
          {proven}/{total}
          {planning && "+"}
          <span className="max-sm:hidden"> proven</span>
        </span>
        <span className="sr-only">
          {proven} of {total} skills proven{planning ? " so far; more units are still being planned" : ""}
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

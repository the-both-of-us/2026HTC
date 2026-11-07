"use client";

import { ArrowDownLeft, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { Card, ErrorNotice } from "@/shared/ui";
import { changesBetween, isReadingStale } from "../live";
import { capabilityOf, mw, outputOf, percent, RENEWABLE_FAMILIES, signed } from "../metrics";
import type { GridReading, GridSnapshot } from "../types";
import { CapabilityChart } from "./CapabilityChart";
import { GridRoles } from "./GridRoles";
import { AesoSourceLink, GridStatus } from "./GridStatus";
import { MixBarTall } from "./MixBar";
import { ReadTheGrid } from "./ReadTheGrid";
import { UnitField } from "./UnitField";
import { useLiveGrid } from "./useLiveGrid";
import { useNow } from "./useNow";

/** A sentence written by code from the real figures. Old figures are told in the past tense. */
function headline(snapshot: GridSnapshot, stale: boolean): string {
  const variable = outputOf(snapshot, "wind") + outputOf(snapshot, "solar");
  const share = snapshot.generation > 0 ? (variable / snapshot.generation) * 100 : 0;
  const flow = snapshot.interchange;
  const direction =
    flow > 0
      ? `exporting ${mw(flow)} MW to its neighbours`
      : flow < 0
        ? `importing ${mw(-flow)} MW from its neighbours`
        : "neither importing nor exporting";
  return stale
    ? `Wind and solar were making ${percent(share)} of Alberta's generation, and the province was ${direction}.`
    : `Wind and solar are making ${percent(share)} of Alberta's generation, and the province is ${direction}.`;
}

function reserveNote(snapshot: GridSnapshot): string {
  if (snapshot.reserveRequired === null || snapshot.reserveDispatched === null) return "Required figure not given";
  const margin = snapshot.reserveDispatched - snapshot.reserveRequired;
  if (margin === 0) return `Exactly the ${mw(snapshot.reserveRequired)} MW required`;
  return `${mw(Math.abs(margin))} MW ${margin > 0 ? "above" : "below"} the ${mw(snapshot.reserveRequired)} MW required`;
}

function renewableFactor(snapshot: GridSnapshot): string {
  const output = RENEWABLE_FAMILIES.reduce((sum, family) => sum + outputOf(snapshot, family), 0);
  const capability = RENEWABLE_FAMILIES.reduce((sum, family) => sum + capabilityOf(snapshot, family), 0);
  return capability > 0 ? percent((output / capability) * 100) : "Not given";
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-control border border-rule p-3">
      <p className="text-sm text-ink-soft">{label}</p>
      <p className="text-2xl font-medium">{value}</p>
      <p className="text-sm text-ink-soft">{note}</p>
    </div>
  );
}

function Section({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-medium">{title}</h2>
        {intro && <p className="max-w-3xl text-base text-ink-soft">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function ChangeLine({ before, after }: { before: GridSnapshot; after: GridSnapshot }) {
  const changes = changesBetween(before, after);
  const since = before.asOfLabel.slice(-5);
  return (
    <p className="text-sm text-ink-soft">
      Since {since}:{" "}
      {changes.length === 0
        ? "no change in load, wind, solar or gas."
        : changes.map((change) => `${change.label} ${signed(change.delta)} MW`).join(", ")}
    </p>
  );
}

function Interchange({ snapshot }: { snapshot: GridSnapshot }) {
  return (
    <ul className="flex flex-col divide-y divide-rule">
      {snapshot.paths.map(({ path, flow }) => {
        const Icon = flow > 0 ? ArrowUpRight : flow < 0 ? ArrowDownLeft : Minus;
        return (
          <li key={path} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              <Icon size={16} className="text-ink-soft" aria-hidden="true" />
              {path}
            </span>
            <span className="text-ink-soft tabular-nums">
              {flow > 0 ? `${mw(flow)} MW out` : flow < 0 ? `${mw(-flow)} MW in` : "No flow"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const TERMS = [
  ["AIL", "Alberta Internal Load: the power being used in the province right now."],
  ["TNG", "Total Net Generation: what generators are sending to the grid."],
  ["MC", "Maximum Capability: the most a unit or fuel group can produce."],
  ["DCR", "Dispatched Contingency Reserve: capacity held ready in case something fails."],
] as const;

function Terms() {
  return (
    <dl className="flex flex-col gap-2 text-sm">
      {TERMS.map(([term, meaning]) => (
        <div key={term}>
          <dt className="inline font-semibold">{term} </dt>
          <dd className="inline text-ink-soft">{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The live page. Everything here re-renders from the latest real reading. */
export function GridDashboard({ initial }: { initial: GridReading }) {
  const { reading, previous, check } = useLiveGrid(initial);
  const now = useNow(30_000);

  if (!reading || reading.status === "unavailable") {
    return (
      <div className="flex flex-col gap-8">
        <ErrorNotice
          message="We can't reach AESO right now and have no earlier reading saved, so there are no figures to show. We won't guess at them."
          onRetry={() => void check()}
        />
        <p className="text-sm text-ink-soft">
          Source: <AesoSourceLink />
        </p>
        <Section title="Who reads these numbers for a living">
          <GridRoles />
        </Section>
      </div>
    );
  }

  const { snapshot } = reading;
  const stale = isReadingStale(reading, now);

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-col gap-5">
        <GridStatus reading={reading} />

        <Card className="flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-end">
            <div>
              <p className="text-base text-ink-soft">
                {stale ? `At ${snapshot.asOfLabel.slice(-5)}, Alberta was using` : "Alberta is using"}
              </p>
              <p className="text-5xl font-medium tracking-tight sm:text-6xl">
                {mw(snapshot.load)}{" "}
                <span className="text-2xl font-semibold text-ink-soft sm:text-3xl">MW</span>
              </p>
              {previous && <ChangeLine before={previous} after={snapshot} />}
            </div>
            <p className="text-xl">{headline(snapshot, stale)}</p>
          </div>

          <div className="flex flex-col gap-2.5">
            <h2 className="text-base font-semibold">Where the power is coming from</h2>
            <MixBarTall snapshot={snapshot} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Net generation"
              value={`${mw(snapshot.generation)} MW`}
              note={snapshot.capabilityTotal === null ? "Across every fuel" : `Of ${mw(snapshot.capabilityTotal)} MW maximum capability`}
            />
            <Tile
              label="Net interchange"
              value={`${mw(Math.abs(snapshot.interchange))} MW`}
              note={snapshot.interchange > 0 ? "Exporting" : snapshot.interchange < 0 ? "Importing" : "Balanced"}
            />
            <Tile
              label="Dispatched contingency reserve"
              value={snapshot.reserveDispatched === null ? "Not given" : `${mw(snapshot.reserveDispatched)} MW`}
              note={reserveNote(snapshot)}
            />
            <Tile
              label="Renewable capacity factor"
              value={renewableFactor(snapshot)}
              note={stale ? "Wind, solar and hydro" : "Wind, solar and hydro, right now"}
            />
          </div>
        </Card>
      </div>

      <Section
        title="Practise on the live grid"
        intro="Alberta's energy sector runs on these numbers. Work them out the way an analyst or operator would. The answers change with the grid, so you can come back tomorrow and the same question has a new answer."
      >
        <Card>
          <ReadTheGrid snapshot={snapshot} />
        </Card>
      </Section>

      <Section title="Capability and output by fuel" intro={`Each track is how much a fuel group could produce. The filled part is what it ${stale ? "was producing at this reading" : "is producing now"}.`}>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <Card>
            <CapabilityChart snapshot={snapshot} />
          </Card>
          <div className="flex flex-col gap-5">
            <Card className="flex flex-col gap-2">
              <h3 className="text-lg font-medium">Flows at the border</h3>
              <Interchange snapshot={snapshot} />
            </Card>
            <Card className="flex flex-col gap-3">
              <h3 className="text-lg font-medium">Reading the report</h3>
              <Terms />
            </Card>
          </div>
        </div>
      </Section>

      <Section title={stale ? "Every generator, at the last good reading" : "Every generator, right now"}>
        <Card>
          <UnitField snapshot={snapshot} />
        </Card>
      </Section>

      <Section title="Who reads these numbers for a living">
        <GridRoles />
      </Section>
    </div>
  );
}


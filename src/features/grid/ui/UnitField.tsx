"use client";

import { useMemo, useState } from "react";
import { FAMILY_LABELS, FAMILY_ORDER, mw } from "../metrics";
import type { GridSnapshot, GridUnit } from "../types";
import { FAMILY_COLOR, FAMILY_ICON, trackColor } from "./fuelStyle";

/** Pixels per square root of a MW, so that a square's area is proportional to capability. */
const SCALE = 2.2;
const SMALLEST_SIDE = 8;

function unitSide(unit: GridUnit): number {
  return Math.max(SMALLEST_SIDE, Math.round(Math.sqrt(Math.max(unit.capability, 0)) * SCALE));
}

function unitLabel(unit: GridUnit): string {
  return unit.code ? `${unit.name} (${unit.code})` : unit.name;
}

function describeUnit(unit: GridUnit): string {
  return `${unitLabel(unit)}, ${unit.group.toLowerCase()}: ${mw(unit.output)} of ${mw(unit.capability)} MW`;
}

function UnitSquare({ unit, index }: { unit: GridUnit; index: number }) {
  const side = unitSide(unit);
  const share = unit.capability > 0 ? Math.min(Math.max(unit.output, 0) / unit.capability, 1) * 100 : 0;
  const color = FAMILY_COLOR[unit.family];
  const track = trackColor(unit.family);
  return (
    <div
      data-unit={index}
      className="rounded-[2px] hover:outline-2 hover:outline-ink"
      style={{
        width: side,
        height: side,
        background: `linear-gradient(to top, ${color} ${share}%, ${track} ${share}%)`,
      }}
    />
  );
}

/** Every generating asset in the report, as a square that is lit up to its current output. */
export function UnitField({ snapshot }: { snapshot: GridSnapshot }) {
  const units = useMemo(
    () =>
      [...snapshot.units].sort(
        (a, b) =>
          FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family) ||
          b.capability - a.capability,
      ),
    [snapshot.units],
  );
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (units.length === 0) {
    return <p className="text-sm text-ink-soft">This report didn&apos;t include unit-level figures.</p>;
  }

  const running = units.filter((unit) => unit.output > 0).length;
  const biggest = units.reduce((top, unit) => (unit.output > top.output ? unit : top));
  const active = activeIndex === null ? null : units[activeIndex];
  const families = FAMILY_ORDER.filter((family) => units.some((unit) => unit.family === family));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base">
        <strong className="font-semibold">{running}</strong> of {units.length} listed units are producing.
        A square&apos;s size is its maximum capability, and the filled part is what it is producing now.
      </p>

      <p className="min-h-11 rounded-control border border-rule px-3 py-2 text-sm text-ink-soft sm:min-h-0">
        {active ? (
          <span className="text-ink">{describeUnit(active)}</span>
        ) : (
          <>
            Largest producer now: <span className="text-ink">{describeUnit(biggest)}</span>. Hover or tap a
            square for any unit.
          </>
        )}
      </p>

      <div
        role="img"
        aria-label={`${units.length} generating units grouped by fuel, ${running} of them producing. The table below lists every unit.`}
        className="flex flex-col gap-4"
        onPointerOver={(event) => {
          const value = (event.target as HTMLElement).dataset.unit;
          setActiveIndex(value === undefined ? null : Number(value));
        }}
        onPointerLeave={() => setActiveIndex(null)}
      >
        {families.map((family) => {
          const members = units.filter((unit) => unit.family === family);
          const on = members.filter((unit) => unit.output > 0).length;
          const Icon = FAMILY_ICON[family];
          return (
            <div key={family} className="flex flex-col gap-1.5">
              <p className="flex items-center gap-1.5 text-sm text-ink-soft">
                <Icon size={15} aria-hidden="true" />
                <span className="font-semibold text-ink">{FAMILY_LABELS[family]}</span>
                {on} of {members.length} producing
              </p>
              <div className="flex flex-wrap items-end gap-0.5">
                {members.map((unit) => (
                  <UnitSquare key={`${unit.group}-${unit.name}`} unit={unit} index={units.indexOf(unit)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-sm text-ink-soft">
        AESO reports gross capability but net output for assets marked net-to-grid, so a site that powers
        its own plant first can look less busy here than it is.
      </p>

      <details className="text-sm">
        <summary className="cursor-pointer font-semibold">See all {units.length} units as a table</summary>
        <div className="mt-3 max-h-96 overflow-auto">
          <table className="w-full text-right tabular-nums">
            <caption className="sr-only">Every generating unit in the report, in MW, from AESO</caption>
            <thead className="sticky top-0 bg-sheet text-ink-soft">
              <tr className="border-b border-control-edge">
                <th scope="col" className="py-1.5 pr-3 text-left font-semibold">Unit</th>
                <th scope="col" className="px-3 py-1.5 text-left font-semibold">Group</th>
                <th scope="col" className="px-3 py-1.5 font-semibold">Capability</th>
                <th scope="col" className="py-1.5 pl-3 font-semibold">Output</th>
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => (
                <tr key={`${unit.group}-${unit.name}`} className="border-b border-rule">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    {unitLabel(unit)}
                    {unit.netToGrid && <span className="text-ink-soft"> (net-to-grid)</span>}
                  </th>
                  <td className="px-3 py-1.5 text-left">{unit.group}</td>
                  <td className="px-3 py-1.5">{mw(unit.capability)}</td>
                  <td className="py-1.5 pl-3">{mw(unit.output)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

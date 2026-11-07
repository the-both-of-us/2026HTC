"use client";

import clsx from "clsx";
import { useState } from "react";
import { FAMILY_LABELS, familyTotals, mw, percent, type FamilyTotal } from "../metrics";
import type { GridSnapshot } from "../types";
import { FAMILY_COLOR } from "./fuelStyle";

/** A block narrower than this share can't fit its label on a phone, so it prints none. */
const LABEL_FITS_FROM = 12;
const BAR_HINT = "Hover, tap or tab to a block for its figures.";

function describe(item: FamilyTotal): string {
  return `${FAMILY_LABELS[item.family]}: ${mw(item.output)} MW, ${percent(item.share)} of generation`;
}

function Legend({ items }: { items: FamilyTotal[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
      {items.map((item) => (
        <li key={item.family} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-[2px]"
            style={{ backgroundColor: FAMILY_COLOR[item.family] }}
          />
          {FAMILY_LABELS[item.family]}
        </li>
      ))}
    </ul>
  );
}

/** One whole, split by fuel. The tall bar prints shares where they fit and reads out the rest. */
export function MixBarTall({ snapshot }: { snapshot: GridSnapshot }) {
  const items = familyTotals(snapshot);
  const [activeFamily, setActiveFamily] = useState<string | null>(null);
  const active = items.find((item) => item.family === activeFamily);
  const charging = items.find((item) => item.family === "storage" && item.output < 0);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-7 gap-0.5" onPointerLeave={() => setActiveFamily(null)}>
        {items
          .filter((item) => item.share > 0)
          .map((item) => (
            <button
              key={item.family}
              type="button"
              // The name has to start with any label we print, so voice control users can say what they see.
              aria-label={item.share >= LABEL_FITS_FROM ? `${Math.round(item.share)}%. ${describe(item)}` : describe(item)}
              onPointerEnter={() => setActiveFamily(item.family)}
              // A finger lifting counts as the pointer leaving, so a tap has to set it as well.
              onClick={() => setActiveFamily(item.family)}
              onFocus={() => setActiveFamily(item.family)}
              onBlur={() => setActiveFamily(null)}
              className="min-w-0.5 rounded-[4px] px-2 text-left text-sm leading-7 font-medium text-on-dark hover:brightness-115 motion-safe:transition-[flex-grow] motion-safe:duration-700"
              style={{
                flexGrow: item.share,
                flexBasis: 0,
                backgroundColor: FAMILY_COLOR[item.family],
                paddingInline: item.share < LABEL_FITS_FROM ? 0 : undefined,
              }}
            >
              {item.share >= LABEL_FITS_FROM && `${Math.round(item.share)}%`}
            </button>
          ))}
      </div>
      <Legend items={items} />
      <p className="min-h-5 text-sm text-ink-soft">
        {active
          ? describe(active)
          : charging
            ? `Storage is charging at ${mw(-charging.output)} MW. ${BAR_HINT}`
            : BAR_HINT}
      </p>
    </div>
  );
}

/** The small version for a card: the shape of the mix, with its names beside it. */
export function MixBarThin({ snapshot, className }: { snapshot: GridSnapshot; className?: string }) {
  const items = familyTotals(snapshot);
  const summary = items
    .filter((item) => item.share > 0)
    .map((item) => `${FAMILY_LABELS[item.family]} ${Math.round(item.share)}%`)
    .join(", ");

  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      <div role="img" aria-label={`Generation mix: ${summary}`} className="flex h-2 gap-0.5">
        {items
          .filter((item) => item.share > 0)
          .map((item) => (
            <span
              key={item.family}
              className="min-w-0.5 rounded-full motion-safe:transition-[flex-grow] motion-safe:duration-700"
              style={{ flexGrow: item.share, flexBasis: 0, backgroundColor: FAMILY_COLOR[item.family] }}
            />
          ))}
      </div>
      <Legend items={items.filter((item) => item.share > 0)} />
    </div>
  );
}

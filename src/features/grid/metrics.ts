import type { FuelFamily, GridSnapshot } from "./types";

/** The order families take in every chart, so a colour and a position always mean the same. */
export const FAMILY_ORDER: FuelFamily[] = ["gas", "wind", "solar", "hydro", "storage", "other"];

export const FAMILY_LABELS: Record<FuelFamily, string> = {
  gas: "Gas",
  wind: "Wind",
  solar: "Solar",
  hydro: "Hydro",
  storage: "Storage",
  other: "Other",
};

export type FamilyTotal = {
  family: FuelFamily;
  capability: number;
  output: number;
  /** Share of everything being generated, 0 to 100. Storage that is charging counts as 0. */
  share: number;
};

export function outputOf(snapshot: GridSnapshot, family: FuelFamily): number {
  return snapshot.groups
    .filter((group) => group.family === family)
    .reduce((total, group) => total + group.output, 0);
}

export function capabilityOf(snapshot: GridSnapshot, family: FuelFamily): number {
  return snapshot.groups
    .filter((group) => group.family === family)
    .reduce((total, group) => total + group.capability, 0);
}

export function familyTotals(snapshot: GridSnapshot): FamilyTotal[] {
  const totals = FAMILY_ORDER.map((family) => ({
    family,
    capability: capabilityOf(snapshot, family),
    output: outputOf(snapshot, family),
  }));
  const generating = totals.reduce((sum, item) => sum + Math.max(item.output, 0), 0);
  return totals.map((item) => ({
    ...item,
    share: generating > 0 ? (Math.max(item.output, 0) / generating) * 100 : 0,
  }));
}

/** Wind, solar and hydro. AESO's "Other" mixes biomass with other sources, so it stays out. */
export const RENEWABLE_FAMILIES: FuelFamily[] = ["wind", "solar", "hydro"];

export function mw(value: number): string {
  return value.toLocaleString("en-US");
}

export function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** "+12" or "-12", with a true minus sign for reading on screen. */
export function signed(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${mw(Math.abs(value))}`;
}

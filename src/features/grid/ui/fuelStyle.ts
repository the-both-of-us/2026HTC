import { BatteryCharging, Droplets, Flame, Leaf, Sun, Wind, type LucideIcon } from "lucide-react";
import type { FuelFamily } from "../types";

/**
 * One colour per fuel family, used by every chart. The six were checked in this order on our
 * navy surface with the dataviz palette validator, for colour-blind separation and contrast.
 * Text never wears these colours. It sits beside a coloured mark instead.
 */
export const FAMILY_COLOR: Record<FuelFamily, string> = {
  gas: "#d95926",
  wind: "#199e70",
  solar: "#c98500",
  hydro: "#3987e5",
  storage: "#d55181",
  other: "#9085e9",
};

/** The same colour, faded, for the part of a mark that shows capability not being used. */
export function trackColor(family: FuelFamily): string {
  return `${FAMILY_COLOR[family]}33`;
}

export const FAMILY_ICON: Record<FuelFamily, LucideIcon> = {
  gas: Flame,
  wind: Wind,
  solar: Sun,
  hydro: Droplets,
  storage: BatteryCharging,
  other: Leaf,
};

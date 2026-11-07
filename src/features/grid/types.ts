/** The six fuel families we chart. AESO's nine groups each belong to one. */
export type FuelFamily = "gas" | "wind" | "solar" | "hydro" | "storage" | "other";

/** One row of AESO's GENERATION table, all in MW. */
export type FuelGroup = {
  name: string;
  family: FuelFamily;
  capability: number;
  output: number;
  reserve: number | null;
};

/** One generating asset from the report's lower tables. */
export type GridUnit = {
  name: string;
  /** AESO's asset code, such as EGC1. */
  code: string | null;
  group: string;
  family: FuelFamily;
  capability: number;
  output: number;
  reserve: number | null;
  /** AESO's "*": the capability figure is gross, while output is net to the grid. */
  netToGrid: boolean;
  /** AESO's "^": the asset includes energy storage. */
  hasStorage: boolean;
};

export type InterchangePath = {
  path: string;
  /** MW. Positive flows out of Alberta, negative flows in. */
  flow: number;
};

/** One parsed AESO Current Supply Demand report. Every number comes from the report. */
export type GridSnapshot = {
  /** The report's "Last Update" as an ISO time with Alberta's UTC offset. */
  asOf: string;
  /** The same time in AESO's own words, such as "Nov 07, 2026 13:16". */
  asOfLabel: string;
  /** Alberta Internal Load, MW. */
  load: number;
  /** Alberta Total Net Generation, MW. */
  generation: number;
  /** Net Actual Interchange, MW. Positive is exporting. */
  interchange: number;
  reserveRequired: number | null;
  reserveDispatched: number | null;
  capabilityTotal: number | null;
  groups: FuelGroup[];
  paths: InterchangePath[];
  units: GridUnit[];
};

/**
 * What the app knows about the grid right now.
 * - live: read from AESO within the last minute or so.
 * - stale: AESO failed, so this is the last good reading, with its real time.
 * - unavailable: AESO failed and no earlier reading exists. There are no numbers to show.
 *
 * `seal` is the server's signature over the snapshot and fetchedAt (see sealReading in solves.ts).
 * It lets the server trust these figures when a learner sends an answer back with them.
 */
export type GridReading =
  | { status: "live"; snapshot: GridSnapshot; fetchedAt: string; seal?: string }
  | { status: "stale"; snapshot: GridSnapshot; fetchedAt: string; seal?: string }
  | { status: "unavailable" };

export const AESO_REPORT_URL = "http://ets.aeso.ca/ets_web/ip/Market/Reports/CSDReportServlet";

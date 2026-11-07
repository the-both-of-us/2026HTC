import type {
  FuelFamily,
  FuelGroup,
  GridSnapshot,
  GridUnit,
  InterchangePath,
} from "./types";

/** The report was not what we expected, such as an error page sent with a 200 status. */
export class GridParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GridParseError";
  }
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Alberta time is UTC-6: the province stopped changing its clocks on 2026-11-01. We checked
 * this against the report itself: "13:16" arrived with an HTTP date of 19:16 GMT.
 */
const ALBERTA_OFFSET = "-06:00";

/** Turns "Nov 07, 2026 13:16" into an ISO time, or null if it isn't that shape. */
export function parseReportTime(label: string): string | null {
  const match = label.match(/^([a-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})$/i);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  if (month < 0) return null;
  const pad = (part: string | number) => String(part).padStart(2, "0");
  return `${match[3]}-${pad(month + 1)}-${pad(match[2])}T${pad(match[4])}:${match[5]}:00${ALBERTA_OFFSET}`;
}

/** "1,234" becomes 1234 and "-20" becomes -20. Anything else, such as "-" or "", is null. */
function toNumber(text: string | undefined): number | null {
  if (text === undefined) return null;
  const cleaned = text.replace(/[,\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
}

function cleanText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads the page as a flat list of rows, each a list of cell texts. The report nests tables and
 * leaves some tags unclosed, so we split on the opening tags rather than trust its structure.
 */
function readRows(html: string): string[][] {
  const body = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  const rows: string[][] = [];

  for (const chunk of body.split(/<tr\b[^>]*>/i).slice(1)) {
    const cells = chunk
      .split(/<t[dh]\b[^>]*>/i)
      .slice(1)
      .map((cell) => cleanText(cell.split(/<\/t[dh]>/i)[0]));
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

export function familyOf(name: string): FuelFamily {
  const lower = name.toLowerCase();
  if (lower.includes("wind")) return "wind";
  if (lower.includes("solar")) return "solar";
  if (lower.includes("hydro")) return "hydro";
  if (lower.includes("storage") || lower.includes("battery")) return "storage";
  if (/cogen|combined cycle|simple cycle|gas/.test(lower)) return "gas";
  return "other";
}

/** "COMBINED CYCLE" becomes "Combined cycle". */
function displayName(name: string): string {
  const lower = name.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Splits "Shepard (EGC1)*^" into its name, code and AESO's two markers. */
function parseUnitName(raw: string) {
  const netToGrid = raw.includes("*");
  const hasStorage = raw.includes("^");
  const plain = raw.replace(/[*^]/g, "").trim();
  const match = plain.match(/^(.*)\(([^()]+)\)\s*$/);
  return {
    name: match ? match[1].trim() : plain,
    code: match ? match[2].trim() : null,
    netToGrid,
    hasStorage,
  };
}

type Section = "none" | "summary" | "generation" | "interchange" | "units";

const SUMMARY_LABELS = {
  generation: /^alberta total net generation/i,
  interchange: /^net actual interchange/i,
  load: /^alberta internal load/i,
  reserveRequired: /^contingency reserve required/i,
  reserveDispatched: /^dispatched contingency reserve\s*(\(dcr\))?$/i,
} as const;

/**
 * Parses AESO's Current Supply Demand HTML. It tolerates moved rows, changed case, commas and
 * missing optional figures, but throws GridParseError if a figure we can't do without is
 * absent, or if the fuel rows don't add up to AESO's totals. It never fills a gap with a guess.
 */
export function parseCurrentSupplyDemand(html: string): GridSnapshot {
  const summary: Partial<Record<keyof typeof SUMMARY_LABELS, number>> = {};
  const groups: FuelGroup[] = [];
  const paths: InterchangePath[] = [];
  const units: GridUnit[] = [];
  let capabilityTotal: number | null = null;
  let section: Section = "none";
  let unitGroup = "";
  const rows = readRows(html);

  for (const cells of rows) {
    const first = cells[0];

    // A row with one cell is a heading: a section, or a group of generating assets.
    if (cells.length === 1) {
      const heading = first.toUpperCase();
      if (heading === "SUMMARY") section = "summary";
      else if (heading === "GENERATION") section = "generation";
      else if (heading === "INTERCHANGE") section = "interchange";
      else if (section === "interchange" || section === "units") {
        section = "units";
        unitGroup = displayName(first);
      }
      continue;
    }

    if (/^(group|asset|path)$/i.test(first)) continue;

    if (section === "summary") {
      const value = toNumber(cells[1]);
      if (value === null) continue;
      for (const [key, label] of Object.entries(SUMMARY_LABELS)) {
        if (label.test(first)) summary[key as keyof typeof SUMMARY_LABELS] = value;
      }
    } else if (section === "generation") {
      const capability = toNumber(cells[1]);
      const output = toNumber(cells[2]);
      if (capability === null || output === null) continue;
      if (/^total$/i.test(first)) {
        capabilityTotal = capability;
      } else {
        groups.push({
          name: displayName(first),
          family: familyOf(first),
          capability,
          output,
          reserve: toNumber(cells[3]),
        });
      }
    } else if (section === "interchange") {
      const flow = toNumber(cells[1]);
      if (flow !== null && !/^total$/i.test(first)) paths.push({ path: first, flow });
    } else if (section === "units") {
      const capability = toNumber(cells[1]);
      const output = toNumber(cells[2]);
      if (capability === null || output === null) continue;
      units.push({
        ...parseUnitName(first),
        group: unitGroup,
        family: familyOf(unitGroup),
        capability,
        output,
        reserve: toNumber(cells[3]),
      });
    }
  }

  const timeLabel = rows
    .flat()
    .map((cell) => cell.match(/last update\s*:?\s*(.+)$/i)?.[1])
    .find(Boolean);
  const asOf = timeLabel ? parseReportTime(timeLabel.trim()) : null;

  if (!timeLabel || !asOf) throw new GridParseError("The report has no readable Last Update time.");
  if (summary.load === undefined) throw new GridParseError("The report has no Alberta Internal Load.");
  if (summary.generation === undefined) throw new GridParseError("The report has no Total Net Generation.");
  if (summary.interchange === undefined) throw new GridParseError("The report has no Net Actual Interchange.");
  if (groups.length === 0) throw new GridParseError("The report has no generation by fuel.");

  // A row we could not read is skipped above. AESO's totals expose that, so a missing
  // fuel can't quietly become 0 MW and a wrong answer.
  const outputSum = groups.reduce((sum, group) => sum + group.output, 0);
  if (outputSum !== summary.generation) {
    throw new GridParseError(`Fuel outputs add up to ${outputSum}, but the report says ${summary.generation}.`);
  }
  const capabilitySum = groups.reduce((sum, group) => sum + group.capability, 0);
  if (capabilityTotal !== null && capabilitySum !== capabilityTotal) {
    throw new GridParseError(`Fuel capabilities add up to ${capabilitySum}, but the report says ${capabilityTotal}.`);
  }

  return {
    asOf,
    asOfLabel: timeLabel.trim(),
    load: summary.load,
    generation: summary.generation,
    interchange: summary.interchange,
    reserveRequired: summary.reserveRequired ?? null,
    reserveDispatched: summary.reserveDispatched ?? null,
    capabilityTotal,
    groups,
    paths,
    units,
  };
}

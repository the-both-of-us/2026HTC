/**
 * Six made-up profiles, so a first visitor can see how matching works. They are labelled
 * "Demo profile" on screen, have no contact link, and their skills are titles from the three
 * sample maps, written here rather than computed, because nobody proved them.
 */
import { randomUUID } from "node:crypto";
import { claimDoc, getDoc, putDoc } from "@/shared/store";
import { profileKey } from "./profiles";
import type { DemoSkills, ProfileRecord } from "./types";

/** Bump this when the list below changes, so stored demo profiles are rewritten once. */
export const DEMO_VERSION = 1;
/** After seeding checked out, skip the checks for this long. */
export const RECHECK_AFTER_MS = 5 * 60_000;

const DATA_ANALYST = "Data Analyst, Grid Operations";
const INSTRUMENTATION = "Instrumentation Technician, Renewable Energy";
const BACKEND = "Junior Backend Developer";

type DemoProfile = {
  /**
   * Deliberately not a UUID: identity only accepts a UUID cookie, so nobody can ever sign in
   * as a demo profile, edit it or delete it, even though the id is in public source code.
   */
  userId: string;
  displayName: string;
  city: string;
  lookingFor: string;
  proven: { title: string; mapTitle: string }[];
  learning: string[];
};

const on = (mapTitle: string, titles: string[]) => titles.map((title) => ({ title, mapTitle }));

export const DEMO_PROFILES: DemoProfile[] = [
  {
    userId: "demo-network-priya",
    displayName: "Priya S.",
    city: "Calgary",
    lookingFor: "Someone to practise Power BI dashboards with",
    proven: on(DATA_ANALYST, ["Relational database basics", "SQL queries", "SQL joins", "Python basics", "Pandas data manipulation"]),
    learning: ["Power BI dashboard development", "Load forecast evaluation"],
  },
  {
    userId: "demo-network-marcus",
    displayName: "Marcus T.",
    city: "Edmonton",
    lookingFor: "A mentor for REST API design",
    proven: on(BACKEND, [
      "Programming fundamentals",
      "Git version control",
      "JavaScript fundamentals",
      "Node.js with TypeScript",
      "HTTP fundamentals",
      "PostgreSQL database",
      "SQL query writing",
    ]),
    learning: ["REST API design", "Automated testing", "Database indexing"],
  },
  {
    userId: "demo-network-aiyana",
    displayName: "Aiyana R.",
    city: "Red Deer",
    lookingFor: "A study partner for PLC ladder logic",
    proven: on(INSTRUMENTATION, [
      "Basic electrical principles",
      "Instrumentation fundamentals",
      "Basic safety practices",
      "Lockout/tagout procedures",
      "4-20 mA loop tracing",
    ]),
    learning: ["Control systems basics", "PLC basics and ladder logic"],
  },
  {
    userId: "demo-network-wei",
    displayName: "Wei L.",
    city: "Lethbridge",
    lookingFor: "Help with SQL joins on hourly tables",
    proven: on(DATA_ANALYST, [
      "Time-series fundamentals",
      "Time-series data cleaning",
      "Grid supply-demand basics",
      "SCADA data overview",
      "Weather data integration",
    ]),
    learning: ["Load forecast evaluation", "SQL joins"],
  },
  {
    userId: "demo-network-fatima",
    displayName: "Fatima K.",
    city: "Medicine Hat",
    lookingFor: "Anyone learning Python for plant data",
    proven: on(INSTRUMENTATION, [
      "Control systems basics",
      "PLC basics and ladder logic",
      "SCADA trends analysis",
      "Modbus communication troubleshooting",
    ]),
    learning: ["Renewable energy controller fundamentals", "Python basics"],
  },
  {
    userId: "demo-network-diego",
    displayName: "Diego M.",
    city: "Fort McMurray",
    lookingFor: "A beginner study group for SQL",
    proven: on(DATA_ANALYST, ["Clear technical writing", "Documentation and reproducibility", "Python basics"]),
    learning: ["Relational database basics", "SQL queries", "Pandas data manipulation", "Programming fundamentals"],
  },
];

type SeedState = { inFlight: Promise<void> | null; checkedAt: number | null };

// On globalThis, because Next.js can load this file once per route and they must share one run.
const globalSeed = globalThis as typeof globalThis & { oryxNetworkSeeding?: SeedState };
const state = (globalSeed.oryxNetworkSeeding ??= { inFlight: null, checkedAt: null });

function toRecord(demo: DemoProfile, publicId: string, joinedAt: string): ProfileRecord {
  const skills: DemoSkills = { version: DEMO_VERSION, proven: demo.proven, learning: demo.learning };
  return {
    userId: demo.userId,
    publicId,
    displayName: demo.displayName,
    city: demo.city,
    lookingFor: demo.lookingFor,
    contactUrl: null,
    joinedAt,
    updatedAt: joinedAt,
    isDemo: true,
    demo: skills,
  };
}

/**
 * Makes sure every demo profile is stored. Safe on every request: claimDoc only writes a key
 * that is free, so two servers seeding at once still store one of each, and concurrent calls
 * on one server share a run. A stored demo from an older list is rewritten, keeping its id.
 */
export function ensureDemoProfiles(): Promise<void> {
  if (state.checkedAt !== null && Date.now() - state.checkedAt < RECHECK_AFTER_MS) return Promise.resolve();
  // No await between this check and the set below, so concurrent callers share one promise.
  if (state.inFlight) return state.inFlight;
  const work = seedAll().finally(() => {
    state.inFlight = null;
  });
  state.inFlight = work;
  return work;
}

async function seedAll(): Promise<void> {
  await Promise.all(DEMO_PROFILES.map(seedOne));
  state.checkedAt = Date.now();
}

async function seedOne(demo: DemoProfile): Promise<void> {
  const key = profileKey(demo.userId);
  const now = new Date().toISOString();
  if (await claimDoc(key, toRecord(demo, randomUUID(), now))) return;

  const existing = await getDoc<ProfileRecord>(key);
  if (existing?.isDemo && existing.demo?.version === DEMO_VERSION && existing.contactUrl === null) return;
  await putDoc(key, toRecord(demo, existing?.publicId ?? randomUUID(), existing?.joinedAt ?? now));
}

/** Forgets the last check and any run in flight. Tests only. */
export function resetDemoStateForTests(): void {
  state.inFlight = null;
  state.checkedAt = null;
}

/**
 * Clean slate: deletes course content and the progress tied to it from the document store.
 *
 *   npx tsx scripts/wipe-courses.ts --scope content                       dry run (the default)
 *   npx tsx scripts/wipe-courses.ts --scope content --backup <dir> --confirm
 *   npx tsx scripts/wipe-courses.ts --scope all-but-accounts [--delete-circles] ...
 *
 * Scopes (design2.md section D):
 * - content: maps, programs, generated content, the catalog, claims and partial docs, progress,
 *   evidence pages, the course directory, circles and spaced repetition. Keeps sign-in
 *   (accounts, account-of), network, old settings, streaks, grid solves, the feed, reels and
 *   the sample seeds. This is the recommended scope.
 * - all-but-accounts: all of the above, plus settings, streaks, grid, the feed, reels and
 *   course-seeds. Keeps accounts, account-of, network and circles (as the owner worded it;
 *   kept circles point at deleted maps and will 404, so add --delete-circles).
 *
 * Safety:
 * - Without --confirm nothing is written or deleted. The dry run lists every prefix as delete or
 *   keep with its key count, and marks any key no rule covers as UNCLASSIFIED.
 * - --confirm needs --backup <dir> and refuses while anything is UNCLASSIFIED.
 * - The backup (<dir>/<prefix>.jsonl, one {"key","value"} per line, plus manifest.json) is written
 *   and read back, and its keys and values must match, before the first delete.
 * - Only keys that are in the verified backup are deleted, 8 at a time. Re-running is safe: it
 *   lists again.
 * - It uses whatever store the environment selects (BLOB_READ_WRITE_TOKEN, else
 *   memory) and prints which one first. It loads .env.local; pass --no-env to use the shell's.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deleteDoc, getDoc, listKeys } from "../src/shared/store";

export type Scope = "content" | "all-but-accounts";
export type Action = "delete" | "keep";
/** A key belongs to the rule with the longest `prefix` it starts with. */
export type Rule = { prefix: string; action: Action; note: string };

const CONTENT_DELETE: Rule[] = [
  { prefix: "maps/", action: "delete", note: "the courses themselves" },
  { prefix: "maps-by-owner/", action: "delete", note: "owner index of maps" },
  { prefix: "indexes/maps-by-owner-v1", action: "delete", note: "marker for that index" },
  { prefix: "programs/", action: "delete", note: "programs" },
  { prefix: "programs-by-owner/", action: "delete", note: "owner index of programs" },
  { prefix: "indexes/programs-by-owner-v1", action: "delete", note: "marker for that index" },
  { prefix: "program-courses/", action: "delete", note: "course claims inside programs" },
  { prefix: "program-starts/", action: "delete", note: "program starts" },
  { prefix: "program-listings/", action: "delete", note: "public program listings" },
  { prefix: "program-deepen/", action: "delete", note: "wave 1 deepen claims" },
  { prefix: "syllabi/", action: "delete", note: "wave 1 syllabus drafts" },
  { prefix: "unit-nodes/", action: "delete", note: "unit cache" },
  { prefix: "unit-claims/", action: "delete", note: "unit build claims" },
  { prefix: "lessons/", action: "delete", note: "generated lessons" },
  { prefix: "quiz/", action: "delete", note: "generated quizzes" },
  { prefix: "flashcards/", action: "delete", note: "generated flashcards" },
  { prefix: "catch/", action: "delete", note: "generated catch rounds" },
  { prefix: "resources/", action: "delete", note: "resource lists" },
  { prefix: "final-sets/", action: "delete", note: "shared final question sets" },
  { prefix: "pretest-sets/", action: "delete", note: "shared pre-test question sets" },
  { prefix: "catalog/", action: "delete", note: "wave 2 catalog" },
  { prefix: "partial/", action: "delete", note: "generation progress" },
  { prefix: "claims/", action: "delete", note: "generation claims" },
  { prefix: "attempts/", action: "delete", note: "progress on wiped maps" },
  { prefix: "progress/", action: "delete", note: "progress on wiped maps" },
  { prefix: "unlocks/", action: "delete", note: "progress on wiped maps" },
  { prefix: "final/", action: "delete", note: "progress on wiped maps" },
  { prefix: "catch-revealed/", action: "delete", note: "progress on wiped maps" },
  { prefix: "pretest/", action: "delete", note: "pre-test records on wiped maps" },
  { prefix: "proofs/", action: "delete", note: "evidence pages point at wiped maps" },
  { prefix: "proof-index/", action: "delete", note: "evidence page index" },
  { prefix: "courses/", action: "delete", note: "directory listings of wiped maps" },
  { prefix: "course-starts/", action: "delete", note: "directory starts" },
  { prefix: "likes/", action: "delete", note: "directory likes" },
  { prefix: "circles/", action: "delete", note: "each circle is one wiped map's race" },
  { prefix: "review/", action: "delete", note: "spaced-repetition cards of wiped maps" },
];

/** Sign-in and people: kept by both scopes. */
const ALWAYS_KEEP: Rule[] = [
  { prefix: "accounts/", action: "keep", note: "sign-in" },
  { prefix: "account-of/", action: "keep", note: "sign-in" },
  { prefix: "network/", action: "keep", note: "profiles and friends" },
];

/** Not tied to one course: kept by "content", deleted by "all-but-accounts". */
const OTHER_STATE: { prefix: string; note: string }[] = [
  { prefix: "settings/", note: "old AI settings (Delete my data still removes them)" },
  { prefix: "streaks/", note: "not tied to one course" },
  { prefix: "grid-solves/", note: "AESO exercises, not courses" },
  { prefix: "grid/", note: "cached AESO data" },
  { prefix: "feed-", note: "the interest feed (feed-*)" },
  { prefix: "skill-reel", note: "reels, their claims and votes (skill-reel*)" },
  { prefix: "course-seeds/", note: "fixtures for the samples (reseeded by prepareSamples)" },
];

export function rulesFor(scope: Scope, options: { deleteCircles?: boolean } = {}): Rule[] {
  if (scope === "content") {
    return [...CONTENT_DELETE, ...ALWAYS_KEEP, ...OTHER_STATE.map((rule): Rule => ({ ...rule, action: "keep" }))];
  }
  const circlesKept = !options.deleteCircles;
  return [
    ...CONTENT_DELETE.map((rule): Rule =>
      rule.prefix === "circles/" && circlesKept ? { ...rule, action: "keep", note: "kept in this scope (use --delete-circles); they will 404" } : rule,
    ),
    ...ALWAYS_KEEP,
    ...OTHER_STATE.map((rule): Rule => ({ ...rule, action: "delete" })),
  ];
}

export type Plan = {
  scope: Scope;
  rules: Rule[];
  total: number;
  /** Keys per rule prefix, in rule order. */
  byRule: { rule: Rule; keys: string[] }[];
  /** Keys no rule covers, grouped by their first path segment. */
  unclassified: Map<string, string[]>;
};

/** Pure: sorts keys into the rules. A key goes to the longest matching prefix. */
export function classify(scope: Scope, keys: string[], rules: Rule[]): Plan {
  const byRule = rules.map((rule) => ({ rule, keys: [] as string[] }));
  const unclassified = new Map<string, string[]>();
  for (const key of keys) {
    let best = -1;
    byRule.forEach(({ rule }, index) => {
      if (key.startsWith(rule.prefix) && (best === -1 || rule.prefix.length > byRule[best].rule.prefix.length)) best = index;
    });
    if (best !== -1) {
      byRule[best].keys.push(key);
      continue;
    }
    const segment = key.split("/")[0];
    unclassified.set(segment, [...(unclassified.get(segment) ?? []), key]);
  }
  return { scope, rules, total: keys.length, byRule, unclassified };
}

export async function planWipe(scope: Scope, options: { deleteCircles?: boolean } = {}): Promise<Plan> {
  return classify(scope, await listKeys(""), rulesFor(scope, options));
}

export function storeName(): string {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "Vercel Blob (BLOB_READ_WRITE_TOKEN is set)";
  return "memory (this process only)";
}

export function describePlan(plan: Plan, out: (line: string) => void): void {
  out(`Scope: ${plan.scope}. ${plan.total} keys in the store.`);
  for (const { rule, keys } of plan.byRule) {
    out(`${rule.action.toUpperCase().padEnd(6)} ${rule.prefix.padEnd(30)} ${String(keys.length).padStart(7)} keys   ${rule.note}`);
  }
  for (const [segment, keys] of [...plan.unclassified].sort()) {
    out(`UNCLASSIFIED ${`${segment}/`.padEnd(26)} ${String(keys.length).padStart(7)} keys   e.g. ${keys[0]}`);
  }
  const doomed = deleteKeys(plan).length;
  out(`${doomed} keys would be deleted, ${plan.total - doomed - unclassifiedCount(plan)} kept, ${unclassifiedCount(plan)} unclassified.`);
  if (plan.rules.some((rule) => rule.prefix === "circles/" && rule.action === "keep") && plan.byRule.some(({ rule, keys }) => rule.prefix === "maps/" && rule.action === "delete" && keys.length > 0)) {
    out("WARNING: circles/ is kept but their maps are deleted, so those circles will 404. Add --delete-circles to remove them too.");
  }
}

const unclassifiedCount = (plan: Plan) => [...plan.unclassified.values()].reduce((sum, keys) => sum + keys.length, 0);

function deleteKeys(plan: Plan): string[] {
  return plan.byRule.filter(({ rule }) => rule.action === "delete").flatMap(({ keys }) => keys);
}

export type Manifest = {
  createdAt: string;
  scope: Scope;
  store: string;
  /** Lines written to each file, by file name. */
  files: Record<string, number>;
  total: number;
};

const fileNameOf = (prefix: string) => `${prefix.replace(/\/+$/, "").replace(/\//g, "__")}.jsonl`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Runs `worker` over `items`, `size` at a time. */
async function inBatches<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += size) {
    await Promise.all(items.slice(start, start + size).map(worker));
  }
}

/**
 * Writes every doc that will be deleted to <dir>/<prefix>.jsonl plus manifest.json, then reads the
 * files back and checks the keys and values. Returns the keys that are safely backed up (a doc
 * that vanished between listing and reading is left out, so it is never deleted unseen).
 * Throws, having deleted nothing, if anything does not match.
 */
export async function writeBackup(plan: Plan, dir: string): Promise<{ manifest: Manifest; backedUp: string[] }> {
  const target = resolve(dir);
  if (existsSync(join(target, "manifest.json"))) {
    throw new Error(`${target} already holds a backup (manifest.json). Use a new directory.`);
  }
  mkdirSync(target, { recursive: true });

  const written = new Map<string, { key: string; value: unknown }[]>();
  for (const { rule, keys } of plan.byRule.filter(({ rule: r }) => r.action === "delete")) {
    if (keys.length === 0) continue;
    const entries: { key: string; value: unknown }[] = [];
    await inBatches(keys, 8, async (key) => {
      const value = await getDoc<unknown>(key);
      if (value === null) return;
      entries.push({ key, value });
    });
    entries.sort((a, b) => a.key.localeCompare(b.key));
    written.set(fileNameOf(rule.prefix), entries);
  }

  const files: Record<string, number> = {};
  for (const [name, entries] of written) {
    writeFileSync(join(target, name), entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""));
    files[name] = entries.length;
  }
  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    scope: plan.scope,
    store: storeName(),
    files,
    total: Object.values(files).reduce((sum, count) => sum + count, 0),
  };
  writeFileSync(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // Read it all back. Nothing is deleted unless every file matches what was meant to be written.
  const backedUp: string[] = [];
  const reread = JSON.parse(readFileSync(join(target, "manifest.json"), "utf8")) as Manifest;
  for (const [name, entries] of written) {
    const lines = readFileSync(join(target, name), "utf8").split("\n").filter((line) => line !== "");
    if (lines.length !== reread.files[name] || lines.length !== entries.length) {
      throw new Error(`Backup check failed: ${name} has ${lines.length} lines, expected ${entries.length}. Nothing was deleted.`);
    }
    lines.forEach((line, index) => {
      const back = JSON.parse(line) as { key: string; value: unknown };
      if (back.key !== entries[index].key || !same(back.value, entries[index].value)) {
        throw new Error(`Backup check failed: ${name} line ${index + 1} does not match ${entries[index].key}. Nothing was deleted.`);
      }
      backedUp.push(back.key);
    });
  }
  return { manifest: reread, backedUp };
}

export type Args = { scope?: string; backup?: string; confirm: boolean; deleteCircles: boolean; noEnv: boolean };

export function parseArgs(argv: string[]): Args {
  const args: Args = { confirm: false, deleteCircles: false, noEnv: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--confirm") args.confirm = true;
    else if (arg === "--delete-circles") args.deleteCircles = true;
    else if (arg === "--no-env") args.noEnv = true;
    else if (arg === "--scope") args.scope = argv[++index];
    else if (arg === "--backup") args.backup = argv[++index];
    else if (arg.startsWith("--scope=")) args.scope = arg.slice("--scope=".length);
    else if (arg.startsWith("--backup=")) args.backup = arg.slice("--backup=".length);
    else throw new Error(`Unknown argument ${arg}`);
  }
  return args;
}

/** Runs the script. Returns the exit code: 0 done, 2 bad arguments, 3 refused, 4 backup failed. */
export async function run(argv: string[], out: (line: string) => void = console.log): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    out(error instanceof Error ? error.message : String(error));
    return 2;
  }
  if (args.scope !== "content" && args.scope !== "all-but-accounts") {
    out("Usage: wipe-courses.ts --scope content|all-but-accounts [--backup <dir>] [--confirm] [--delete-circles]");
    return 2;
  }
  if (args.confirm && !args.backup) {
    out("Refusing: --confirm needs --backup <dir>. Nothing was deleted.");
    return 2;
  }

  out(`Store: ${storeName()}`);
  const plan = await planWipe(args.scope, { deleteCircles: args.deleteCircles });
  describePlan(plan, out);

  if (!args.confirm) {
    out("Dry run: nothing was written or deleted. Add --backup <dir> --confirm to wipe.");
    return 0;
  }
  if (plan.unclassified.size > 0) {
    out(`Refusing: ${unclassifiedCount(plan)} keys under ${[...plan.unclassified.keys()].map((s) => `${s}/`).join(", ")} are UNCLASSIFIED. Classify them in scripts/wipe-courses.ts first. Nothing was deleted.`);
    return 3;
  }

  let backup: Awaited<ReturnType<typeof writeBackup>>;
  try {
    backup = await writeBackup(plan, args.backup!);
  } catch (error) {
    out(error instanceof Error ? error.message : String(error));
    return 4;
  }
  out(`Backup verified: ${backup.manifest.total} docs in ${Object.keys(backup.manifest.files).length} files at ${resolve(args.backup!)}`);

  const doomed = new Set(backup.backedUp);
  const deleted = new Map<string, number>();
  for (const { rule, keys } of plan.byRule.filter(({ rule: r }) => r.action === "delete")) {
    const mine = keys.filter((key) => doomed.has(key));
    await inBatches(mine, 8, (key) => deleteDoc(key));
    if (mine.length > 0) deleted.set(rule.prefix, mine.length);
  }
  for (const [prefix, count] of deleted) out(`deleted ${String(count).padStart(7)}  ${prefix}`);
  out(`Done: ${[...deleted.values()].reduce((sum, count) => sum + count, 0)} docs deleted. Backup: ${resolve(args.backup!)}`);
  return 0;
}

if (process.argv[1]?.endsWith("wipe-courses.ts")) {
  if (!process.argv.includes("--no-env")) {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // No .env.local: use the shell's environment.
    }
  }
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}

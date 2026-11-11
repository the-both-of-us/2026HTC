/**
 * Background generation runs in Next's after(), which "will run for the platform's default or
 * configured max duration of your route" (node_modules/next/dist/docs/01-app/03-api-reference/
 * 04-functions/after.md). So every route that can start it must export a maxDuration that covers
 * the work's deadline: the request start plus ROUTE_BUDGET_MS (112 s), plus a margin.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_BUDGET_MS } from "@/features/skill-map";

const API = join(process.cwd(), "src/app/api");

/** Calls that start work in after(), directly or through a feature. */
const STARTS_BACKGROUND = [
  /\bafter\(/,
  /writeFirstLessonSoon\(/,
  /writeUnitLessonsSoon\(/,
  /getOrCreateLesson\(/,
  /syncCourseMap\(/,
  /startUnit\(/,
  /openCourse\(/,
  /createProgramOrMap\(/,
  /createCourseMap\(/,
  /startCatalogCourse\(/,
  /startCatalogProgram\(/,
  /resumePlanning\(/,
  /startPretest\(/,
  /submitPretestAnswers\(/,
];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === "route.ts" ? [path] : [];
  });
}

describe("route budgets for background work", () => {
  const routes = routeFiles(API).filter((file) => STARTS_BACKGROUND.some((pattern) => pattern.test(readFileSync(file, "utf8"))));

  it("finds the routes that start background generation", () => {
    expect(routes.length).toBeGreaterThanOrEqual(8);
  });

  it.each(routes.map((file) => [file.slice(API.length)]))("%s exports a maxDuration that covers the 112 s work deadline", (relative) => {
    const source = readFileSync(join(API, relative), "utf8");
    const seconds = Number(/export const maxDuration = (\d+);/.exec(source)?.[1]);
    expect(seconds * 1000).toBeGreaterThanOrEqual(ROUTE_BUDGET_MS + 8_000);
  });
});

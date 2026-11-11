/**
 * Sharing a program: publish, the public view, starting a private copy, and Delete my data.
 * The in-memory store, a program seeded with its first course built, and no AI call.
 */
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatJSON } from "@/features/ai";
import { copySkillMap, getSkillMap, saveSkillMap } from "@/features/skill-map";
import { getDoc, listKeys } from "@/shared/store";
import { getProgramView, openCourse, programLink } from "./programs";
import {
  getProgramPage,
  listPublicPrograms,
  publishProgram,
  resetProgramStartsForTests,
  SIGN_IN_TO_SHARE,
  startProgram,
  unpublishProgram,
} from "./sharing";
import { deleteProgramsByOwner, getProgram, saveProgram } from "./storage";
import { unitNodes } from "./test-fixtures";
import type { Program } from "./types";

vi.mock("@/features/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/ai")>()),
  chatJSON: vi.fn(),
}));

// The real copySkillMap, wrapped so tests can count copies.
vi.mock("@/features/skill-map", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/skill-map")>();
  return { ...actual, copySkillMap: vi.fn(actual.copySkillMap) };
});

// No cookies in tests: every visitor is a guest, which is what the sign-in check needs.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const SOURCE = "I want to learn backend development so I can build the API for my own app";
const mockCopy = vi.mocked(copySkillMap);

function stubAuth(on: boolean) {
  const values = on
    ? {
        AUTH0_DOMAIN: "tenant.example.auth0.com",
        AUTH0_CLIENT_ID: "fake-client-id",
        AUTH0_CLIENT_SECRET: "fake-client-secret",
        AUTH0_SECRET: "fake-transaction-secret-0123456789abcdef",
        APP_BASE_URL: "http://localhost:3000",
      }
    : { AUTH0_DOMAIN: "", AUTH0_CLIENT_ID: "", AUTH0_CLIENT_SECRET: "", AUTH0_SECRET: "", APP_BASE_URL: "" };
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

/** A program owned by `owner`, with its first course built (as an older program's map holds it). */
async function sampleProgram(owner: string) {
  const createdAt = new Date().toISOString();
  const firstMapId = randomUUID();
  const program: Program = {
    id: randomUUID(),
    ownerId: owner,
    title: "Backend development",
    summary: "From an HTTP API to a deployed service.",
    sourceKind: "topic",
    sourceText: SOURCE,
    courses: [
      { slug: "http-apis", title: "HTTP APIs", summary: "Build an API.", requires: [], mapId: firstMapId },
      { slug: "databases", title: "Databases", summary: "Store data.", requires: ["http-apis"] },
      { slug: "deploying", title: "Deploying", summary: "Ship it.", requires: ["databases"] },
    ],
    createdAt,
  };
  await saveProgram(program);
  await saveSkillMap({
    id: firstMapId,
    ownerId: owner,
    title: "HTTP APIs",
    subtitle: "",
    sourceKind: "topic",
    sourceText: SOURCE,
    nodes: unitNodes(["routes", "status-codes", "json-bodies"]),
    createdAt,
    program: programLink(program, 0),
  });
  return { programId: program.id, firstSlug: "http-apis", firstMapId };
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("S3_BUCKET", "");
  stubAuth(false);
  (globalThis as { pfMemoryStore?: Map<string, string> }).pfMemoryStore?.clear();
  resetProgramStartsForTests();
  vi.mocked(chatJSON).mockReset();
  vi.mocked(chatJSON).mockRejectedValue(new Error("No AI in tests"));
  mockCopy.mockClear();
});

describe("publishing a program", () => {
  it("lists it for anyone, with the courses' name rules and no owner id", async () => {
    const owner = randomUUID();
    const { programId } = await sampleProgram(owner);

    const shared = await publishProgram(programId, owner, "  Ana   K ");
    expect(shared).toMatchObject({ programId, authorName: "Ana K", isSample: false, courseCount: 3 });
    const [listed] = await listPublicPrograms();
    expect(listed).toEqual(shared);
    expect(JSON.stringify(listed)).not.toContain(owner);
    expect(listed).not.toHaveProperty("authorId");

    // Search matches title, summary or author; republishing keeps the first date.
    expect(await listPublicPrograms({ q: "ana k" })).toHaveLength(1);
    expect(await listPublicPrograms({ q: "no such thing" })).toHaveLength(0);
    const again = await publishProgram(programId, owner, "");
    expect(again).toMatchObject({ authorName: "Anonymous learner", publishedAt: shared.publishedAt });

    await expect(publishProgram(programId, owner, "Oryx Learn Team")).rejects.toMatchObject({ status: 400 });
    await expect(publishProgram(programId, owner, "x".repeat(41))).rejects.toMatchObject({ status: 400 });
  });

  it("is the owner's alone, and a stranger gets the same 404 as a missing program", async () => {
    const owner = randomUUID();
    const { programId } = await sampleProgram(owner);
    const stranger = randomUUID();

    await expect(publishProgram(programId, stranger)).rejects.toMatchObject({ status: 404 });
    await expect(publishProgram(randomUUID(), owner)).rejects.toMatchObject({ status: 404 });
    await expect(publishProgram("../maps/x", owner)).rejects.toMatchObject({ status: 404 });

    await publishProgram(programId, owner);
    await expect(unpublishProgram(programId, stranger)).rejects.toMatchObject({ status: 404 });
    await unpublishProgram(programId, owner);
    expect(await listPublicPrograms()).toEqual([]);
    expect(await getProgramPage(programId, stranger)).toBeNull();
    expect(await getProgramPage(programId, null)).toBeNull();
  });

  it("needs a sign-in to share once Auth0 is set up, but never to make it private", async () => {
    const owner = randomUUID();
    const { programId } = await sampleProgram(owner);
    stubAuth(true);
    await expect(publishProgram(programId, owner)).rejects.toMatchObject({ status: 401, message: SIGN_IN_TO_SHARE });
    await expect(unpublishProgram(programId, owner)).resolves.toBeUndefined();

    const page = await getProgramPage(programId, owner);
    expect(page?.mode === "owner" && page.sharing).toMatchObject({ listing: null, signInRequired: true });
  });
});

describe("the public program page", () => {
  it("shows the outline and the built course's topics, and nothing private", async () => {
    const owner = randomUUID();
    const { programId, firstMapId } = await sampleProgram(owner);
    await publishProgram(programId, owner, "Ana");

    const page = await getProgramPage(programId, randomUUID());
    expect(page?.mode).toBe("public");
    if (page?.mode !== "public") return;
    const firstMap = (await getSkillMap(firstMapId))!;
    expect(page.program.authorName).toBe("Ana");
    expect(page.program.courses[0].topics).toHaveLength(firstMap.nodes.length);
    expect(page.program.courses[1].topics).toBeNull();
    expect(page.program.myCopyId).toBeNull();

    const body = JSON.stringify(page);
    expect(body).not.toContain(owner);
    expect(body).not.toContain(firstMapId);
    expect(body).not.toContain(SOURCE);
  });

  it("shows the owner their own program with the share panel", async () => {
    const owner = randomUUID();
    const { programId } = await sampleProgram(owner);
    const shared = await publishProgram(programId, owner, "Ana");

    const page = await getProgramPage(programId, owner);
    expect(page?.mode).toBe("owner");
    if (page?.mode !== "owner") return;
    expect(page.program).toEqual(await getProgramView(programId, owner));
    expect(page.sharing).toMatchObject({ listing: shared, signInRequired: false, maxNameLength: 40 });
    expect(JSON.stringify(page)).not.toContain(owner);
  });
});

describe("startProgram", () => {
  it("gives a learner a private copy with the author's built courses copied", async () => {
    const owner = randomUUID();
    const learner = randomUUID();
    const { programId, firstSlug, firstMapId } = await sampleProgram(owner);
    await publishProgram(programId, owner);

    const started = await startProgram(programId, learner);
    expect(started.created).toBe(true);
    expect(started.programId).not.toBe(programId);
    expect(mockCopy).toHaveBeenCalledTimes(1);

    const copy = (await getProgram(started.programId))!;
    const original = (await getProgram(programId))!;
    expect(copy).toMatchObject({ ownerId: learner, title: original.title, forkedFrom: programId });
    expect(copy.courses.map((c) => c.slug)).toEqual(original.courses.map((c) => c.slug));
    expect(copy.courses.slice(1).every((c) => c.mapId === undefined)).toBe(true);

    // The copied course map is the learner's, with the same topics, and sits in the learner's program.
    const copiedMap = (await getSkillMap(copy.courses[0].mapId!))!;
    const authorMap = (await getSkillMap(firstMapId))!;
    expect(copiedMap.id).not.toBe(firstMapId);
    expect(copiedMap).toMatchObject({ ownerId: learner, forkedFrom: firstMapId });
    expect(copiedMap.nodes.map((n) => n.id)).toEqual(authorMap.nodes.map((n) => n.id));
    expect(copiedMap.program).toMatchObject({ id: copy.id, courseNumber: 1, courseCount: copy.courses.length });

    // The learner's copy works like any program of theirs: the copied course opens straight away.
    expect(await openCourse(copy.id, firstSlug, learner)).toEqual({ status: "ready", mapId: copiedMap.id });
    expect((await getProgramPage(copy.id, learner))?.mode).toBe("owner");
    expect(chatJSON).not.toHaveBeenCalled();

    // The start is recorded, so the page offers "Continue" and starting again opens the same copy.
    expect(await getDoc(`program-starts/${programId}/${learner}`)).toMatchObject({ copyId: copy.id });
    const page = await getProgramPage(programId, learner);
    expect(page?.mode === "public" && page.program.myCopyId).toBe(copy.id);
    expect(await startProgram(programId, learner)).toEqual({ programId: copy.id, created: false });
    expect(mockCopy).toHaveBeenCalledTimes(1);
  });

  it("makes one copy for a double click, and gives the owner their own program", async () => {
    const owner = randomUUID();
    const learner = randomUUID();
    const { programId } = await sampleProgram(owner);
    await publishProgram(programId, owner);

    const [a, b] = await Promise.all([startProgram(programId, learner), startProgram(programId, learner)]);
    expect(a).toEqual(b);
    expect(mockCopy).toHaveBeenCalledTimes(1);
    expect(await startProgram(programId, owner)).toEqual({ programId, created: false });
  });

  it("refuses a private or missing program with the same 404, and keeps copies after unpublishing", async () => {
    const owner = randomUUID();
    const learner = randomUUID();
    const { programId } = await sampleProgram(owner);
    await expect(startProgram(programId, learner)).rejects.toMatchObject({ status: 404 });
    await expect(startProgram(randomUUID(), learner)).rejects.toMatchObject({ status: 404 });
    await expect(startProgram("not-a-uuid", learner)).rejects.toMatchObject({ status: 404 });

    await publishProgram(programId, owner);
    const { programId: copyId } = await startProgram(programId, learner);
    await unpublishProgram(programId, owner);
    expect(await getProgramPage(programId, learner)).toBeNull();
    expect((await getProgramPage(copyId, learner))?.mode).toBe("owner");
  });

  it("makes a new copy when the old one was deleted", async () => {
    const owner = randomUUID();
    const learner = randomUUID();
    const { programId } = await sampleProgram(owner);
    await publishProgram(programId, owner);
    const first = await startProgram(programId, learner);
    await deleteProgramsByOwner(learner);

    const second = await startProgram(programId, learner);
    expect(second.created).toBe(true);
    expect(second.programId).not.toBe(first.programId);
  });
});

describe("a catalog program", () => {
  it("is copied as a pointer to the same catalog program, with no maps copied and no source text", async () => {
    const owner = randomUUID();
    const learner = randomUUID();
    const catalogId = randomUUID();
    const program: Program = {
      id: randomUUID(),
      ownerId: owner,
      title: "Psychology",
      summary: "Understand people.",
      sourceKind: "topic",
      sourceText: "my private words about psychology",
      courses: [],
      createdAt: new Date().toISOString(),
      catalogId,
      depth: "degree",
    };
    await saveProgram(program);
    await publishProgram(program.id, owner);
    const started = await startProgram(program.id, learner);
    expect(mockCopy).not.toHaveBeenCalled();
    const stored = (await getDoc<Program>(`programs/${started.programId}`))!;
    expect(stored).toMatchObject({ ownerId: learner, catalogId, depth: "degree", forkedFrom: program.id, courses: [] });
    expect(JSON.stringify(stored)).not.toContain("private words");
  });
});

describe("Delete my data", () => {
  it("removes the owner's listing and others' starts on it, and the learner's own starts", async () => {
    const owner = randomUUID();
    const learner = randomUUID();
    const other = randomUUID();
    const { programId } = await sampleProgram(owner);
    await publishProgram(programId, owner);
    await startProgram(programId, learner);
    await startProgram(programId, other);

    expect(await deleteProgramsByOwner(learner)).toBe(1);
    expect(await getDoc(`program-starts/${programId}/${learner}`)).toBeNull();
    expect(await getDoc(`program-starts/${programId}/${other}`)).not.toBeNull();

    expect(await deleteProgramsByOwner(owner)).toBe(1);
    expect(await listPublicPrograms()).toEqual([]);
    expect(await listKeys(`program-starts/${programId}/`)).toEqual([]);
    expect(await listKeys("program-listings/")).toEqual([]);
    // The other learner's copy is theirs, so it stays.
    expect(await listKeys("programs/")).toHaveLength(1);
    // Running it again is harmless.
    expect(await deleteProgramsByOwner(owner)).toBe(0);
  });
});

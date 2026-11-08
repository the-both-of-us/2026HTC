import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deleteDoc, getDoc, putDoc } from "@/shared/store";
import { deleteProgramsByOwner, listProgramsByOwner, saveProgram } from "./storage";
import type { Program } from "./types";

const READY_KEY = "indexes/programs-by-owner-v1";

function makeProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: randomUUID(),
    ownerId: randomUUID(),
    title: "Web development",
    summary: "From HTML to a deployed app.",
    sourceKind: "topic",
    sourceText: "learn web development",
    courses: [{ slug: "html", title: "HTML", summary: "Write a page.", requires: [] }],
    createdAt: "2026-11-07T10:00:00.000Z",
    ...overrides,
  };
}

/** The memory driver's own Map, to plant a document that cannot be parsed. */
function rawStore(): Map<string, string> {
  return (globalThis as typeof globalThis & { pfMemoryStore: Map<string, string> }).pfMemoryStore;
}

describe("listProgramsByOwner", () => {
  it("finds programs saved before the owner index existed", async () => {
    const old = makeProgram();
    await deleteDoc(READY_KEY);
    await putDoc(`programs/${old.id}`, old);

    expect((await listProgramsByOwner(old.ownerId)).map((program) => program.id)).toEqual([old.id]);
    expect(await getDoc(READY_KEY)).not.toBeNull();
  });

  it("reads only that owner's programs, newest first", async () => {
    const owner = randomUUID();
    const older = makeProgram({ ownerId: owner, createdAt: "2026-11-01T00:00:00.000Z" });
    const newer = makeProgram({ ownerId: owner, createdAt: "2026-11-05T00:00:00.000Z" });
    await saveProgram(older);
    await saveProgram(newer);
    await listProgramsByOwner(owner);

    const theirs = makeProgram();
    await saveProgram(theirs);
    rawStore().set(`programs/${theirs.id}`, "{ not json");

    expect((await listProgramsByOwner(owner)).map((program) => program.id)).toEqual([newer.id, older.id]);
  });

  it("drops the index entries of deleted programs", async () => {
    const program = makeProgram();
    await saveProgram(program);

    expect(await deleteProgramsByOwner(program.ownerId)).toBe(1);

    expect(await getDoc(`programs-by-owner/${program.ownerId}/${program.id}`)).toBeNull();
    expect(await listProgramsByOwner(program.ownerId)).toEqual([]);
  });
});

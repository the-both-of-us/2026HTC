import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteDoc, getDoc, listDocs, putDoc } from "./index";

/** A pretend bucket. The mocked SDK below reads and writes it. */
const { objects, sent, PAGE_SIZE } = vi.hoisted(() => ({
  objects: new Map<string, string>(),
  sent: [] as { command: string; input: Record<string, unknown> }[],
  PAGE_SIZE: 2,
}));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(readonly input: Record<string, string | undefined>) {}
  }
  class GetObjectCommand extends Command {}
  class PutObjectCommand extends Command {}
  class DeleteObjectCommand extends Command {}
  class ListObjectsV2Command extends Command {}

  class S3Client {
    async send(command: Command) {
      const { Key, Body, Prefix, ContinuationToken } = command.input;
      sent.push({ command: command.constructor.name, input: command.input });

      if (command instanceof GetObjectCommand) {
        const text = objects.get(Key as string);
        if (text === undefined) throw Object.assign(new Error("gone"), { name: "NoSuchKey" });
        return { Body: { transformToString: async () => text } };
      }
      if (command instanceof PutObjectCommand) return void objects.set(Key as string, Body as string);
      if (command instanceof DeleteObjectCommand) return void objects.delete(Key as string);

      const keys = [...objects.keys()].filter((key) => key.startsWith(Prefix as string)).sort();
      const start = Number(ContinuationToken ?? 0);
      const end = start + PAGE_SIZE;
      return {
        Contents: keys.slice(start, end).map((key) => ({ Key: key })),
        NextContinuationToken: end < keys.length ? String(end) : undefined,
      };
    }
  }

  return { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command };
});

beforeEach(() => {
  vi.stubEnv("S3_BUCKET", "test-bucket");
  vi.stubEnv("AWS_REGION", "ca-central-1");
  objects.clear();
  sent.length = 0;
});

describe("store (S3 driver)", () => {
  it("writes JSON to the bucket and reads it back", async () => {
    await putDoc("maps/one", { n: 1 });

    expect(sent[0].input).toMatchObject({
      Bucket: "test-bucket",
      Key: "maps/one",
      Body: '{"n":1}',
      ContentType: "application/json",
    });
    expect(await getDoc("maps/one")).toEqual({ n: 1 });
  });

  it("returns null for a key that does not exist", async () => {
    expect(await getDoc("maps/missing")).toBeNull();
  });

  it("lists across every page, and only under the prefix", async () => {
    for (const name of ["a", "b", "c", "d", "e"]) await putDoc(`maps/${name}`, { name });
    await putDoc("other/x", { name: "x" });

    const docs = await listDocs<{ name: string }>("maps/");

    expect(docs.map((doc) => doc.name).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(sent.filter((call) => call.command === "ListObjectsV2Command")).toHaveLength(3);
  });

  it("deletes a document, and deleting twice is fine", async () => {
    await putDoc("maps/gone", { n: 1 });

    await deleteDoc("maps/gone");
    await deleteDoc("maps/gone");

    expect(await getDoc("maps/gone")).toBeNull();
  });

  it("lets other errors through, so they aren't mistaken for a missing document", async () => {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const denied = Object.assign(new Error("denied"), { name: "AccessDenied" });
    const send = vi.spyOn(S3Client.prototype, "send").mockRejectedValueOnce(denied as never);

    await expect(getDoc("maps/one")).rejects.toThrow("denied");
    send.mockRestore();
  });
});

describe("choosing a driver", () => {
  it("prefers S3 when both S3_BUCKET and a Blob token are set", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "blob-token");

    await putDoc("maps/choice", { n: 1 });

    expect(objects.has("maps/choice")).toBe(true);
  });
});

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { StoreDriver } from "./driver";

/**
 * Amazon S3. Credentials come from the default chain, which is the task role on
 * AWS. S3 is strongly consistent, so a read straight after a write sees the new value.
 */
let client: S3Client | undefined;

function getClient(): S3Client {
  client ??= new S3Client({ region: process.env.AWS_REGION });
  return client;
}

function bucket(): string {
  return process.env.S3_BUCKET as string;
}

export const s3Driver: StoreDriver = {
  async read(key) {
    try {
      const result = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
      return (await result.Body?.transformToString()) ?? null;
    } catch (error) {
      // S3 only says NoSuchKey to a role with s3:ListBucket. Without it, a missing
      // key is an AccessDenied error, which rightly stays an error here.
      if (error instanceof Error && error.name === "NoSuchKey") return null;
      throw error;
    }
  },

  async write(key, text) {
    await getClient().send(
      new PutObjectCommand({ Bucket: bucket(), Key: key, Body: text, ContentType: "application/json" }),
    );
  },

  async listKeys(prefix) {
    const keys: string[] = [];
    let token: string | undefined;

    // S3 returns up to 1000 keys per page, so keep asking until there are no more.
    do {
      const page = await getClient().send(
        new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }),
      );
      keys.push(...(page.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : [])));
      token = page.NextContinuationToken;
    } while (token);

    return keys;
  },

  async remove(key) {
    await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  },
};

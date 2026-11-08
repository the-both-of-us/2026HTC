import { HttpError } from "@/shared/http";
import { recordView, UUID_PATTERN, writeEvent } from "./events";
import type { eventBody } from "./http";
import { itemExists } from "./pool";
import { slugOfItem } from "./validate";
import type { z } from "zod";

/** Records one event from the browser, for an item that is really in its interest's pool. */
export async function recordFeedEvent(userId: string, body: z.infer<typeof eventBody>): Promise<void> {
  const slug = slugOfItem(body.itemId);
  if (!UUID_PATTERN.test(userId) || !slug || !(await itemExists(slug, body.itemId))) {
    throw new HttpError("We could not find that card. Please refresh the feed.", 404);
  }
  if (body.event === "view") await recordView(userId, body.itemId, body.dwellMs);
  else await writeEvent(userId, body.itemId, body.event);
}

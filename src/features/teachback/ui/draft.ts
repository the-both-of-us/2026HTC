/**
 * The learner's unfinished work on one skill, kept in this browser tab. It covers
 * their text and any open follow-up question, so clicking another skill or reloading
 * the page loses nothing. If the browser blocks storage, drafts just are not kept.
 */
import type { Attempt } from "@/shared/types";
import type { SavedIntegrity } from "./useIntegrity";

export type Draft = {
  text: string;
  /** Only while a follow-up is waiting for its answer. */
  openAttempt: Attempt | null;
  integrity: SavedIntegrity;
  /** The learner swapped this topic's format for plain "Explain it". Allowed once. */
  swapped?: boolean;
};

function draftKey(mapId: string, nodeId: string): string {
  return `teachback-draft/${mapId}/${nodeId}`;
}

export function loadDraft(mapId: string, nodeId: string): Draft | null {
  try {
    const saved = sessionStorage.getItem(draftKey(mapId, nodeId));
    return saved ? (JSON.parse(saved) as Draft) : null;
  } catch {
    return null;
  }
}

export function saveDraft(mapId: string, nodeId: string, draft: Draft): void {
  try {
    sessionStorage.setItem(draftKey(mapId, nodeId), JSON.stringify(draft));
  } catch {
    // Storage is full or blocked. The learner keeps working, just without a saved draft.
  }
}

export function clearDraft(mapId: string, nodeId: string): void {
  try {
    sessionStorage.removeItem(draftKey(mapId, nodeId));
  } catch {
    // Same as above.
  }
}

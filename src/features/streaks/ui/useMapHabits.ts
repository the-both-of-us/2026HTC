"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { rewardFor, type MapHabits, type ProofReward } from "../rules";
import { fetchMapHabits } from "./api";

/** The streak, topic of the day and fading for a map the learner owns. Null until loaded, or if it fails. */
export function useMapHabits(mapId: string, isOwner: boolean) {
  const [habits, setHabits] = useState<MapHabits | null>(null);
  const latest = useRef<MapHabits | null>(null);

  const keep = useCallback((fresh: MapHabits | null) => {
    if (fresh) {
      latest.current = fresh;
      setHabits(fresh);
    }
    return fresh;
  }, []);

  const reload = useCallback(async () => keep(await fetchMapHabits(mapId)), [mapId, keep]);

  useEffect(() => {
    if (isOwner) void fetchMapHabits(mapId).then(keep);
  }, [isOwner, mapId, keep]);

  /** Call right after a proof. Reloads, and returns what the unlock moment should celebrate. */
  const afterProof = useCallback(
    async (nodeId: string): Promise<ProofReward | null> => {
      const before = latest.current;
      const after = await reload();
      return after && rewardFor(before, after, nodeId);
    },
    [reload],
  );

  return { habits, reload, afterProof };
}

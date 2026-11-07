/**
 * Saves answers one after another and counts the ones still in flight, so the screen can hold
 * the learner on "Saving your last answer" instead of letting a failed save vanish. Plain
 * TypeScript, so it can be tested without React.
 */

/** What happened to one save: it was sent and worked, sent and failed, or never sent. */
export type SaveOutcome = "saved" | "failed" | "dropped";

export type SaveQueue = {
  /**
   * Queues a save. `run` resolves true when the answer was saved. After a failure, saves queued
   * behind it are dropped without running, so going back to the failed card never saves a later
   * card twice. Saves added after the failure is known run as normal.
   */
  add(run: () => Promise<boolean>): Promise<SaveOutcome>;
  /** Saves queued or in flight. */
  pending(): number;
};

export function createSaveQueue(onPendingChange: (count: number) => void = () => {}): SaveQueue {
  let chain: Promise<unknown> = Promise.resolve();
  let generation = 0;
  let pending = 0;

  function setPending(count: number) {
    pending = count;
    onPendingChange(count);
  }

  return {
    add(run) {
      const gen = generation;
      setPending(pending + 1);
      const outcome = chain.then(async (): Promise<SaveOutcome> => {
        if (gen !== generation) return "dropped";
        let saved = false;
        try {
          saved = await run();
        } catch {
          saved = false;
        }
        if (saved) return "saved";
        generation += 1;
        return "failed";
      });
      chain = outcome;
      return outcome.finally(() => setPending(pending - 1));
    },
    pending: () => pending,
  };
}

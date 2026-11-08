"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * True on a map pitched at young children (about 9 and under). "Explain it to a 10-year-old"
 * makes no sense to a 6-year-old, so that format reads "Explain it to a friend" there.
 */
const YoungLearnerContext = createContext(false);

export function YoungLearnerProvider({ young, children }: { young: boolean; children: ReactNode }) {
  return <YoungLearnerContext.Provider value={young}>{children}</YoungLearnerContext.Provider>;
}

export function useYoungLearner(): boolean {
  return useContext(YoungLearnerContext);
}

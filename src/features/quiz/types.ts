import type { Citation } from "@/shared/types";

export type QuizQuestion = {
  id: string;
  mapId: string;
  nodeId: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  /** Why the right answer is right. Shown after answering. */
  explanation: string;
  citation: Citation | null;
};

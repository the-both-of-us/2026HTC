/** Client components for the teach-back. Server code is exported from index.ts. */
export { TeachBackPanel } from "./ui/TeachBackPanel";
export type { TeachBackPanelProps } from "./ui/TeachBackPanel";
export { FormatBadge } from "./ui/FormatBadge";
export { YoungLearnerProvider } from "./ui/YoungLearner";
export { FinalTest } from "./ui/FinalTest";
export { testScoreLabel } from "./testLabel";
export type { TestScore } from "./testLabel";
// Plain code with no server imports, so the map shows the same format the server expects.
export { assignFormats, FORMAT_LABELS } from "./formats";
export type { TopicFormat } from "./formats";

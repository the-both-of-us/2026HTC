/** Client components and hooks for voice. Server code is exported from index.ts. */
export { VoiceInterview } from "./ui/VoiceInterview";
export type { VoiceInterviewProps } from "./ui/VoiceInterview";
export { useVoiceInterview } from "./ui/useVoiceInterview";
export { useDictation } from "./ui/useDictation";
export { MicLevel } from "./ui/MicLevel";
export type { UseDictationOptions, DictationStatus } from "./ui/useDictation";
export type { FallbackReason, VoicePhase, VoiceVerdict } from "./machine";
export type { InputMethod } from "./session";

// Removed before the final merge, along with src/app/voice-preview and src/app/api/voice/preview-attempt.
export { VoicePreview } from "./ui/VoicePreview";

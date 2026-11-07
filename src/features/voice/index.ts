/** Server code for the voice routes. Client components are exported from client.ts. */
export { chooseSpokenText, handleSpeak, handleSttToken, isSameOrigin } from "./server/handlers";
export type { SayKind } from "./server/handlers";

import "server-only";

/** Server code for the trust page. Client components are exported from client.ts. */
export { deleteUserData, NOTHING_DELETED } from "./deleteData";
export type { DeletedCounts } from "./deleteData";
export { TrustScreen } from "./ui/TrustScreen";

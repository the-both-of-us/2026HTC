import { handleLogout } from "@/features/auth";

/** Signs out, starts a fresh guest, then signs out of Auth0 too. Same-origin form posts only. */
export function POST(request: Request) {
  return handleLogout(request);
}

/** An old or forged link: goes home and changes nothing, so no other site can sign anyone out. */
export function GET(request: Request) {
  return handleLogout(request);
}

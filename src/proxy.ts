import { NextResponse, type NextRequest } from "next/server";
import { isProofGone } from "@/features/proof";
import { userIdFromCookies } from "@/shared/identity";

/**
 * A missing or withdrawn evidence page answers a real 404. The page itself streams, and once
 * streaming starts the status is fixed at 200, so the check runs here, before the page.
 * The page still renders its own not-found screen; this only sets the status.
 */
export async function proxy(request: NextRequest) {
  const id = request.nextUrl.pathname.split("/")[2] ?? "";
  const viewerId = userIdFromCookies((name) => request.cookies.get(name)?.value);
  if (await isProofGone(id, viewerId)) return NextResponse.rewrite(new URL("/proof/gone", request.url));
  return NextResponse.next();
}

export const config = { matcher: "/proof/:id" };

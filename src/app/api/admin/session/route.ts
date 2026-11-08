import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_MS,
  isAdminConfigured,
  isLockedOut,
  makeAdminToken,
  passcodeMatches,
  recordFailure,
} from "@/features/admin";

const COOKIE = { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/" } as const;

/** The caller's address, for slowing down guesses. Vercel and the ALB both set x-forwarded-for. */
function addressOf(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** POST `{passcode}`: opens the admin page for 8 hours in this browser. */
export async function POST(request: Request) {
  if (!isAdminConfigured()) return NextResponse.json({ error: "Admin is not set up here." }, { status: 404 });
  const address = addressOf(request);
  if (isLockedOut(address)) {
    return NextResponse.json({ error: "Too many wrong passcodes. Wait 10 minutes and try again." }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as { passcode?: unknown } | null;
  const passcode = typeof body?.passcode === "string" ? body.passcode : "";
  if (!passcodeMatches(passcode)) {
    recordFailure(address);
    await new Promise((resolve) => setTimeout(resolve, 400));
    return NextResponse.json({ error: "That passcode is wrong." }, { status: 401 });
  }
  const token = makeAdminToken();
  if (!token) return NextResponse.json({ error: "Admin sign-in is not available right now." }, { status: 500 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, token, { ...COOKIE, maxAge: ADMIN_SESSION_MS / 1000 });
  return response;
}

/** DELETE: locks the admin page again in this browser. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", { ...COOKIE, maxAge: 0 });
  return response;
}

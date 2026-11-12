import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageShell } from "@/shared/ui";
import { ContinueButton, ContinueLink } from "./ContinueButton";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Signing in is optional. It gives you a profile on People and one account on every device.",
};

/** Why sign in, in two lines, then one button. Signing in is never required. */
export default function SignInPage() {
  return (
    <PageShell width="reading">
      <h1 className="text-3xl font-bold sm:text-4xl">Sign in</h1>
      <p className="mt-4 text-lg text-ink-soft">Signing in is optional. It adds:</p>
      <ul className="mt-3 flex list-disc flex-col gap-2 pl-6 text-lg">
        <li>A profile on People, built from the skills you have proven.</li>
        <li>The same account and progress on every device.</li>
      </ul>
      <p className="mt-4 text-base text-ink-soft">
        Everything else works as a guest: building maps, proving skills and sharing evidence.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        {/* The return path is in the URL, which only the browser knows at prerender time. */}
        <Suspense fallback={<ContinueLink href="/api/auth/login?returnTo=%2F" />}>
          <ContinueButton />
        </Suspense>
        <Link href="/" className="font-semibold text-ink underline underline-offset-4">
          Keep learning as a guest
        </Link>
      </div>
    </PageShell>
  );
}

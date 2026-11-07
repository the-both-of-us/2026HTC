import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { LogoMark } from "@/shared/ui";
import { SkipLink } from "@/shared/ui/SkipLink";

/** The public frame: no app navigation, because the reader is not a user of the app. */
export function ProofFrame({ children }: { children: ReactNode }) {
  return (
    <div className="proof-doc flex min-h-dvh flex-col">
      <SkipLink />
      <header className="border-b border-rule print:hidden">
        <div className="mx-auto flex min-h-14 w-full max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 text-lg font-medium">
            <LogoMark />
            OryxLearn
          </Link>
          <div className="flex items-center gap-4 text-sm text-ink-soft">
            <p className="hidden items-center gap-1.5 sm:flex">
              <ShieldCheck size={16} aria-hidden="true" />
              Evidence record
            </p>
            <Link href="/" className="underline underline-offset-4 hover:text-ink">
              Build your own
            </Link>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 print:max-w-none print:p-0">
        {children}
      </main>

      <footer className="border-t border-rule print:hidden">
        <p className="mx-auto w-full max-w-3xl px-4 py-6 text-sm text-ink-soft sm:px-6">
          OryxLearn is a student project built for Hack the Change 2026. This record is not an accredited credential.
        </p>
      </footer>
    </div>
  );
}

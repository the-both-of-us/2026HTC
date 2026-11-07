import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/** The public frame: no app navigation, because the reader is not a user of the app. */
export function ProofFrame({ children }: { children: ReactNode }) {
  return (
    <div className="proof-doc flex min-h-dvh flex-col">
      <header className="border-b border-rule print:hidden">
        <div className="mx-auto flex min-h-14 w-full max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold">
            <span aria-hidden="true" className="inline-block size-6 rounded-control bg-forest" />
            OryxLearn
          </Link>
          <p className="flex items-center gap-1.5 text-sm text-ink-soft">
            <ShieldCheck size={16} aria-hidden="true" />
            Evidence record
          </p>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 print:max-w-none print:p-0">
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

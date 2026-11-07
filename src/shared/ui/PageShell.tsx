import clsx from "clsx";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { LearningModeToggle } from "./LearningModeToggle";
import { LogoMark } from "./LogoMark";
import { SideNav } from "./SideNav";
import { SkipLink } from "./SkipLink";

type PageWidth = "reading" | "wide" | "full";

const WIDTH_CLASSES: Record<PageWidth, string> = {
  /** Evidence pages and long text: a comfortable line length. */
  reading: "mx-auto w-full max-w-3xl px-4 py-8 sm:px-7",
  /** Tools with more than one column. */
  wide: "mx-auto w-full max-w-6xl px-4 py-8 sm:px-7",
  /** The page manages its own layout, such as the map. */
  full: "w-full",
};

type PageShellProps = {
  width?: PageWidth;
  /** Links or actions in a bar above the page. */
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

/** Every page's frame: skip link, the sidebar (a top bar with a menu on phones), and <main>. */
export function PageShell({ width = "wide", headerActions, footer, children }: PageShellProps) {
  const guestNote = (
    <>
      <LearningModeToggle className="-mx-2" />
      <p className="text-sm text-ink-soft">
        Learning as a guest. Your progress stays in this browser.{" "}
        <Link href="/trust" className="font-semibold text-ink underline underline-offset-4">
          What we store
        </Link>
      </p>
    </>
  );

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <SkipLink />

      <aside
        aria-label="Site"
        className="z-40 flex flex-wrap items-center border-b border-rule bg-paper px-4 lg:sticky lg:top-0 lg:h-dvh lg:w-52 lg:shrink-0 lg:flex-col lg:flex-nowrap lg:items-stretch lg:border-r lg:border-b-0 lg:px-0"
      >
        <Link
          href="/"
          className="flex min-h-14 items-center gap-2.5 text-[1.1875rem] font-bold tracking-[-0.02em] font-stretch-[125%] lg:min-h-[3.75rem] lg:px-6"
        >
          <LogoMark />
          OryxLearn
        </Link>
        {/* The current page depends on the URL, so the links stream in after prerendering. */}
        <Suspense fallback={<span className="ml-auto min-h-11 lg:hidden" />}>
          <SideNav>{guestNote}</SideNav>
        </Suspense>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {headerActions && (
          <header className="flex min-h-14 items-center justify-end gap-3 border-b border-rule px-4 sm:px-7">
            {headerActions}
          </header>
        )}

        <main id="main" tabIndex={-1} className={clsx("flex flex-1 flex-col", WIDTH_CLASSES[width])}>
          {children}
        </main>

        {footer && <footer className="px-4 py-6 text-sm text-ink-soft sm:px-7">{footer}</footer>}
      </div>
    </div>
  );
}

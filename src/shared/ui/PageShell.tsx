import clsx from "clsx";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { SideNav } from "./SideNav";

type PageWidth = "reading" | "wide" | "full";

const WIDTH_CLASSES: Record<PageWidth, string> = {
  /** Evidence pages and long text: a comfortable line length. */
  reading: "mx-auto w-full max-w-3xl px-4 py-8 sm:px-6",
  /** Tools with more than one column. */
  wide: "mx-auto w-full max-w-6xl px-4 py-8 sm:px-6",
  /** The page manages its own layout, such as the map. */
  full: "w-full",
};

type PageShellProps = {
  width?: PageWidth;
  /** Links or actions on the right of the top bar. */
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

/** Every page's frame: skip link, sidebar, top bar and <main>. */
export function PageShell({ width = "wide", headerActions, footer, children }: PageShellProps) {
  return (
    <div className="flex min-h-dvh pb-16 lg:pb-0">
      <a
        href="#main"
        className="sr-only rounded-control bg-forest font-semibold text-on-dark focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2"
      >
        Skip to main content
      </a>

      <aside className="z-40 flex-col border-r border-rule bg-sheet lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-56 lg:shrink-0">
        <Link href="/" className="hidden items-center gap-2 px-5 pt-5 pb-2 text-lg font-bold lg:flex">
          <span aria-hidden="true" className="inline-block size-6 rounded-control bg-forest" />
          OryxLearn
        </Link>
        {/* The active link depends on the URL, so it streams in after prerendering. */}
        <Suspense fallback={<div className="min-h-14 lg:min-h-0" />}>
          <SideNav />
        </Suspense>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 items-center justify-between gap-4 border-b border-rule px-4 sm:px-6">
          <Link href="/" className="text-lg font-bold lg:invisible">
            OryxLearn
          </Link>
          {headerActions && <div className="flex items-center gap-3">{headerActions}</div>}
        </header>

        <main id="main" tabIndex={-1} className={clsx("flex flex-1 flex-col", WIDTH_CLASSES[width])}>
          {children}
        </main>

        {footer && <footer className="px-4 py-6 text-sm text-ink-soft sm:px-6">{footer}</footer>}
      </div>
    </div>
  );
}

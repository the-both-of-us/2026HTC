import clsx from "clsx";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { LogoMark } from "./LogoMark";
import { SideNav } from "./SideNav";
import { SkipLink } from "./SkipLink";

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

/** Every page's frame: skip link, sidebar, top bar on phones, and <main>. */
export function PageShell({ width = "wide", headerActions, footer, children }: PageShellProps) {
  return (
    <div className="flex min-h-dvh pb-24 lg:pb-0">
      <SkipLink />

      <aside aria-label="Site" className="z-40 flex-col border-r border-rule bg-sheet/80 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-48 lg:shrink-0">
        <Link
          href="/"
          className="hidden min-h-14 items-center gap-2.5 border-b border-rule px-4 text-lg font-medium lg:flex"
        >
          <LogoMark />
          OryxLearn
        </Link>
        {/* The active link depends on the URL, so it streams in after prerendering. */}
        <Suspense fallback={<div className="min-h-14 lg:min-h-0" />}>
          <SideNav />
        </Suspense>
        <p className="mt-auto hidden border-t border-rule px-4 py-4 text-sm text-ink-soft lg:block">
          Learning as a guest. Your progress stays with this browser.
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* On large screens the sidebar carries the name, so this bar only appears for actions. */}
        <header
          className={clsx(
            "flex min-h-14 items-center justify-between gap-4 border-b border-rule px-4 sm:px-6",
            !headerActions && "lg:hidden",
          )}
        >
          <Link href="/" className="flex items-center gap-2.5 text-lg font-medium lg:invisible">
            <LogoMark />
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

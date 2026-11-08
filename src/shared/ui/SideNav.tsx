"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { TopBarSignIn } from "./Account";

// Plain words, no icons, as in Seal. Mirza adds his pages' links here when they are ready.
const NAV_ITEMS = [
  { href: "/", label: "Build" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/courses", label: "Courses" },
  { href: "/review", label: "Review" },
  { href: "/people", label: "People" },
  { href: "/grid", label: "Read the Grid" },
  { href: "/trust", label: "Trust" },
];

/**
 * The site's links. On large screens a column of words down the sidebar, the current page
 * marked with an ink rule. On phones a "Menu" button that opens the same list under the top bar.
 * `children` sits under the links: appearance, the learning-mode switch and the account line.
 */
export function SideNav({ children }: { children?: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const streak = useStreak();

  return (
    <>
      {/* Phones: the streak, "Sign in" for guests, and the menu button, at the right of the top bar. */}
      <div className="ml-auto flex items-center gap-4 lg:hidden">
        <StreakFlame streak={streak} className="flex" />
        <TopBarSignIn />
        <button
          type="button"
          aria-expanded={open}
          aria-controls="site-menu"
          onClick={() => setOpen(!open)}
          className="min-h-11 cursor-pointer px-1 font-semibold underline decoration-[1.5px] underline-offset-4"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      <div
        id="site-menu"
        className={clsx("w-full basis-full flex-col pb-3 lg:flex lg:flex-1 lg:pb-0", open ? "flex" : "hidden")}
      >
        <StreakFlame streak={streak} className="hidden lg:mx-3 lg:flex" />
        <nav aria-label="Main" className="flex flex-col lg:px-3 lg:pt-2">
          {NAV_ITEMS.map(({ href, label }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "flex min-h-[2.875rem] items-center text-[1.0625rem] transition-control lg:min-h-11 lg:px-3 lg:text-[0.9375rem]",
                  active
                    ? "font-bold text-ink lg:shadow-[inset_3px_0_0_0_var(--color-ink)]"
                    : "font-medium text-ink-soft hover:text-ink lg:hover:shadow-[inset_2px_0_0_0_var(--color-ink)]",
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        {children && <div className="mt-3 flex flex-col gap-2 border-t border-rule pt-3 lg:mt-auto lg:px-3 lg:py-4">{children}</div>}
      </div>
    </>
  );
}

/** What the streaks feature sends: shared code can't import a feature, so the shape is repeated here. */
type Streak = { count: number; doneToday: boolean };

/** The daily streak. It loads once, then follows the "oryx:streak" event that the map sends after each proof. */
function useStreak(): Streak | null {
  const [streak, setStreak] = useState<Streak | null>(null);

  useEffect(() => {
    fetch("/api/streak")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { streak: Streak | null } | null) => setStreak((current) => current ?? body?.streak ?? null))
      .catch(() => undefined);
    const onStreak = (event: Event) => setStreak((event as CustomEvent<Streak>).detail);
    window.addEventListener("oryx:streak", onStreak);
    return () => window.removeEventListener("oryx:streak", onStreak);
  }, []);

  return streak;
}

/** The streak's flame. Nothing shows until there is a streak. */
function StreakFlame({ streak, className }: { streak: Streak | null; className?: string }) {
  if (!streak || streak.count === 0) return null;
  const label = `${streak.count}-day streak${streak.doneToday ? ", kept today" : ", 1 topic keeps it today"}`;

  return (
    <p
      title={label}
      className={clsx(
        "min-h-11 items-center gap-1.5 text-sm font-semibold tabular-nums lg:px-3",
        streak.doneToday ? "text-ink" : "text-ink-soft",
        className ?? "flex",
      )}
    >
      <Flame aria-hidden="true" size={18} className={streak.doneToday ? "fill-ink/20" : "opacity-70"} />
      <span aria-hidden="true">{streak.count}</span>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="font-medium">
        {streak.count === 1 ? "day" : "days"}
      </span>
    </p>
  );
}

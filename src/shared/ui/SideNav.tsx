"use client";

import clsx from "clsx";
import { BookOpen, Flame, LayoutDashboard, Plus, RotateCcw, ShieldCheck, Users, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Build", icon: Plus },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/review", label: "Review", icon: RotateCcw },
  { href: "/courses", label: "Courses", icon: BookOpen },
  { href: "/people", label: "People", icon: Users },
  { href: "/grid", label: "Grid", icon: Zap },
  // Phones reach it from the top bar instead, so the pill keeps room for its icons.
  { href: "/trust", label: "Trust", icon: ShieldCheck, largeOnly: true },
];

/** Sidebar on large screens, a floating pill of icons on phones. The pill's icons share its width, so it never runs off the screen. */
export function SideNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className={clsx(
        "fixed inset-x-3 bottom-3 z-40 flex justify-between gap-0.5 rounded-full border border-rule-strong bg-raised/95 p-1.5 shadow-panel backdrop-blur",
        "lg:static lg:flex-col lg:justify-start lg:gap-1 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-3 lg:shadow-none lg:backdrop-blur-none",
      )}
    >
      <StreakFlame />
      {NAV_ITEMS.map(({ href, label, icon: Icon, largeOnly }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "min-h-11 min-w-0 flex-1 items-center justify-center gap-2.5 rounded-full border text-sm font-medium transition-control",
              "lg:flex-none lg:justify-start lg:rounded-control lg:px-3",
              largeOnly ? "hidden lg:flex" : "flex",
              active
                ? "border-transparent bg-accent text-on-dark shadow-glow lg:border-accent/45 lg:bg-accent/15 lg:text-ink lg:shadow-none"
                : "border-transparent text-ink-soft hover:bg-rule-strong/60 hover:text-ink",
            )}
          >
            <Icon aria-hidden="true" size={18} className={clsx(active && "lg:text-accent-bright")} />
            <span className="sr-only lg:not-sr-only">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** What the streaks feature sends: shared code can't import a feature, so the shape is repeated here. */
type Streak = { count: number; doneToday: boolean };

/**
 * The daily streak's flame. It loads once, then follows the "oryx:streak" event that the map
 * sends after each proof. Nothing shows until there is a streak.
 */
function StreakFlame() {
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

  if (!streak || streak.count === 0) return null;
  const label = `${streak.count}-day streak${streak.doneToday ? ", kept today" : ", 1 topic keeps it today"}`;

  return (
    <p
      title={label}
      className={clsx(
        "flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-full text-sm font-semibold tabular-nums",
        "lg:flex-none lg:justify-start lg:gap-2.5 lg:px-3",
        streak.doneToday ? "text-amber" : "text-ink-soft",
      )}
    >
      <Flame aria-hidden="true" size={18} className={clsx(streak.doneToday ? "fill-amber/30" : "opacity-70")} />
      <span aria-hidden="true">{streak.count}</span>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="hidden font-medium lg:inline">
        {streak.count === 1 ? "day" : "days"}
      </span>
    </p>
  );
}

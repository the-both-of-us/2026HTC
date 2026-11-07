"use client";

import clsx from "clsx";
import { BookOpen, LayoutDashboard, Plus, RotateCcw, ShieldCheck, Users, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

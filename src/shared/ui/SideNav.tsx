"use client";

import clsx from "clsx";
import { BookOpen, LayoutDashboard, Plus, RotateCcw, Swords, Users, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Build", icon: Plus },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/courses", label: "Courses", icon: BookOpen },
  { href: "/review", label: "Review", icon: RotateCcw },
  { href: "/people", label: "People", icon: Users },
  { href: "/battle", label: "Battle", icon: Swords },
  { href: "/grid", label: "Grid", icon: Zap },
];

/** Sidebar on large screens, a scrolling bottom bar on phones. */
export function SideNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex gap-1 overflow-x-auto border-t border-rule bg-sheet px-2 py-1.5 lg:static lg:flex-col lg:overflow-visible lg:border-t-0 lg:bg-transparent lg:p-3"
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "flex min-h-11 shrink-0 items-center gap-2.5 rounded-control border px-3 text-sm font-medium",
              active
                ? "border-forest/40 bg-forest/15 text-ink"
                : "border-transparent text-ink-soft hover:bg-rule hover:text-ink",
            )}
          >
            <Icon aria-hidden="true" size={18} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

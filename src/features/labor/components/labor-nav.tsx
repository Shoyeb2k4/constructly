"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, BarChart3, HardHat } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Labour types are deliberately NOT a primary tab.
 *
 * A labour type is never the thing a user came here to do — it exists to be
 * priced under an agreement or recorded against on a sheet. Managing it where
 * it is needed (Manage scope, or the attendance sheet) beats a top-level list
 * users had to visit first and then navigate back from. The full taxonomy
 * screen still exists at /labor/categories for bulk cleanup and reordering, and
 * is reached from those same places.
 */
const ITEMS = [
  { label: "Attendance", href: "/labor", icon: CalendarCheck, exact: true },
  { label: "Contractors", href: "/labor/contractors", icon: HardHat },
  { label: "Summary", href: "/labor/summary", icon: BarChart3 },
];

export function LaborNav() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-border pb-px">
      {ITEMS.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-foreground-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

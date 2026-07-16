"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, Tags, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { label: "Attendance", href: "/labor", icon: CalendarCheck, exact: true },
  { label: "Categories", href: "/labor/categories", icon: Tags },
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

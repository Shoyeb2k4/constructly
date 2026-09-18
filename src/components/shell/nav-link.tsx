"use client";

import Link from "next/link";
import type { NavItem } from "@/config/nav";
import { cn } from "@/lib/utils";

export function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  /** Resolved by NavList, which can see every item — a link cannot tell on its
   *  own whether a MORE specific item also matches the current path. */
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
        active
          ? "bg-surface-muted text-foreground"
          : "text-foreground-muted hover:bg-surface-muted/60 hover:text-foreground",
      )}
    >
      <Icon
        className={cn(
          "size-[18px] shrink-0 transition-colors",
          active ? "text-accent" : "text-foreground-subtle group-hover:text-foreground-muted",
        )}
      />
      {item.label}
    </Link>
  );
}

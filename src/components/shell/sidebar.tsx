"use client";

import { X } from "lucide-react";
import { NAV_ITEMS } from "@/config/nav";
import type { SessionUser } from "@/lib/auth/types";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { NavLink } from "./nav-link";

/** Company branding for the shell (resolved server-side; Constructly fallback). */
export interface ShellBranding {
  name: string;
  logoUrl: string | null;
}

function NavList({
  user,
  onNavigate,
}: {
  user: SessionUser;
  onNavigate?: () => void;
}) {
  const items = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(user.role),
  );
  return (
    <nav className="flex-1 space-y-0.5 px-3 py-4">
      {items.map((item) => (
        <NavLink key={item.href} item={item} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

export function Sidebar({
  user,
  branding,
  mobileOpen,
  onClose,
}: {
  user: SessionUser;
  branding?: ShellBranding;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const logoSrc = branding?.logoUrl ?? null;
  const brandName = branding?.name ?? user.company.name;
  return (
    <>
      {/* Desktop rail */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-14 items-center px-5">
          <Logo src={logoSrc} name={brandName} />
        </div>
        <NavList user={user} />
        <div className="px-5 py-4">
          <span className="text-xs text-foreground-subtle">{brandName}</span>
        </div>
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          "fixed inset-0 z-50 lg:hidden",
          mobileOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <div
          onClick={onClose}
          className={cn(
            "absolute inset-0 bg-black/40 transition-opacity duration-200",
            mobileOpen ? "opacity-100" : "opacity-0",
          )}
        />
        <aside
          className={cn(
            "absolute left-0 top-0 flex h-full w-64 flex-col border-r border-border bg-surface transition-transform duration-200",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex h-14 items-center justify-between px-5">
            <Logo src={logoSrc} name={brandName} />
            <button
              onClick={onClose}
              aria-label="Close menu"
              className="rounded-md p-1 text-foreground-subtle hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>
          <NavList user={user} onNavigate={onClose} />
        </aside>
      </div>
    </>
  );
}

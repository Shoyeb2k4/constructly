"use client";

import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OfflineIndicator } from "@/components/patterns/offline-indicator";
import type { SessionUser } from "@/lib/auth/types";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { openCommandPalette } from "./command-palette";

export function Topbar({
  user,
  pending,
  onMenu,
}: {
  user: SessionUser;
  pending: number;
  onMenu: () => void;
}) {
  return (
    // The status bar, notch and Dynamic Island sit above this header on a
    // device. Padding the top by the safe-area inset moves the controls below
    // them; it resolves to 0 in a browser, so the web header is unchanged.
    <header
      className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur-md sm:px-6"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        height: "calc(3.5rem + env(safe-area-inset-top))",
        paddingLeft: "max(1rem, env(safe-area-inset-left))",
        paddingRight: "max(1rem, env(safe-area-inset-right))",
      }}
    >
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onMenu}
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </Button>

      <button
        onClick={openCommandPalette}
        className="group flex h-9 w-full max-w-xs items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-foreground-subtle transition-colors hover:border-border-strong"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="hidden rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] sm:inline">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <OfflineIndicator pending={pending} />
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}

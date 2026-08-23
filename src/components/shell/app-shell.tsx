"use client";

import * as React from "react";
import type { SessionUser } from "@/lib/auth/types";
import { useSync } from "@/lib/sync/use-sync";
import { Sidebar, type ShellBranding } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";

export function AppShell({
  user,
  branding,
  children,
}: {
  user: SessionUser;
  branding?: ShellBranding;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { pending } = useSync();

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Keyboard users land here first; visible only when focused. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <Sidebar
        user={user}
        branding={branding}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          pending={pending}
          onMenu={() => setMobileOpen(true)}
        />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto">
          {/*
            Safe-area padding keeps content clear of the home indicator and the
            rounded corners on notched iPhones. `env(safe-area-inset-*)` is 0 in
            a desktop browser and on non-notched devices, so this is inert on
            the web — no separate layout, no branching.
          */}
          <div
            className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8"
            style={{
              paddingLeft: "max(1rem, env(safe-area-inset-left))",
              paddingRight: "max(1rem, env(safe-area-inset-right))",
              paddingBottom: "calc(2rem + env(safe-area-inset-bottom))",
            }}
          >
            {children}
          </div>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}

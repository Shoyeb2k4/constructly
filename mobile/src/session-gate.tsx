import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { call, RpcError } from "@/lib/mobile/rpc";
import { isDemoMode } from "@/lib/env";
import { DEMO_USER } from "@/lib/auth/demo";
import type { SessionUser } from "@/lib/auth/types";

/**
 * Resolves the session for the native app.
 *
 * On the web this is free: `src/app/(app)/layout.tsx` awaits `getCurrentUser()`
 * during the server render and passes the result into `AppShell` and
 * `PermissionProvider` as props. The native app has no server render, so it
 * makes the same resolution explicit — one `session.me` RPC at boot, returning
 * the identical `SessionUser` from the identical server function.
 *
 * The states below mirror the web layout's redirect branches exactly:
 *   no session   → sign in
 *   NO_WORKSPACE → onboarding / invite / deactivated (all handled server-side)
 */
export function useSession() {
  return useQuery<SessionUser | null>({
    queryKey: ["mobile", "session"],
    queryFn: async () => {
      // Mirrors `getCurrentUser()`'s own first branch: demo builds resolve to
      // the seeded demo owner and never touch the network, so the whole app can
      // be exercised on a laptop with no backend running.
      if (isDemoMode) return DEMO_USER;
      try {
        return await call<SessionUser>("session", "me");
      } catch (err) {
        // Signed out, or a verified user with no active workspace row. Both mean
        // "no session" to the UI; the sign-in screen explains the difference.
        if (err instanceof RpcError && (err.status === 401 || err.status === 403)) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function BootScreen({ label }: { label: string }) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center"
      style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}
    >
      <div className="size-10 animate-spin rounded-full border-2 border-border border-t-primary" />
      <p className="text-sm text-foreground-muted">{label}</p>
    </div>
  );
}

export function BootError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center"
      style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}
    >
      <h1 className="text-lg font-semibold">
        {offline ? "You're offline" : "Couldn't reach Constructly"}
      </h1>
      <p className="max-w-xs text-sm text-foreground-muted">
        {offline
          ? "Reconnect to load your workspace. Work you've already queued will sync automatically."
          : error instanceof Error
            ? error.message
            : "Something went wrong while starting up."}
      </p>
      <button
        onClick={onRetry}
        className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        Try again
      </button>
      {isDemoMode && (
        <p className="mt-4 text-xs text-foreground-subtle">Running in demo mode.</p>
      )}
    </div>
  );
}

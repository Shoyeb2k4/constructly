import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { call, RpcError, RpcTransportError } from "@/lib/mobile/rpc";
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

/**
 * What actually went wrong, in the user's words and in a developer's.
 *
 * The first run on real hardware showed "Couldn't reach Constructly / Failed to
 * fetch". Both halves were true and neither was useful: the phone had a working
 * connection, and the real cause — the mobile API was not deployed to the
 * backend the build pointed at — took a full adb investigation to establish.
 *
 * The three cases below are genuinely different situations with different
 * remedies, so they are no longer collapsed into one message. A server that
 * ANSWERS is never described as unreachable.
 */
function describeBootError(error: unknown, offline: boolean) {
  if (offline) {
    return {
      title: "You're offline",
      body: "Reconnect to load your workspace. Work you've already queued will sync automatically.",
      detail: null,
    };
  }

  if (error instanceof RpcTransportError) {
    return {
      title: "Couldn't reach Constructly",
      body:
        "Your device is online, but the Constructly server did not respond. " +
        "This is usually the server, not your connection — try again shortly.",
      // The URL is the single fact that makes this diagnosable. Without it,
      // "Failed to fetch" is indistinguishable from a dozen other causes.
      detail: error.url,
    };
  }

  if (error instanceof RpcError) {
    // The server answered. Saying "couldn't reach" here would be a lie, and
    // sends whoever reads it looking at the network instead of the response.
    return {
      title: "Constructly couldn't start",
      body: "The server responded, but not with your workspace.",
      detail: `HTTP ${error.status} · ${error.code}`,
    };
  }

  return {
    title: "Constructly couldn't start",
    body: "Something went wrong while starting up.",
    detail: error instanceof Error ? error.message : null,
  };
}

export function BootError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const { title, body, detail } = describeBootError(error, offline);
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center"
      style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}
    >
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="max-w-xs text-sm text-foreground-muted">{body}</p>
      {detail && (
        <p className="max-w-xs break-all font-mono text-xs text-foreground-subtle">{detail}</p>
      )}
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

import * as React from "react";
import { HashRouter } from "react-router";
import { Providers } from "@/app/providers";
import { AppShell } from "@/components/shell/app-shell";
import { PermissionProvider } from "@/features/rbac/permission-context";
import { BootScreen, BootError, useSession } from "./session-gate";
import { MobileRoutes } from "./router";
import { SignInScreen } from "./screens/sign-in";

/**
 * Native app root.
 *
 * This is the mobile counterpart of `src/app/layout.tsx` + `(app)/layout.tsx`,
 * and it deliberately composes the SAME pieces: the same `Providers` (theme,
 * React Query, tooltips, toasts, error reporting), the same `AppShell`, the same
 * `PermissionProvider`. The only difference is that the session is fetched
 * rather than server-rendered.
 *
 * HashRouter, not BrowserRouter: the bundle is served by WKWebView from
 * `capacitor://localhost` with no server to rewrite deep paths, so a reload or a
 * restored session on `/projects/abc` must not depend on server-side routing.
 * There is no address bar, so the `#` is never seen.
 */
export function MobileApp() {
  return (
    <Providers>
      <HashRouter>
        <SessionBoundary />
      </HashRouter>
    </Providers>
  );
}

function SessionBoundary() {
  const { data: user, isPending, error, refetch } = useSession();

  if (isPending) return <BootScreen label="Starting Constructly…" />;
  if (error) return <BootError error={error} onRetry={() => void refetch()} />;
  if (!user) return <SignInScreen onSignedIn={() => void refetch()} />;

  return (
    <PermissionProvider permissions={user.permissions ?? []} isOwner={user.isOwner}>
      <AppShell user={user}>
        <MobileRoutes user={user} />
      </AppShell>
    </PermissionProvider>
  );
}

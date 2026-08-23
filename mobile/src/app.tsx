import * as React from "react";
import { HashRouter } from "react-router";
import { toast } from "sonner";
import { Providers } from "@/app/providers";
import { AppShell } from "@/components/shell/app-shell";
import { PermissionProvider } from "@/features/rbac/permission-context";
import { isDemoMode } from "@/lib/env";
import { BootScreen, BootError, useSession } from "./session-gate";
import { MobileRoutes } from "./router";
import { SignInScreen } from "./screens/sign-in";
import { ResetPasswordScreen } from "./screens/reset-password";
import { markScreen } from "./boot-marker";
import { authLinkBus } from "./auth-link-bus";

/**
 * Native app root.
 *
 * The mobile counterpart of `src/app/layout.tsx` + `(app)/layout.tsx`, composing
 * the SAME pieces: the same `Providers`, `AppShell` and `PermissionProvider`.
 * The only difference is that the session is fetched rather than
 * server-rendered.
 *
 * HashRouter, not BrowserRouter: the bundle is served by WKWebView from
 * `capacitor://localhost` with no server to rewrite deep paths, so a reload on
 * `/projects/abc` must not depend on server-side routing. There is no address
 * bar, so the `#` is never seen.
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
  const [recovering, setRecovering] = React.useState(false);

  // Deep links resolve outside React (they can arrive before the tree exists),
  // so results are delivered through a bus rather than props.
  React.useEffect(() => {
    return authLinkBus.subscribe((result) => {
      if (result.kind === "oauth-code") {
        // The session now exists; re-resolve who the user is.
        void refetch();
      } else if (result.kind === "email-token") {
        if (result.type === "recovery") setRecovering(true);
        else void refetch();
      } else if (result.kind === "error") {
        toast.error("Sign-in link failed", { description: result.reason });
      }
    });
  }, [refetch]);

  const settled = recovering
    ? "reset-password"
    : isPending
      ? null
      : error
        ? "boot-error"
        : user
          ? "app-shell"
          : "sign-in";

  React.useEffect(() => {
    if (settled) markScreen(settled, { demo: isDemoMode });
  }, [settled]);

  if (recovering) {
    return (
      <ResetPasswordScreen
        onDone={() => {
          setRecovering(false);
          authLinkBus.clear();
          void refetch();
        }}
      />
    );
  }

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

import * as React from "react";
import { toast } from "sonner";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isSupabaseConfigured } from "@/lib/env";
import { getMobileSupabase } from "@/lib/mobile/session";

/**
 * Native sign-in.
 *
 * Email + password only, on purpose. The web screen's "Continue with Google"
 * uses `redirectTo: window.location.origin + "/auth/callback"`, which under
 * Capacitor evaluates to `capacitor://localhost` — a scheme Google rejects as a
 * redirect URI. Native OAuth needs ASWebAuthenticationSession plus a registered
 * custom scheme and a client-side PKCE exchange; that is scheduled work, so the
 * button is absent here rather than present and broken.
 *
 * The session is stored by `getMobileSupabase()` (client-side, auto-refreshing)
 * and presented to the backend as a bearer token on every RPC call.
 */
export function SignInScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      toast.error("This build has no Supabase configuration");
      return;
    }
    setBusy(true);
    const { error } = await getMobileSupabase().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error("Couldn't sign you in", { description: error.message });
      return;
    }
    onSignedIn();
  }

  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background px-6"
      style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo showText={false} className="scale-125" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-foreground-muted">
              Sign in to your Constructly workspace
            </p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={signIn}>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}

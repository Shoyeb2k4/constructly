import * as React from "react";
import { toast } from "sonner";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { isSupabaseConfigured } from "@/lib/env";
import { getMobileSupabase } from "@/lib/mobile/session";
import { startGoogleSignIn } from "../native/auth";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z" />
    </svg>
  );
}

/**
 * Native sign-in.
 *
 * Both paths go through the mobile Supabase client, whose session lands in the
 * Keychain and is presented to `/api/mobile` as a bearer token. Google differs
 * from the web only in its redirect target: the web uses
 * `window.location.origin`, which is `capacitor://localhost` here and is
 * rejected by Google, so the native flow redirects to a registered custom
 * scheme and finishes via a deep link.
 *
 * Nothing here logs credentials, tokens, or provider responses.
 */
export function SignInScreen({
  onSignedIn,
  initialError = null,
}: {
  onSignedIn: () => void;
  /**
   * A failure that happened OUTSIDE this screen — specifically an OAuth deep
   * link that came back broken while the app was still resuming from the system
   * browser. It is passed in rather than toasted at the source because a toast
   * fired during a resume can be missed entirely, and the user is then left on a
   * sign-in screen with no idea why they are back on it.
   */
  initialError?: string | null;
}) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState<"password" | "google" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /**
   * Set once the user starts a fresh attempt, which retires the inherited
   * failure. Tracked as a flag rather than by copying `initialError` into state
   * in an effect: syncing a prop into state that way triggers a cascading
   * render, and React's lint rule is right to refuse it. The displayed value is
   * DERIVED below instead.
   */
  const [ownAttempt, setOwnAttempt] = React.useState(false);

  /** Local failures win; otherwise show what the deep link brought in. */
  const shownError = error ?? (ownAttempt ? null : initialError);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOwnAttempt(true);
    if (!isSupabaseConfigured) {
      setError("This build has no Supabase configuration.");
      return;
    }

    setBusy("password");
    try {
      const { data, error: authError } = await getMobileSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        // Supabase returns one deliberately vague message for a wrong password
        // and for an unknown account; keep it that way rather than confirming
        // which addresses exist.
        setError(
          /invalid login credentials/i.test(authError.message)
            ? "That email or password isn't right."
            : authError.message,
        );
        return;
      }
      if (!data.session) {
        setError("Signed in but no session was returned. Please try again.");
        return;
      }
      onSignedIn();
    } catch {
      // Thrown (rather than returned) errors are transport failures.
      setError("Couldn't reach Constructly. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function googleSignIn() {
    setError(null);
    setOwnAttempt(true);
    if (!isSupabaseConfigured) {
      setError("This build has no Supabase configuration.");
      return;
    }
    setBusy("google");
    try {
      const result = await startGoogleSignIn();
      if (!result.ok) setError(result.reason);
      // On success the system browser is now open; the flow finishes when iOS
      // hands the callback URL back to the app.
    } catch {
      setError("Couldn't open Google sign-in.");
    } finally {
      setBusy(null);
    }
  }

  // The toast is the notification; the panel below is the record. A sign-in
  // failure is something the user has to act on, so it must not disappear on a
  // timer — which is exactly how a Google failure became "it just says sign in
  // failed" with no way to find out more.
  React.useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

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

        {shownError && (
          <div
            role="alert"
            data-testid="signin-error"
            className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
          >
            {shownError}
          </div>
        )}

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
          <Button type="submit" variant="primary" className="w-full" disabled={busy !== null}>
            {busy === "password" ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-foreground-subtle">or</span>
          <Separator className="flex-1" />
        </div>

        <Button
          variant="outline"
          className="w-full"
          onClick={googleSignIn}
          disabled={busy !== null}
          data-testid="google-signin"
        >
          <GoogleIcon />
          {busy === "google" ? "Opening Google…" : "Continue with Google"}
        </Button>

        {error && (
          <p role="alert" className="mt-4 text-center text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

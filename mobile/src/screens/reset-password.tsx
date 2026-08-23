import * as React from "react";
import { toast } from "sonner";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMobileSupabase } from "@/lib/mobile/session";

/**
 * Set a new password on the native app.
 *
 * Mirrors the web screen's rules, but is reached differently: the recovery
 * email link arrives as a deep link, `verifyOtp` has already exchanged its
 * token hash for a transient session, and the user is momentarily authenticated
 * here. If that session is missing the link was expired or reused.
 */
export function ResetPasswordScreen({ onDone }: { onDone: () => void }) {
  const [ready, setReady] = React.useState<boolean | null>(null);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    getMobileSupabase()
      .auth.getUser()
      .then(({ data }) => setReady(!!data.user))
      .catch(() => setReady(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setBusy(true);
    const { error } = await getMobileSupabase().auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error("Couldn't update your password", { description: error.message });
      return;
    }
    toast.success("Password updated");
    onDone();
  }

  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background px-6"
      style={{ paddingTop: "var(--safe-top)", paddingBottom: "var(--safe-bottom)" }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo showText={false} className="scale-125" />
          <h1 className="text-xl font-semibold tracking-tight">Choose a new password</h1>
        </div>

        {ready === null ? (
          <p className="py-4 text-center text-sm text-foreground-muted">Verifying your link…</p>
        ) : ready === false ? (
          <div className="space-y-3 py-4 text-center">
            <h2 className="text-base font-semibold">This link has expired</h2>
            <p className="text-sm text-foreground-muted">
              Reset links are single-use and expire after an hour. Request a new one from the
              sign-in screen.
            </p>
            <Button variant="primary" className="mt-2 w-full" onClick={onDone}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

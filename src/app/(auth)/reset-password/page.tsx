"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

/**
 * Set a new password. Reached from the recovery email link after /auth/callback
 * has exchanged the code for a (recovery) session — so the user is transiently
 * authenticated here and can call updateUser. If there is no session (expired
 * or reused link), we send them back to request a fresh one.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = React.useState<boolean | null>(null);
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setReady(!!data.user));
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
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error("Couldn't update your password", { description: error.message });
      return;
    }
    toast.success("Password updated");
    // getCurrentUser() decides /dashboard vs /onboarding on landing.
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo showText={false} className="scale-125" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Choose a new password</h1>
            <p className="mt-1 text-sm text-foreground-muted">
              Enter it twice to confirm
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          {ready === null ? (
            <p className="py-4 text-center text-sm text-foreground-muted">Verifying your link…</p>
          ) : ready === false ? (
            <div className="space-y-3 py-4 text-center">
              <h2 className="text-base font-semibold">This link has expired</h2>
              <p className="text-sm text-foreground-muted">
                Reset links are single-use and expire after an hour.
              </p>
              <Button asChild variant="primary" className="mt-2 w-full">
                <Link href="/forgot-password">Request a new link</Link>
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <Button type="submit" variant="primary" className="w-full" disabled={busy}>
                {busy ? "Updating…" : "Update password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

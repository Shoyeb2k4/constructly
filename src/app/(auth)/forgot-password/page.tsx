"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/env";

/**
 * Password-reset request. Sends a recovery email whose link routes through
 * /auth/callback (PKCE exchange) to /reset-password, where a new password is
 * set. To avoid account enumeration we always show the same "check your email"
 * confirmation, regardless of whether the address exists.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      toast("Connect Supabase to enable password reset");
      return;
    }
    setBusy(true);
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    // Surface only transport/rate-limit problems; never reveal whether the
    // email is registered.
    if (error && /rate|limit|too many/i.test(error.message)) {
      toast.error("Too many attempts", { description: "Please wait a minute and try again." });
      return;
    }
    setSent(true);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo showText={false} className="scale-125" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
            <p className="mt-1 text-sm text-foreground-muted">
              We&apos;ll email you a link to set a new one
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          {sent ? (
            <div className="space-y-3 py-4 text-center">
              <h2 className="text-base font-semibold">Check your email</h2>
              <p className="text-sm text-foreground-muted">
                If an account exists for <span className="font-medium">{email}</span>, a
                password-reset link is on its way. The link expires in one hour.
              </p>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Work email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" variant="primary" className="w-full" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-foreground-muted">
          Remembered it?{" "}
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

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
import { isSupabaseConfigured } from "@/lib/env";

export default function SignUpPage() {
  const router = useRouter();
  const [fullName, setFullName] = React.useState("");
  const [companyName, setCompanyName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [emailSent, setEmailSent] = React.useState(false);

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      toast("Connect Supabase to enable sign-up");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    const { data, error } = await createClient().auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
        // Carried into onboarding so the workspace form is pre-filled.
        data: { full_name: fullName, company_name: companyName },
      },
    });
    setBusy(false);
    if (error) {
      toast.error("Couldn't create your account", { description: error.message });
      return;
    }
    if (data.session) {
      // Email confirmation disabled — session is live; provision the workspace.
      router.push("/onboarding");
      router.refresh();
    } else {
      setEmailSent(true);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo showText={false} className="scale-125" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Create your workspace</h1>
            <p className="mt-1 text-sm text-foreground-muted">
              Run your construction business from one place
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          {emailSent ? (
            <div className="space-y-3 py-4 text-center">
              <h2 className="text-base font-semibold">Check your email</h2>
              <p className="text-sm text-foreground-muted">
                We sent a confirmation link to <span className="font-medium">{email}</span>.
                Click it to activate your account, then finish setting up your company.
              </p>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={signUp}>
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Your name</Label>
                <Input id="fullName" autoComplete="name" placeholder="Aarav Mehta"
                  value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="companyName">Company name</Label>
                <Input id="companyName" autoComplete="organization" placeholder="Meridian Build Co."
                  value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Work email</Label>
                <Input id="email" type="email" autoComplete="email" placeholder="you@company.com"
                  value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="new-password" placeholder="At least 8 characters"
                  value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              </div>
              <Button type="submit" variant="primary" className="w-full" disabled={busy}>
                {busy ? "Creating account…" : "Create account"}
              </Button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-foreground-muted">
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

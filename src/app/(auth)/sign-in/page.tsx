"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/env";

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

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (params.get("error") === "auth") {
      toast.error("Sign-in link failed", { description: "Please try again." });
    }
  }, [params]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      toast("Connect Supabase to enable sign-in", {
        description: "Meanwhile, explore everything in demo mode.",
      });
      return;
    }
    setBusy(true);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error("Couldn't sign you in", { description: error.message });
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function signInWithGoogle() {
    if (!isSupabaseConfigured) {
      toast("Google sign-in requires Supabase configuration");
      return;
    }
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
    });
    if (error) {
      toast.error("Google sign-in unavailable", {
        description: "Enable the Google provider in Supabase Auth settings.",
      });
    }
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        <form className="space-y-4" onSubmit={signIn}>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
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
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>
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

        <div className="my-4 flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-foreground-subtle">or</span>
          <Separator className="flex-1" />
        </div>

        <Button variant="outline" className="w-full" onClick={signInWithGoogle}>
          <GoogleIcon />
          Continue with Google
        </Button>

        <p className="mt-4 text-center text-sm text-foreground-muted">
          New to Constructly?{" "}
          <Link href="/sign-up" className="font-medium text-primary hover:underline">
            Create your workspace
          </Link>
        </p>
      </div>

      {!isSupabaseConfigured && (
        <div className="mt-6 rounded-xl border border-dashed border-border-strong bg-surface/50 p-4 text-center">
          <p className="text-sm text-foreground-muted">Just exploring?</p>
          <Button asChild variant="primary" className="mt-2 w-full">
            <Link href="/dashboard">Enter demo workspace</Link>
          </Button>
        </div>
      )}
    </>
  );
}

export default function SignInPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-12">
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
        {/* useSearchParams requires a Suspense boundary during prerender. */}
        <React.Suspense fallback={null}>
          <SignInForm />
        </React.Suspense>
      </div>
    </div>
  );
}

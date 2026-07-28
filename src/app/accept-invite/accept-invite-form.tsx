"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { acceptInvitation } from "@/features/team/server/actions";
import { ROLE_LABEL } from "@/features/team/schema";
import type { PendingInviteInfo } from "@/features/team/types";

export function AcceptInviteForm({ info }: { info: PendingInviteInfo }) {
  const router = useRouter();
  const [fullName, setFullName] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = confirm.length > 0 && pw !== confirm;
  const canSubmit = fullName.trim().length >= 2 && pw.length >= 8 && pw === confirm && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const { error } = await createClient().auth.updateUser({ password: pw });
      if (error) throw new Error(error.message);
      await acceptInvitation({ fullName: fullName.trim() });
      toast.success(`Welcome to ${info.companyName}`);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't complete setup");
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-3">
        <Logo />
        <div>
          <CardTitle>Join {info.companyName}</CardTitle>
          <CardDescription>
            You&apos;ve been invited as <strong>{ROLE_LABEL[info.role]}</strong> ({info.email}). Set your
            name and a password to finish.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ai-name">Full name</Label>
            <Input id="ai-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-pw">Password</Label>
            <Input id="ai-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            {tooShort && <p className="text-xs text-danger-foreground">At least 8 characters.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ai-confirm">Confirm password</Label>
            <Input id="ai-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            {mismatch && <p className="text-xs text-danger-foreground">Passwords don&apos;t match.</p>}
          </div>
          <Button type="submit" variant="primary" className="w-full" disabled={!canSubmit}>
            {busy ? "Setting up…" : "Join team"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

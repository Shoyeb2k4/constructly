"use client";

import * as React from "react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { onboardCompany, type OnboardState } from "@/lib/auth/actions";

export function OnboardingForm({
  defaultFullName,
  defaultCompany,
}: {
  defaultFullName: string;
  defaultCompany: string;
}) {
  const [state, formAction, pending] = useActionState<OnboardState, FormData>(
    onboardCompany,
    {},
  );

  return (
    <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
      <form action={formAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Your name</Label>
          <Input id="fullName" name="fullName" defaultValue={defaultFullName}
            placeholder="Aarav Mehta" autoComplete="name" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="companyName">Company name</Label>
          <Input id="companyName" name="companyName" defaultValue={defaultCompany}
            placeholder="Meridian Build Co." autoComplete="organization" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gstin">Company GSTIN (optional)</Label>
          <Input id="gstin" name="gstin" placeholder="29ABCDE1234F1Z5" className="font-mono uppercase" />
        </div>
        {state.error && (
          <p className="text-sm text-danger-foreground" role="alert">{state.error}</p>
        )}
        <Button type="submit" variant="primary" className="w-full" disabled={pending}>
          {pending ? "Creating workspace…" : "Create workspace"}
        </Button>
      </form>
    </div>
  );
}

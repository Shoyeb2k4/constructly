"use client";

import { useRouter } from "next/navigation";
import { ShieldOff } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function DeactivatedPage() {
  const router = useRouter();

  async function signOut() {
    const { isSupabaseConfigured } = await import("@/lib/env");
    if (isSupabaseConfigured) {
      const { createClient } = await import("@/lib/supabase/client");
      await createClient().auth.signOut();
    }
    router.push("/sign-in");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <Logo />
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-danger-subtle text-danger-foreground">
              <ShieldOff className="size-4" />
            </span>
            <div>
              <CardTitle>Account deactivated</CardTitle>
              <CardDescription>
                Your access to this workspace has been turned off. Contact an owner if you think this is a
                mistake.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" className="w-full" onClick={signOut}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

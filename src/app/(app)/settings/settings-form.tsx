"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import {
  getApprovalRequired,
  setApprovalRequired,
  subscribeSettings,
} from "@/features/settings/demo-settings";

export function SettingsPreferences() {
  const approval = React.useSyncExternalStore(
    subscribeSettings,
    getApprovalRequired,
    () => true,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
        <CardDescription>How your workspace behaves.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="flex items-center justify-between py-3">
          <div className="pr-6">
            <p className="text-sm font-medium">Require PO approval</p>
            <p className="text-sm text-foreground-muted">
              Purchase orders need owner approval before they are final.
            </p>
          </div>
          <Switch
            checked={approval}
            onCheckedChange={(v) => {
              setApprovalRequired(v);
              toast(v ? "Approval required" : "Approval disabled", {
                description: "Purchase orders " + (v ? "need owner approval." : "are final on save."),
              });
            }}
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-medium">Appearance</p>
            <p className="text-sm text-foreground-muted">Light or dark theme.</p>
          </div>
          <ThemeToggle />
        </div>
      </CardContent>
    </Card>
  );
}

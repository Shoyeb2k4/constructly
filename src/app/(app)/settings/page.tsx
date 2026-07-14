import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PageHeader } from "@/components/patterns/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsPreferences } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3">
      <span className="text-sm text-foreground-muted">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const user = await getCurrentUser();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        description="Manage your company and workspace preferences."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Company</CardTitle>
            <CardDescription>Your organization details.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <Row label="Company name" value={user?.company.name ?? "—"} />
            <Row
              label="Your role"
              value={
                <Badge variant={user?.role === "OWNER" ? "primary" : "neutral"}>
                  {user?.role === "OWNER" ? "Owner" : "Project Manager"}
                </Badge>
              }
            />
            <Row
              label="GSTIN"
              value={<span className="font-mono">29ABCDE1234F1Z5</span>}
            />
          </CardContent>
        </Card>

        <SettingsPreferences initialApproval />
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { Building2, User, FileText, Palette, SlidersHorizontal, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CompanySection } from "@/features/branding/components/company-section";
import { AppearanceSection } from "@/features/branding/components/appearance-section";
import { DocumentsSection } from "@/features/branding/components/documents-section";
import { ProfileSection } from "@/features/branding/components/profile-section";
import { MaterialCategoriesCard } from "@/features/procurement/components/material-categories-card";
import { TeamSection } from "@/features/team/components/team-section";
import { SettingsPreferences } from "./settings-form";

type SectionId = "company" | "profile" | "documents" | "appearance" | "workspace" | "security";

const SECTIONS: { id: SectionId; label: string; icon: typeof Building2 }[] = [
  { id: "company", label: "Company", icon: Building2 },
  { id: "profile", label: "My Profile", icon: User },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "workspace", label: "Workspace", icon: SlidersHorizontal },
  { id: "security", label: "Security", icon: ShieldCheck },
];

export function SettingsView({ isOwner, role }: { isOwner: boolean; role: string }) {
  const [active, setActive] = React.useState<SectionId>("company");

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Company branding, your profile, and workspace preferences." />

      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        {/* Section nav */}
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Settings sections">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = active === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-foreground-muted hover:bg-surface-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {s.label}
              </button>
            );
          })}
        </nav>

        {/* Section content */}
        <div className="min-w-0">
          {active === "company" && <CompanySection isOwner={isOwner} />}
          {active === "profile" && <ProfileSection />}
          {active === "documents" && <DocumentsSection isOwner={isOwner} />}
          {active === "appearance" && <AppearanceSection isOwner={isOwner} />}
          {active === "workspace" && (
            <div className="space-y-6">
              <SettingsPreferences />
              <MaterialCategoriesCard />
            </div>
          )}
          {active === "security" &&
            (isOwner ? (
              <TeamSection />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Security</CardTitle>
                  <CardDescription>Team, roles, and sessions.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-foreground-muted">
                  <div className="flex items-center justify-between">
                    <span>Your role</span>
                    <Badge variant="neutral">
                      {role === "OWNER" ? "Owner" : "Project Manager"}
                    </Badge>
                  </div>
                  <p className="text-xs text-foreground-subtle">
                    Only owners can manage team members and roles.
                  </p>
                </CardContent>
              </Card>
            ))}
        </div>
      </div>
    </div>
  );
}

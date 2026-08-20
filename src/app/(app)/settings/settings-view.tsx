"use client";

import * as React from "react";
import { Building2, User, FileText, Palette, SlidersHorizontal, Users, KeyRound } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { cn } from "@/lib/utils";
import { CompanySection } from "@/features/branding/components/company-section";
import { AppearanceSection } from "@/features/branding/components/appearance-section";
import { DocumentsSection } from "@/features/branding/components/documents-section";
import { ProfileSection } from "@/features/branding/components/profile-section";
import { MaterialCategoriesCard } from "@/features/procurement/components/material-categories-card";
import { TeamSection } from "@/features/team/components/team-section";
import { RolesManager } from "@/features/rbac/components/roles-manager";
import { useCan } from "@/features/rbac/permission-context";
import { SettingsPreferences } from "./settings-form";

type SectionId = "company" | "profile" | "documents" | "appearance" | "workspace" | "users" | "roles";

const SECTIONS: { id: SectionId; label: string; icon: typeof Building2 }[] = [
  { id: "company", label: "Company", icon: Building2 },
  { id: "profile", label: "My Profile", icon: User },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "workspace", label: "Workspace", icon: SlidersHorizontal },
  { id: "users", label: "Users", icon: Users },
  { id: "roles", label: "Roles & Permissions", icon: KeyRound },
];

const COMPANY_SECTIONS: SectionId[] = ["company", "documents", "appearance"];

export function SettingsView() {
  const can = useCan();
  const canViewUsers = can("users.view");
  const canViewRoles = can("roles.view");
  const canViewCompany = can("company.view");
  const canEditCompany = can("company.edit");
  const canBranding = can("company.branding");
  // Hide tabs the user can't access.
  const sections = SECTIONS.filter((s) =>
    COMPANY_SECTIONS.includes(s.id)
      ? canViewCompany
      : s.id === "users"
        ? canViewUsers
        : s.id === "roles"
          ? canViewRoles
          : true,
  );
  const [active, setActive] = React.useState<SectionId>(canViewCompany ? "company" : "profile");

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Company branding, your profile, and workspace preferences." />

      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        {/* Section nav */}
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Settings sections">
          {sections.map((s) => {
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
                    ? "bg-primary-subtle text-primary-emphasis"
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
          {/* `isOwner` prop == "can edit this section" — company.edit for the
              profile, company.branding for logos/colours/documents. */}
          {active === "company" && canViewCompany && <CompanySection isOwner={canEditCompany} />}
          {active === "profile" && <ProfileSection />}
          {active === "documents" && canViewCompany && <DocumentsSection isOwner={canBranding} />}
          {active === "appearance" && canViewCompany && <AppearanceSection isOwner={canBranding} />}
          {active === "workspace" && (
            <div className="space-y-6">
              <SettingsPreferences />
              <MaterialCategoriesCard />
            </div>
          )}
          {active === "users" && canViewUsers && <TeamSection />}
          {active === "roles" && canViewRoles && <RolesManager />}
        </div>
      </div>
    </div>
  );
}

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
import { useIsHydrated } from "@/lib/use-is-hydrated";
import { SettingsPreferences } from "./settings-form";

type SectionId = "company" | "profile" | "documents" | "appearance" | "workspace" | "users" | "roles";

interface Section {
  id: SectionId;
  label: string;
  icon: typeof Building2;
  /** What this section is FOR, so the nav is scannable without opening each one. */
  hint: string;
}

/**
 * Grouped, because Company, People and Preferences answer different questions.
 * Users and Roles sat in a flat list beside Appearance and Documents, which made
 * access control look like another styling choice.
 */
const SECTION_GROUPS: { label: string; sections: Section[] }[] = [
  {
    label: "Company",
    sections: [
      { id: "company", label: "Company", icon: Building2, hint: "Legal and tax identity" },
      { id: "documents", label: "Documents", icon: FileText, hint: "Stamp and signature" },
      { id: "appearance", label: "Appearance", icon: Palette, hint: "Logo and brand colours" },
    ],
  },
  {
    label: "People & access",
    sections: [
      { id: "users", label: "Users", icon: Users, hint: "Who can sign in" },
      { id: "roles", label: "Roles & permissions", icon: KeyRound, hint: "What each role may do" },
    ],
  },
  {
    label: "You",
    sections: [
      { id: "profile", label: "My profile", icon: User, hint: "Your name and details" },
      { id: "workspace", label: "Workspace", icon: SlidersHorizontal, hint: "Defaults and presets" },
    ],
  },
];

const SECTIONS: Section[] = SECTION_GROUPS.flatMap((g) => g.sections);
const SECTION_IDS = SECTIONS.map((s) => s.id);

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
  /**
   * The section lives in the URL, so a reload keeps your place and a colleague
   * can be sent straight to Roles.
   *
   * Read AFTER hydration, never in the initial state. The server has no
   * `window.location`, so seeding state from the query string makes the first
   * client render disagree with the server HTML and React throws the tree away
   * (#418). Deriving it during render behind `useIsHydrated` keeps both renders
   * identical and applies the deep link on the very next one.
   */
  const hydrated = useIsHydrated();
  const [chosen, setChosen] = React.useState<SectionId | null>(null);

  const fallback: SectionId = canViewCompany ? "company" : "profile";
  const fromUrl = React.useMemo(() => {
    if (!hydrated) return null;
    const wanted = new URLSearchParams(window.location.search).get("section");
    if (!wanted) return null;
    if (!(SECTION_IDS as string[]).includes(wanted)) return null;
    // A section the caller cannot see falls back rather than blanking the panel.
    if (!sections.some((s) => s.id === wanted)) return null;
    return wanted as SectionId;
  }, [hydrated, sections]);

  const active = chosen ?? fromUrl ?? fallback;

  const openSection = React.useCallback((id: SectionId) => {
    setChosen(id);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("section", id);
    window.history.replaceState(null, "", url.toString());
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Your company's identity, who can get in, and what each of them may do."
      />

      <div className="grid gap-6 lg:grid-cols-[232px_minmax(0,1fr)]">
        {/* Section nav */}
        <nav className="lg:sticky lg:top-4 lg:self-start" aria-label="Settings sections">
          <div className="flex gap-4 overflow-x-auto pb-1 lg:flex-col lg:gap-5 lg:overflow-visible lg:pb-0">
            {SECTION_GROUPS.map((group) => {
              const visible = group.sections.filter((gs) => sections.some((s) => s.id === gs.id));
              if (visible.length === 0) return null;
              return (
                <div key={group.label} className="min-w-0">
                  <h2 className="mb-1.5 hidden text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle lg:block">
                    {group.label}
                  </h2>
                  <div className="flex gap-1 lg:flex-col">
                    {visible.map((sec) => {
                      const Icon = sec.icon;
                      const isActive = active === sec.id;
                      return (
                        <button
                          key={sec.id}
                          onClick={() => openSection(sec.id)}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "flex shrink-0 items-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                            isActive
                              ? "bg-primary-subtle text-primary-emphasis"
                              : "text-foreground-muted hover:bg-surface-muted hover:text-foreground",
                          )}
                        >
                          <Icon className="mt-0.5 size-4 shrink-0" />
                          <span className="min-w-0">
                            <span className="block whitespace-nowrap lg:whitespace-normal">
                              {sec.label}
                            </span>
                            <span
                              // No opacity modifier on the active hint. `/70`
                              // took compliant token text to 3.29:1 against
                              // `bg-primary-subtle` — subordination comes from
                              // size and weight, never from fading the ink.
                              className={cn(
                                "mt-0.5 hidden text-xs font-normal lg:block",
                                isActive ? "text-primary-emphasis" : "text-foreground-subtle",
                              )}
                            >
                              {sec.hint}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
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

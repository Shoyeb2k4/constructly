import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDemoMode } from "@/lib/env";
import { gatherServerDashboard } from "@/features/dashboard/server/gather";
import { assembleDashboard } from "@/features/dashboard/assemble";
import { DashboardView } from "@/features/dashboard/components/dashboard-view";
import { getLayoutBranding } from "@/features/branding/server/layout-branding";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const firstName = user?.fullName.split(" ")[0] ?? "there";
  // Fetch the snapshot on the server so the client renders with data already
  // present — no post-hydration fetch wave. Demo mode fetches client-side.
  const initialData =
    isDemoMode || !user ? undefined : assembleDashboard(await gatherServerDashboard());
  const branding = await getLayoutBranding();
  return (
    <DashboardView
      userId={user?.id ?? ""}
      isOwner={user?.role === "OWNER"}
      greeting={greeting()}
      firstName={firstName}
      companyName={branding.name}
      logoUrl={branding.logoUrl}
      initialData={initialData}
    />
  );
}

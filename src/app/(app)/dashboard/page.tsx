import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DashboardView } from "@/features/dashboard/components/dashboard-view";

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
  return (
    <DashboardView
      userId={user?.id ?? ""}
      isOwner={user?.role === "OWNER"}
      greeting={greeting()}
      firstName={firstName}
    />
  );
}

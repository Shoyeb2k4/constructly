import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { LaborSummaryView } from "@/features/labor/components/labor-summary-view";

export const metadata: Metadata = { title: "Labor summary" };

export default async function LaborSummaryPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, "attendance.view")) redirect("/dashboard");
  return <LaborSummaryView />;
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { canViewReport } from "@/features/reports/report-meta";
import { ReportView } from "@/features/reports/components/report-view";

export const metadata: Metadata = { title: "Report" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  // Server-first: viewing a report requires reports.view + its class permission
  // (financial reports need reports.view_financial), or reports.view_all.
  if (!user || !canViewReport((p) => hasPermission(user, p), id)) redirect("/reports");

  return (
    <ReportView
      id={id}
      userId={user.id}
      isOwner={user.role === "OWNER"}
      // The caller's own grants, passed down so a report can ask its SOURCE
      // module what this user may see rather than Reports inventing a rule.
      permissions={user.permissions ?? []}
      // Pinned here so "this month" cannot resolve differently on the server
      // than in the browser (React #418, and a mislabelled total besides).
      today={new Date().toISOString().slice(0, 10)}
      companyName={user.company.name}
    />
  );
}

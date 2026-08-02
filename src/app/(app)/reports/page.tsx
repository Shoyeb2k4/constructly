import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { ReportHub } from "@/features/reports/components/report-hub";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, "reports.view")) redirect("/dashboard");
  return (
    <div className="space-y-8">
      <PageHeader
        title="Reports"
        description="Project, labour, procurement, vendor, and financial reports — exact to every module, exportable to PDF and Excel."
      />
      <ReportHub />
    </div>
  );
}

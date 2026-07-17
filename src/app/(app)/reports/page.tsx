import type { Metadata } from "next";
import { PageHeader } from "@/components/patterns/page-header";
import { ReportHub } from "@/features/reports/components/report-hub";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
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

import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Reports"
        description="Project, labor, procurement, and financial reports — exportable to PDF and Excel."
      />
      <EmptyState
        icon={BarChart3}
        title="Reports arrive with your data"
        description="Once projects, labor, and purchase orders are in, generate budget-vs-actual, labor cost, and deadline reports here."
      />
    </div>
  );
}

import type { Metadata } from "next";
import { ReportView } from "@/features/reports/components/report-view";

export const metadata: Metadata = { title: "Report" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportView id={id} />;
}

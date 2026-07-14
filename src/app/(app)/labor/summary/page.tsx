import type { Metadata } from "next";
import { LaborSummaryView } from "@/features/labor/components/labor-summary-view";

export const metadata: Metadata = { title: "Labor summary" };

export default function LaborSummaryPage() {
  return <LaborSummaryView />;
}

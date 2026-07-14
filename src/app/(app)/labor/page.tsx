import type { Metadata } from "next";
import { HardHat } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { ComingSoonButton } from "@/components/patterns/coming-soon-button";

export const metadata: Metadata = { title: "Labor" };

export default function LaborPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Labor"
        description="Workers, contractors, and daily attendance — even offline on site."
        actions={<ComingSoonButton label="Add worker" module="Labor" />}
      />
      <EmptyState
        icon={HardHat}
        title="No workers on the roster"
        description="Add laborers and record attendance from the field. Wages and project-wise labor cost calculate automatically."
        action={<ComingSoonButton label="Add your first worker" module="Labor" />}
      />
    </div>
  );
}

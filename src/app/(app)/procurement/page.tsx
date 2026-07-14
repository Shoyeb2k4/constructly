import type { Metadata } from "next";
import { ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { ComingSoonButton } from "@/components/patterns/coming-soon-button";

export const metadata: Metadata = { title: "Procurement" };

export default function ProcurementPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Procurement"
        description="Purchase orders, materials, and budget tracking."
        actions={<ComingSoonButton label="New purchase order" module="Procurement" />}
      />
      <EmptyState
        icon={ShoppingCart}
        title="No purchase orders yet"
        description="Raise purchase orders against projects and vendors. Budget used and remaining update live, with a soft warning on overruns."
        action={<ComingSoonButton label="Create a purchase order" module="Procurement" />}
      />
    </div>
  );
}

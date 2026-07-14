import type { Metadata } from "next";
import { Truck } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { ComingSoonButton } from "@/components/patterns/coming-soon-button";

export const metadata: Metadata = { title: "Vendors" };

export default function VendorsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Vendors"
        description="Your supplier directory and purchase history."
        actions={<ComingSoonButton label="Add vendor" module="Vendors" />}
      />
      <EmptyState
        icon={Truck}
        title="No vendors yet"
        description="Add the suppliers you buy from. Track materials supplied, payment terms, and every purchase order in one profile."
        action={<ComingSoonButton label="Add your first vendor" module="Vendors" />}
      />
    </div>
  );
}

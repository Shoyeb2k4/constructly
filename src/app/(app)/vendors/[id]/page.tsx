import type { Metadata } from "next";
import { VendorDetailView } from "@/features/procurement/components/vendor-detail-view";

export const metadata: Metadata = { title: "Vendor" };

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VendorDetailView id={id} />;
}

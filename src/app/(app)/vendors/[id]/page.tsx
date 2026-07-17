import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { VendorDetailView } from "@/features/procurement/components/vendor-detail-view";

export const metadata: Metadata = { title: "Vendor" };

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  return <VendorDetailView id={id} isOwner={user?.role === "OWNER"} />;
}

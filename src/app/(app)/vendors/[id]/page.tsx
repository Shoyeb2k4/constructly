import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { VendorDetailView } from "@/features/procurement/components/vendor-detail-view";

export const metadata: Metadata = { title: "Vendor" };

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!hasPermission(user, "vendors.view")) redirect("/dashboard");
  return <VendorDetailView id={id} />;
}

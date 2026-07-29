import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { VendorsView } from "@/features/procurement/components/vendors-view";

export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, "vendors.view")) redirect("/dashboard");
  return <VendorsView />;
}

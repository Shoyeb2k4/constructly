import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { ProcurementView } from "@/features/procurement/components/procurement-view";

export const metadata: Metadata = { title: "Procurement" };

export default async function ProcurementPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, "purchase_orders.view")) redirect("/dashboard");
  return <ProcurementView />;
}

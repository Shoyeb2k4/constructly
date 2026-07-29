import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { PODetailView } from "@/features/procurement/components/po-detail-view";

export const metadata: Metadata = { title: "Purchase order" };

export default async function POPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!hasPermission(user, "purchase_orders.view")) redirect("/dashboard");
  return <PODetailView id={id} />;
}

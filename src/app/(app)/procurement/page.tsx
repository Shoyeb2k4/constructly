import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ProcurementView } from "@/features/procurement/components/procurement-view";

export const metadata: Metadata = { title: "Procurement" };

export default async function ProcurementPage() {
  const user = await getCurrentUser();
  return <ProcurementView isOwner={user?.role === "OWNER"} />;
}

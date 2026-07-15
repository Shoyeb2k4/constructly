import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { VendorsView } from "@/features/procurement/components/vendors-view";

export const metadata: Metadata = { title: "Vendors" };

export default async function VendorsPage() {
  const user = await getCurrentUser();
  return <VendorsView isOwner={user?.role === "OWNER"} />;
}

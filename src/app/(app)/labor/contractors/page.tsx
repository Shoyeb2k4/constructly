import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ContractorsView } from "@/features/contractors/components/contractors-view";

export const metadata: Metadata = { title: "Contractors" };

export default async function ContractorsPage() {
  const user = await getCurrentUser();
  return <ContractorsView isOwner={user?.role === "OWNER"} />;
}

import type { Metadata } from "next";
import { ContractorsView } from "@/features/contractors/components/contractors-view";

export const metadata: Metadata = { title: "Contractors" };

export default function ContractorsPage() {
  // No role is passed: the view gates its actions on the RBAC permission each
  // server action demands.
  return <ContractorsView />;
}

import type { Metadata } from "next";
import { ContractorsView } from "@/features/labor/components/contractors-view";

export const metadata: Metadata = { title: "Contractors" };

export default function ContractorsPage() {
  return <ContractorsView />;
}

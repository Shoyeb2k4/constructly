import type { Metadata } from "next";
import { ContractorDetailView } from "@/features/contractors/components/contractor-detail-view";

export const metadata: Metadata = { title: "Contractor" };

export default async function ContractorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // No role is passed: every affordance inside is gated on the RBAC permission
  // its server action demands, not on being the Owner.
  return <ContractorDetailView contractorId={id} />;
}

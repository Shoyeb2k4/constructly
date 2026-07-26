import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ContractorDetailView } from "@/features/contractors/components/contractor-detail-view";

export const metadata: Metadata = { title: "Contractor" };

export default async function ContractorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  return <ContractorDetailView contractorId={id} isOwner={user?.role === "OWNER"} />;
}

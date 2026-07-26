import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PODetailView } from "@/features/procurement/components/po-detail-view";

export const metadata: Metadata = { title: "Purchase order" };

export default async function POPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  return <PODetailView id={id} isOwner={user?.role === "OWNER"} currentUserId={user?.id ?? null} />;
}

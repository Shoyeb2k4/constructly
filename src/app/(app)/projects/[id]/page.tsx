import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ProjectDetailView } from "@/features/projects/components/detail/project-detail-view";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  return (
    <ProjectDetailView
      id={id}
      isOwner={user?.role === "OWNER"}
      userId={user?.id ?? ""}
    />
  );
}

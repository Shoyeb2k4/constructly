import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { ProjectDetailView } from "@/features/projects/components/detail/project-detail-view";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!hasPermission(user, "projects.view")) redirect("/dashboard");
  return <ProjectDetailView id={id} userId={user?.id ?? ""} />;
}

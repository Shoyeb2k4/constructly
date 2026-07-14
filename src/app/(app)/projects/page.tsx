import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ProjectsView } from "@/features/projects/components/projects-view";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  return <ProjectsView isOwner={user?.role === "OWNER"} />;
}

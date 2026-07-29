import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { ProjectsView } from "@/features/projects/components/projects-view";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  // Server-side page guard: no projects.view ⇒ no access to the module.
  if (!hasPermission(user, "projects.view")) redirect("/dashboard");
  return <ProjectsView />;
}

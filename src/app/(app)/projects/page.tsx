import type { Metadata } from "next";
import { FolderKanban } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { ComingSoonButton } from "@/components/patterns/coming-soon-button";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Projects"
        description="Every site, from estimation to handover."
        actions={<ComingSoonButton label="New project" module="Projects" />}
      />
      <EmptyState
        icon={FolderKanban}
        title="No projects yet"
        description="Create your first project to track budget, deadlines, labor, and procurement in one place."
        action={<ComingSoonButton label="Create your first project" module="Projects" />}
      />
    </div>
  );
}

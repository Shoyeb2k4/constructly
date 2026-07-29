"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/patterns/empty-state";
import { FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectListItem } from "../../types";
import { useProject, useToggleFavorite, useProjectDetailActions } from "../../hooks";
import { pushRecent } from "../../recently-viewed";
import { ProjectActionsMenu } from "../project-actions-menu";
import { useCan } from "@/features/rbac/permission-context";
import { StageStepper } from "./stage-stepper";
import { OverviewTab } from "./overview-tab";
import { DeadlinesTab } from "./deadlines-tab";
import { DocumentsTab } from "./documents-tab";
import { NotesTab } from "./notes-tab";
import { ActivityTab } from "./activity-tab";
import { ProjectProcurementTab } from "@/features/procurement/components/project-procurement-tab";
import { ProjectLabourTab } from "@/features/labor/components/project-labour-tab";

export function ProjectDetailView({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  const can = useCan();
  const { data: project, isLoading } = useProject(id);
  const favorite = useToggleFavorite();
  const { changeStage } = useProjectDetailActions(id);
  const searchParams = useSearchParams();
  const initialTab = (() => {
    const t = searchParams.get("tab");
    const valid = ["overview", "procurement", "labour", "deadlines", "documents", "notes", "activity"];
    return t && valid.includes(t) ? t : "overview";
  })();
  const [tab, setTab] = React.useState(initialTab);

  React.useEffect(() => {
    if (project) pushRecent({ id: project.id, name: project.name, code: project.code });
  }, [project]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-9 w-full" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 rounded-xl lg:col-span-2" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <EmptyState
        icon={FolderKanban}
        title="Project not found"
        description="It may have been deleted, or you don't have access."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/projects">Back to projects</Link>
          </Button>
        }
      />
    );
  }

  // Permission (projects.edit) AND ownership: broad edit_all edits any project,
  // otherwise only the assigned PM's own project. Server enforces the same.
  const canEdit =
    can("projects.edit") && (can("projects.edit_all") || project.pm?.id === userId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <nav className="flex items-center gap-1 text-sm text-foreground-subtle">
              <Link href="/projects" className="hover:text-foreground">Projects</Link>
              <ChevronRight className="size-3.5" />
              <span className="font-mono text-xs">{project.code}</span>
            </nav>
            <div className="mt-1 flex items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
              <button
                onClick={() => favorite.mutate(project.id)}
                aria-label={project.isFavorite ? "Unpin" : "Pin"}
                className="text-foreground-subtle transition-colors hover:text-warning"
              >
                <Star className={cn("size-5", project.isFavorite && "fill-warning text-warning")} />
              </button>
            </div>
          </div>
          <ProjectActionsMenu project={project as ProjectListItem} />
        </div>

        <StageStepper
          current={project.stage}
          onChange={(stage) => changeStage.mutate(stage)}
          disabled={!canEdit}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="procurement">Procurement</TabsTrigger>
          <TabsTrigger value="labour">Labour</TabsTrigger>
          <TabsTrigger value="deadlines">
            Deadlines{project.deadlines.length ? ` (${project.deadlines.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="documents">
            Documents{project.documents.length ? ` (${project.documents.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="notes">
            Notes{project.notes.length ? ` (${project.notes.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab project={project} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="procurement">
          <ProjectProcurementTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="labour">
          <ProjectLabourTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="deadlines">
          <DeadlinesTab project={project} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsTab project={project} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab project={project} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab project={project} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

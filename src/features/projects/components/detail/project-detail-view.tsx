"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarCheck, ChevronRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { RecordNav, type RecordNavGroup } from "@/components/patterns/record-nav";
import { StatusBadge, PROJECT_STAGE_META } from "@/components/patterns/status-badge";
import { FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectListItem } from "../../types";
import { useProject, useToggleFavorite, useProjectDetailActions } from "../../hooks";
import { pushRecent } from "../../recently-viewed";
import { deadlineCountdown } from "../../format";
import { ProjectActionsMenu } from "../project-actions-menu";
import { useCan } from "@/features/rbac/permission-context";
import { StageStepper } from "./stage-stepper";
import { ContractorsTab } from "./contractors-tab";
import { ContractorsEditSheet } from "./contractors-edit-sheet";
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
  const [editContractors, setEditContractors] = React.useState(false);

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

  // Grouped by the question each section answers, the same philosophy the
  // contractor record uses: who does the work, what is being bought, what is
  // recorded about it.
  const navGroups: RecordNavGroup[] = [
    { label: "Summary", items: [{ value: "overview", label: "Overview" }] },
    {
      label: "Workforce",
      items: [
        { value: "contractors", label: "Contractors" },
        { value: "labour", label: "Labour" },
      ],
    },
    {
      label: "Operations",
      items: [
        { value: "procurement", label: "Procurement" },
        {
          value: "deadlines",
          label: `Deadlines${project.deadlines.length ? ` (${project.deadlines.length})` : ""}`,
        },
        {
          value: "documents",
          label: `Documents${project.documents.length ? ` (${project.documents.length})` : ""}`,
        },
      ],
    },
    {
      label: "Record",
      items: [
        {
          value: "notes",
          label: `Notes${project.notes.length ? ` (${project.notes.length})` : ""}`,
        },
        { value: "activity", label: "Activity" },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm">
        <ol className="flex items-center gap-1 text-foreground-muted">
          <li>
            <Link href="/projects" className="rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Projects
            </Link>
          </li>
          <ChevronRight className="size-3.5 text-foreground-subtle" aria-hidden="true" />
          <li className="font-mono text-xs">{project.code}</li>
        </ol>
      </nav>

      {/* A working record, not a hero: name, where it is in its lifecycle, who
          owns it, and the one action most likely to be next. */}
      <PageHeader
        title={
          <>
            <span>{project.name}</span>
            <StatusBadge meta={PROJECT_STAGE_META} value={project.stage} />
          </>
        }
        meta={
          <>
            <span>{project.pm ? project.pm.fullName : "No manager assigned"}</span>
            {project.expectedCompletionDate && (
              <>
                <span aria-hidden="true">·</span>
                <span>{deadlineCountdown(project.expectedCompletionDate).label}</span>
              </>
            )}
            {project.clientName && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{project.clientName}</span>
              </>
            )}
          </>
        }
        actions={
          <>
            <Button asChild variant="primary">
              <Link href={`/labor?project=${project.id}`}>
                <CalendarCheck />
                Record attendance
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => favorite.mutate(project.id)}
              aria-label={project.isFavorite ? `Unpin ${project.name}` : `Pin ${project.name}`}
              aria-pressed={project.isFavorite}
            >
              <Star className={cn("size-4", project.isFavorite && "fill-warning text-warning")} />
            </Button>
            <ProjectActionsMenu project={project as ProjectListItem} />
          </>
        }
      />

      {/* Nine stages do not fit any viewport in a row, so the stepper owns its
          own scroller instead of clipping — "Closed" used to be cut off at
          1280px with no affordance to reach it. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <StageStepper
          current={project.stage}
          onChange={(stage) => changeStage.mutate(stage)}
          disabled={!canEdit}
        />
      </div>

      <Tabs
        value={tab}
        onValueChange={setTab}
        orientation="vertical"
        className="lg:flex lg:items-start lg:gap-8"
      >
        <RecordNav
          groups={navGroups}
          value={tab}
          onValueChange={setTab}
          label="Project sections"
          className="lg:sticky lg:top-20"
        />
        <div className="min-w-0 flex-1">
        <TabsContent value="contractors">
          <ContractorsTab
            project={project}
            canEdit={canEdit}
            onEdit={() => setEditContractors(true)}
          />
        </TabsContent>
        <TabsContent value="overview">
          <OverviewTab project={project} canEdit={canEdit} onOpenSection={setTab} />
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
        </div>
      </Tabs>

      <ContractorsEditSheet
        projectId={project.id}
        projectName={project.name}
        initial={project.contractors}
        open={editContractors}
        onOpenChange={setEditContractors}
      />
    </div>
  );
}

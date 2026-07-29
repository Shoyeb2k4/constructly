"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  MoreHorizontal,
  Star,
  StarOff,
  Copy,
  Archive,
  ArchiveRestore,
  RotateCcw,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectListItem } from "../types";
import { useProjectActions, useToggleFavorite } from "../hooks";
import { useCan } from "@/features/rbac/permission-context";
import { ProjectDeleteDialog } from "./project-delete-dialog";

export function ProjectActionsMenu({ project }: { project: ProjectListItem }) {
  const router = useRouter();
  const can = useCan();
  const favorite = useToggleFavorite();
  const { duplicate, setArchived, restore } = useProjectActions();
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const canDuplicate = can("projects.create");
  const canArchive = can("projects.archive");
  const canDelete = can("projects.delete");
  const showManage = canDuplicate || canArchive || canDelete;

  // A soft-deleted project (recycle bin) only offers Restore (delete authority).
  if (project.deletedAt) {
    if (!canDelete) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-foreground-subtle"
            aria-label="Project actions"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => restore.mutate(project.id)}>
            <RotateCcw />
            Restore project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-foreground-subtle"
            aria-label="Project actions"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuItem onSelect={() => router.push(`/projects/${project.id}`)}>
            <ExternalLink />
            Open
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => favorite.mutate(project.id)}>
            {project.isFavorite ? <StarOff /> : <Star />}
            {project.isFavorite ? "Unpin" : "Pin to favorites"}
          </DropdownMenuItem>
          {showManage && <DropdownMenuSeparator />}
          {canDuplicate && (
            <DropdownMenuItem onSelect={() => duplicate.mutate(project.id)}>
              <Copy />
              Duplicate
            </DropdownMenuItem>
          )}
          {canArchive && (
            <DropdownMenuItem
              onSelect={() =>
                setArchived.mutate({
                  id: project.id,
                  archived: !project.archivedAt,
                })
              }
            >
              {project.archivedAt ? <ArchiveRestore /> : <Archive />}
              {project.archivedAt ? "Restore" : "Archive"}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setConfirmDelete(true)}
                className="text-danger-foreground [&_svg]:text-danger-foreground focus:bg-danger-subtle"
              >
                <Trash2 />
                Delete permanently
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ProjectDeleteDialog
        project={project}
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
      />
    </>
  );
}

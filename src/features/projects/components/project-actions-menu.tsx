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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProjectListItem } from "../types";
import { useProjectActions, useToggleFavorite } from "../hooks";

export function ProjectActionsMenu({
  project,
  canManage,
}: {
  project: ProjectListItem;
  canManage: boolean;
}) {
  const router = useRouter();
  const favorite = useToggleFavorite();
  const { duplicate, setArchived, remove } = useProjectActions();
  const [confirmDelete, setConfirmDelete] = React.useState(false);

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
          {canManage && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => duplicate.mutate(project.id)}>
                <Copy />
                Duplicate
              </DropdownMenuItem>
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
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setConfirmDelete(true)}
                className="text-danger-foreground [&_svg]:text-danger-foreground focus:bg-danger-subtle"
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {project.name}?</DialogTitle>
            <DialogDescription>
              This removes the project and its data from your lists. Consider
              archiving instead if you may need it later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                remove.mutate(project.id, {
                  onSuccess: () => setConfirmDelete(false),
                })
              }
            >
              Delete project
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

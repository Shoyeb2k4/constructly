"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Star } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MoneyText } from "@/components/patterns/money-text";
import {
  StatusBadge,
  PROJECT_STAGE_META,
} from "@/components/patterns/status-badge";
import { cn } from "@/lib/utils";
import type { ProjectListItem } from "../types";
import { deadlineCountdown } from "../format";
import { useToggleFavorite } from "../hooks";
import { BudgetMeter } from "./budget-meter";
import { TagChip } from "./tag-chip";
import { ProjectActionsMenu } from "./project-actions-menu";

const GRID =
  "grid grid-cols-[1.8fr_130px_44px] md:grid-cols-[1.8fr_150px_1.2fr_110px_44px_40px] items-center gap-3 px-4";

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function Row({
  project,
  canManage,
  onOpen,
}: {
  project: ProjectListItem;
  canManage: boolean;
  onOpen: (id: string) => void;
}) {
  const favorite = useToggleFavorite();
  const cd = deadlineCountdown(project.expectedCompletionDate);

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => onOpen(project.id)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(project.id)}
      className={cn(
        GRID,
        "h-14 cursor-pointer border-b border-border outline-none transition-colors last:border-0 hover:bg-surface-muted/50 focus-visible:bg-surface-muted/50",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            favorite.mutate(project.id);
          }}
          aria-label={project.isFavorite ? "Unpin" : "Pin"}
          className="shrink-0 text-foreground-subtle transition-colors hover:text-warning"
        >
          <Star
            className={cn(
              "size-4",
              project.isFavorite && "fill-warning text-warning",
            )}
          />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{project.name}</span>
            {project.tags.slice(0, 1).map((t) => (
              <TagChip key={t} label={t} className="hidden lg:inline-flex" />
            ))}
          </div>
          <span className="font-mono text-xs text-foreground-subtle">
            {project.code}
          </span>
        </div>
      </div>

      <div>
        <StatusBadge meta={PROJECT_STAGE_META} value={project.stage} />
      </div>

      <div className="hidden md:block">
        <BudgetMeter usedPaise={project.usedPaise} budgetPaise={project.budgetPaise} />
        <div className="mt-1.5 font-mono text-xs text-foreground-muted">
          <MoneyText paise={project.usedPaise} compact /> /{" "}
          <MoneyText paise={project.budgetPaise} compact />
        </div>
      </div>

      <div className="hidden md:block">
        <span
          className={cn(
            "text-xs",
            cd.tone === "danger"
              ? "text-danger-foreground"
              : cd.tone === "warning"
                ? "text-warning-foreground"
                : "text-foreground-muted",
          )}
        >
          {cd.label}
        </span>
      </div>

      <div className="hidden md:flex md:justify-center">
        {project.pm ? (
          <Avatar className="size-7" title={project.pm.fullName}>
            <AvatarFallback className="text-[10px]">
              {initials(project.pm.fullName)}
            </AvatarFallback>
          </Avatar>
        ) : (
          <span className="text-xs text-foreground-subtle">—</span>
        )}
      </div>

      <div className="flex justify-end">
        <ProjectActionsMenu project={project} canManage={canManage} />
      </div>
    </div>
  );
}

export function ProjectsTable({
  projects,
  canManage,
}: {
  projects: ProjectListItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const parentRef = React.useRef<HTMLDivElement>(null);
  const onOpen = (id: string) => router.push(`/projects/${id}`);

  // TanStack Virtual returns non-memoizable functions; React Compiler skips it
  // safely here (the virtualizer manages its own state).
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: projects.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div
        className={cn(
          GRID,
          "h-10 border-b border-border bg-surface-muted/40 text-xs font-medium text-foreground-subtle",
        )}
      >
        <span>Project</span>
        <span>Stage</span>
        <span className="hidden md:block">Budget used</span>
        <span className="hidden md:block">Deadline</span>
        <span className="hidden md:block text-center">PM</span>
        <span className="hidden md:block" />
      </div>

      <div
        ref={parentRef}
        className="max-h-[calc(100vh-320px)] min-h-0 overflow-y-auto"
      >
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((v) => (
            <div
              key={projects[v.index].id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${v.start}px)`,
              }}
            >
              <Row
                project={projects[v.index]}
                canManage={canManage}
                onOpen={onOpen}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

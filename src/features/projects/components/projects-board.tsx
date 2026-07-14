"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Star, GripVertical } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MoneyText } from "@/components/patterns/money-text";
import { cn } from "@/lib/utils";
import type { ProjectListItem, ProjectStage } from "../types";
import { STAGE_ORDER, STAGE_LABEL } from "../constants";
import { deadlineCountdown } from "../format";
import { useChangeStage, useToggleFavorite } from "../hooks";
import { BudgetMeter } from "./budget-meter";
import { TagChip } from "./tag-chip";

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function CardBody({ project }: { project: ProjectListItem }) {
  const favorite = useToggleFavorite();
  const cd = deadlineCountdown(project.expectedCompletionDate);
  return (
    <div className="rounded-lg border border-border bg-surface p-3 shadow-[0_1px_2px_rgba(16,18,29,0.04)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{project.name}</p>
          <p className="font-mono text-[11px] text-foreground-subtle">
            {project.code}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            favorite.mutate(project.id);
          }}
          aria-label="Pin"
          className="shrink-0 text-foreground-subtle hover:text-warning"
        >
          <Star className={cn("size-3.5", project.isFavorite && "fill-warning text-warning")} />
        </button>
      </div>

      {project.budgetPaise > 0 && (
        <div className="mt-3">
          <BudgetMeter usedPaise={project.usedPaise} budgetPaise={project.budgetPaise} />
          <p className="mt-1 font-mono text-[11px] text-foreground-muted">
            <MoneyText paise={project.usedPaise} compact /> /{" "}
            <MoneyText paise={project.budgetPaise} compact />
          </p>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span
          className={cn(
            "text-[11px]",
            cd.tone === "danger"
              ? "text-danger-foreground"
              : cd.tone === "warning"
                ? "text-warning-foreground"
                : "text-foreground-subtle",
          )}
        >
          {cd.label}
        </span>
        <div className="flex items-center gap-1.5">
          {project.tags.slice(0, 1).map((t) => (
            <TagChip key={t} label={t} />
          ))}
          {project.pm && (
            <Avatar className="size-6">
              <AvatarFallback className="text-[9px]">
                {initials(project.pm.fullName)}
              </AvatarFallback>
            </Avatar>
          )}
        </div>
      </div>
    </div>
  );
}

function DraggableCard({
  project,
  canManage,
  onOpen,
}: {
  project: ProjectListItem;
  canManage: boolean;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: project.id,
    data: { stage: project.stage },
    disabled: !canManage,
  });

  return (
    <div
      ref={setNodeRef}
      onClick={() => onOpen(project.id)}
      className={cn(
        "group relative cursor-pointer",
        isDragging && "opacity-40",
      )}
    >
      {canManage && (
        <span
          {...listeners}
          {...attributes}
          onClick={(e) => e.stopPropagation()}
          className="absolute -left-1 top-1/2 z-10 -translate-y-1/2 cursor-grab rounded p-0.5 text-foreground-subtle opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100"
          aria-label="Drag to change stage"
        >
          <GripVertical className="size-4" />
        </span>
      )}
      <CardBody project={project} />
    </div>
  );
}

function Column({
  stage,
  projects,
  canManage,
  onOpen,
}: {
  stage: ProjectStage;
  projects: ProjectListItem[];
  canManage: boolean;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-sm font-medium">{STAGE_LABEL[stage]}</span>
        <span className="rounded-full bg-surface-muted px-1.5 text-xs text-foreground-subtle">
          {projects.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-1 flex-col gap-2 rounded-xl border border-dashed p-2 transition-colors",
          isOver ? "border-primary bg-info-subtle/40" : "border-border bg-surface-muted/30",
        )}
      >
        {projects.map((p) => (
          <DraggableCard key={p.id} project={p} canManage={canManage} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

export function ProjectsBoard({
  projects,
  canManage,
}: {
  projects: ProjectListItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const changeStage = useChangeStage();
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const byStage = React.useMemo(() => {
    const map = new Map<ProjectStage, ProjectListItem[]>();
    STAGE_ORDER.forEach((s) => map.set(s, []));
    projects.forEach((p) => map.get(p.stage)?.push(p));
    return map;
  }, [projects]);

  const active = projects.find((p) => p.id === activeId) ?? null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const overStage = e.over?.id as ProjectStage | undefined;
    const fromStage = e.active.data.current?.stage as ProjectStage | undefined;
    if (overStage && fromStage && overStage !== fromStage) {
      changeStage.mutate({ id: String(e.active.id), stage: overStage });
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGE_ORDER.map((stage) => (
          <Column
            key={stage}
            stage={stage}
            projects={byStage.get(stage) ?? []}
            canManage={canManage}
            onOpen={(id) => router.push(`/projects/${id}`)}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="w-72 rotate-2 opacity-95">
            <CardBody project={active} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import {
  FolderKanban,
  LayoutGrid,
  Table as TableIcon,
  Search,
  Star,
  Plus,
  Clock,
  Trash2,
  SlidersHorizontal,
  Archive,
} from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { Toolbar, ToolbarGroup, ToolbarSpacer } from "@/components/patterns/toolbar";
import { Field } from "@/components/patterns/field";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { ErrorState } from "@/components/patterns/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ProjectFilters, ProjectStage, ProjectType, ProjectSort } from "../types";
import type { DeadlineFilter } from "../deadline";
import { STAGE_ORDER, STAGE_LABEL, PROJECT_TYPES, TYPE_LABEL } from "../constants";

const DEADLINE_LABEL: Record<DeadlineFilter, string> = {
  ALL: "Any deadline",
  OVERDUE: "Overdue",
  TODAY: "Due today",
  WEEK: "Due this week",
  MONTH: "Due this month",
};
const DEADLINE_OPTIONS: DeadlineFilter[] = ["ALL", "OVERDUE", "TODAY", "WEEK", "MONTH"];
import { useProjects, useManagers, useProjectRetention, useSetProjectRetention } from "../hooks";
import { RETENTION_OPTIONS } from "../retention";
import { useCan } from "@/features/rbac/permission-context";
import { useRecentProjects } from "../recently-viewed";
import { ProjectsTable } from "./projects-table";
import { ProjectsBoard } from "./projects-board";
import { CreateProjectSheet } from "./create-project-sheet";

type View = "table" | "board";

/** Recycle-bin header: explains soft delete + lets the Owner set the retention
 *  policy that governs when a deleted project becomes eligible for admin-only
 *  permanent cleanup. Nothing is ever auto-deleted. */
function DeletedBanner() {
  const { data: retention } = useProjectRetention();
  const setRetention = useSetProjectRetention();
  const value = retention == null ? "never" : String(retention);

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-danger/40 bg-danger-subtle px-3.5 py-2.5 text-sm text-danger-foreground sm:flex-row sm:items-center sm:justify-between">
      <p className="leading-relaxed">
        Showing deleted projects. Their data is preserved and hidden from the
        team — use the <span className="font-medium">⋮</span> menu to restore.
        Permanent deletion is an admin-only cleanup operation.
      </p>
      <label className="flex shrink-0 items-center gap-2 whitespace-nowrap">
        <span className="text-xs font-medium">Retention</span>
        <Select
          value={value}
          onValueChange={(v) => setRetention.mutate(v === "never" ? null : Number(v))}
        >
          <SelectTrigger className="h-8 w-40 bg-surface" aria-label="Deleted project retention period"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RETENTION_OPTIONS.map((o) => (
              <SelectItem key={o.label} value={o.days == null ? "never" : String(o.days)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}

function SegToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-surface-muted p-0.5">
      {(["table", "board"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          // The visible label is `hidden sm:inline`, so below `sm` these are
          // icon-only and would ship with no accessible name at all. `pressed`
          // also states which view is active without relying on the fill.
          aria-label={v === "table" ? "Table view" : "Board view"}
          aria-pressed={view === v}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
            view === v
              ? "bg-surface text-foreground shadow-sm"
              : "text-foreground-muted hover:text-foreground",
          )}
        >
          {v === "table" ? <TableIcon className="size-4" /> : <LayoutGrid className="size-4" />}
          <span className="hidden sm:inline">{v === "table" ? "Table" : "Board"}</span>
        </button>
      ))}
    </div>
  );
}

export function ProjectsView() {
  const can = useCan();
  const canCreate = can("projects.create");
  const canEdit = can("projects.edit");
  const canSeeDeleted = can("projects.delete");
  const [view, setView] = React.useState<View>("table");
  const [search, setSearch] = React.useState("");
  const [stage, setStage] = React.useState<ProjectStage | "ALL">("ALL");
  const [type, setType] = React.useState<ProjectType | "ALL">("ALL");
  const [pmId, setPmId] = React.useState<string>("ALL");
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const [includeDeleted, setIncludeDeleted] = React.useState(false);
  const [deadline, setDeadline] = React.useState<DeadlineFilter>("ALL");
  const [sort, setSort] = React.useState<ProjectSort>("RECENT");
  const [createOpen, setCreateOpen] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  // How many of the collapsed filters are actually narrowing the list. The
  // number on the button is what stops a hidden filter silently explaining an
  // empty screen.
  const extraFilterCount =
    (type !== "ALL" ? 1 : 0) +
    (deadline !== "ALL" ? 1 : 0) +
    (sort !== "RECENT" ? 1 : 0) +
    (includeArchived ? 1 : 0) +
    (includeDeleted ? 1 : 0);

  const filters: ProjectFilters = React.useMemo(
    () => ({
      search,
      stage,
      type,
      pmId,
      favoritesOnly,
      includeArchived,
      includeDeleted: canSeeDeleted && includeDeleted,
      deadline,
      sort,
    }),
    [search, stage, type, pmId, favoritesOnly, includeArchived, includeDeleted, canSeeDeleted, deadline, sort],
  );
  const { data: projects, isLoading, isError, refetch } = useProjects(filters);
  const { data: managers = [] } = useManagers();
  const recent = useRecentProjects();

  // Power-user shortcuts: "c" new project, "/" focus search.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement)?.isContentEditable;
      if (typing) return;
      if (e.key === "c" && canCreate) {
        e.preventDefault();
        setCreateOpen(true);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [canCreate]);

  const hasFilters =
    !!search ||
    stage !== "ALL" ||
    type !== "ALL" ||
    pmId !== "ALL" ||
    favoritesOnly ||
    deadline !== "ALL";
  const isEmpty = !isLoading && projects && projects.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Every site, from estimation to handover."
        actions={
          <div className="flex items-center gap-2">
            <SegToggle view={view} onChange={setView} />
            {canCreate && (
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                <Plus />
                New project
              </Button>
            )}
          </div>
        }
      />

      {recent.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="flex shrink-0 items-center gap-1 text-xs text-foreground-subtle">
            <Clock className="size-3.5" /> Recent
          </span>
          {recent.map((r) => (
            <Link
              key={r.id}
              href={`/projects/${r.id}`}
              className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              {r.name}
            </Link>
          ))}
        </div>
      )}

      {/* Search and the two filters people reach for constantly stay visible;
          the rest live behind "More filters" with a count, so the bar is one row
          instead of seven controls and a second row of lifecycle toggles. */}
      <Toolbar aria-label="Project filters">
        <ToolbarGroup grow>
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects…  (/)"
              aria-label="Search projects"
              className="pl-9"
            />
          </div>
        </ToolbarGroup>

        <ToolbarGroup>
          <Select value={stage} onValueChange={(v) => setStage(v as ProjectStage | "ALL")}>
            <SelectTrigger className="w-40" aria-label="Filter by stage"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All stages</SelectItem>
              {STAGE_ORDER.map((s) => (
                <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={pmId} onValueChange={setPmId}>
            <SelectTrigger className="hidden w-40 sm:flex" aria-label="Filter by project manager">
              <SelectValue placeholder="Manager" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All managers</SelectItem>
              {managers.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.fullName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ToolbarGroup>

        <ToolbarSpacer />

        <ToolbarGroup>
          <Button
            variant={favoritesOnly ? "secondary" : "ghost"}
            size="icon"
            aria-pressed={favoritesOnly}
            aria-label="Show pinned projects only"
            onClick={() => setFavoritesOnly((v) => !v)}
          >
            <Star className={cn("size-4", favoritesOnly && "fill-warning text-warning")} />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant={extraFilterCount > 0 ? "secondary" : "ghost"} size="sm">
                <SlidersHorizontal className="size-4" />
                More filters
                {extraFilterCount > 0 && (
                  <Badge variant="primary" className="ml-1">{extraFilterCount}</Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 p-3">
              <div className="space-y-3">
                <Field label="Type">
                  <Select value={type} onValueChange={(v) => setType(v as ProjectType | "ALL")}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All types</SelectItem>
                      {PROJECT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Manager" className="sm:hidden">
                  <Select value={pmId} onValueChange={setPmId}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Manager" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All managers</SelectItem>
                      {managers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Deadline">
                  <Select value={deadline} onValueChange={(v) => setDeadline(v as DeadlineFilter)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DEADLINE_OPTIONS.map((d) => (
                        <SelectItem key={d} value={d}>{DEADLINE_LABEL[d]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Sort by">
                  <Select value={sort} onValueChange={(v) => setSort(v as ProjectSort)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RECENT">Recently updated</SelectItem>
                      <SelectItem value="DEADLINE">By deadline</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <DropdownMenuSeparator />
                {/* Lifecycle views, not filters — they change WHICH records are
                    in scope, so they read as toggles rather than dropdowns. */}
                <Button
                  variant={includeArchived ? "secondary" : "ghost"}
                  size="sm"
                  className="w-full justify-start"
                  disabled={includeDeleted}
                  onClick={() => setIncludeArchived((v) => !v)}
                >
                  <Archive className="size-4" />
                  {includeArchived ? "Hide archived" : "Show archived"}
                </Button>
                {canSeeDeleted && (
                  <Button
                    variant={includeDeleted ? "danger" : "ghost"}
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => setIncludeDeleted((v) => !v)}
                  >
                    <Trash2 className="size-4" />
                    {includeDeleted ? "Exit deleted" : "Deleted projects"}
                  </Button>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </ToolbarGroup>
      </Toolbar>

      {includeDeleted && <DeletedBanner />}

      {/* Content */}
      {isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : isLoading ? (
        <RowsSkeleton rows={6} />
      ) : isEmpty ? (
        hasFilters ? (
          <EmptyState
            icon={Search}
            title="No projects match"
            description="Try adjusting your search or filters."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setStage("ALL");
                  setType("ALL");
                  setPmId("ALL");
                  setFavoritesOnly(false);
                  setDeadline("ALL");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create your first project to track budget, deadlines, labor, and procurement in one place."
            action={
              canCreate ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus />
                  Create your first project
                </Button>
              ) : undefined
            }
          />
        )
      ) : view === "table" ? (
        <ProjectsTable projects={projects!} />
      ) : (
        <ProjectsBoard projects={projects!} canDrag={canEdit} />
      )}

      <CreateProjectSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

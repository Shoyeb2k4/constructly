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
} from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
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
import { useProjects, useManagers } from "../hooks";
import { useRecentProjects } from "../recently-viewed";
import { ProjectsTable } from "./projects-table";
import { ProjectsBoard } from "./projects-board";
import { CreateProjectSheet } from "./create-project-sheet";

type View = "table" | "board";

function SegToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-surface-muted p-0.5">
      {(["table", "board"] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
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

export function ProjectsView({ isOwner }: { isOwner: boolean }) {
  const [view, setView] = React.useState<View>("table");
  const [search, setSearch] = React.useState("");
  const [stage, setStage] = React.useState<ProjectStage | "ALL">("ALL");
  const [type, setType] = React.useState<ProjectType | "ALL">("ALL");
  const [pmId, setPmId] = React.useState<string>("ALL");
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const [deadline, setDeadline] = React.useState<DeadlineFilter>("ALL");
  const [sort, setSort] = React.useState<ProjectSort>("RECENT");
  const [createOpen, setCreateOpen] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);

  const filters: ProjectFilters = React.useMemo(
    () => ({ search, stage, type, pmId, favoritesOnly, includeArchived, deadline, sort }),
    [search, stage, type, pmId, favoritesOnly, includeArchived, deadline, sort],
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
      if (e.key === "c" && isOwner) {
        e.preventDefault();
        setCreateOpen(true);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOwner]);

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
            {isOwner && (
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…  (/)"
            className="pl-9"
          />
        </div>
        <Select value={stage} onValueChange={(v) => setStage(v as ProjectStage | "ALL")}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All stages</SelectItem>
            {STAGE_ORDER.map((s) => (
              <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={(v) => setType(v as ProjectType | "ALL")}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            {PROJECT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={pmId} onValueChange={setPmId}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Manager" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All managers</SelectItem>
            {managers.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.fullName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={deadline} onValueChange={(v) => setDeadline(v as DeadlineFilter)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DEADLINE_OPTIONS.map((d) => (
              <SelectItem key={d} value={d}>{DEADLINE_LABEL[d]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as ProjectSort)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="RECENT">Recently updated</SelectItem>
            <SelectItem value="DEADLINE">By deadline</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={favoritesOnly ? "secondary" : "ghost"}
          size="icon"
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((v) => !v)}
          title="Favorites only"
        >
          <Star className={cn("size-4", favoritesOnly && "fill-warning text-warning")} />
        </Button>
        <Button
          variant={includeArchived ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setIncludeArchived((v) => !v)}
        >
          {includeArchived ? "Hide archived" : "Show archived"}
        </Button>
      </div>

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
              isOwner ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <Plus />
                  Create your first project
                </Button>
              ) : undefined
            }
          />
        )
      ) : view === "table" ? (
        <ProjectsTable projects={projects!} canManage={isOwner} />
      ) : (
        <ProjectsBoard projects={projects!} canManage />
      )}

      <CreateProjectSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

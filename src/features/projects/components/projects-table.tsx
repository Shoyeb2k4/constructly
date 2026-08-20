"use client";

/**
 * The project list.
 *
 * This was a hand-built virtualised grid whose rows carried `role="row"` inside
 * a parent with no table role — ten axe violations, and worse for a screen
 * reader than plain markup. Phase 1 stripped the fake ARIA; this completes the
 * job by moving onto the shared `DataTable`, which now windows rows WITHOUT
 * giving up `<table>` semantics (spacer rows + `aria-rowcount`/`aria-rowindex`).
 *
 * Virtualisation was kept on evidence, not habit: `list()` is unbounded — there
 * is no server pagination — and at 501 projects the window rendered 18 rows and
 * 831 DOM nodes. Keeping it now costs nothing semantically, so it is worth
 * covering the tail; below 40 rows it is skipped, because an extra scroll
 * viewport for a short list is pure cost.
 */

import { Star } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { MoneyText } from "@/components/patterns/money-text";
import { DataTable } from "@/components/patterns/data-table";
import { StatusBadge, PROJECT_STAGE_META } from "@/components/patterns/status-badge";
import { cn } from "@/lib/utils";
import type { ProjectListItem } from "../types";
import { deadlineCountdown, formatDate } from "../format";
import { useToggleFavorite } from "../hooks";
import { BudgetMeter } from "./budget-meter";
import { TagChip } from "./tag-chip";
import { ProjectActionsMenu } from "./project-actions-menu";

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

/** Pin/unpin. Sits outside the row link so it never navigates. */
function FavoriteButton({ project }: { project: ProjectListItem }) {
  const favorite = useToggleFavorite();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        favorite.mutate(project.id);
      }}
      aria-label={project.isFavorite ? `Unpin ${project.name}` : `Pin ${project.name}`}
      aria-pressed={project.isFavorite}
      className="shrink-0 rounded-sm text-foreground-subtle transition-colors hover:text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Star className={cn("size-4", project.isFavorite && "fill-warning text-warning")} />
    </button>
  );
}

/** Name, code and lifecycle marker — the identity of the record. */
function ProjectIdentity({ project }: { project: ProjectListItem }) {
  return (
    <span className="block min-w-0">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* Never truncated to a stub: at 375px every name in this list clipped
            to 86px against a 106-177px need, so the list could not be scanned
            at all. It wraps instead. */}
        <span className="font-medium">{project.name}</span>
        {project.deletedAt && (
          <Badge variant="danger" className="shrink-0">
            Deleted
          </Badge>
        )}
        {project.archivedAt && !project.deletedAt && (
          <Badge variant="neutral" className="shrink-0">
            Archived
          </Badge>
        )}
      </span>
      <span className="font-mono text-xs text-foreground-subtle">{project.code}</span>
    </span>
  );
}

function DeadlineCell({ project }: { project: ProjectListItem }) {
  const cd = deadlineCountdown(project.expectedCompletionDate);
  return (
    <span
      className={cn(
        "whitespace-nowrap text-xs",
        cd.tone === "danger"
          ? "text-danger-foreground"
          : cd.tone === "warning"
            ? "text-warning-foreground"
            : "text-foreground-muted",
      )}
    >
      {cd.label}
    </span>
  );
}

function ManagerCell({ project }: { project: ProjectListItem }) {
  if (!project.pm) return <span className="text-xs text-foreground-subtle">Unassigned</span>;
  return (
    <span className="flex items-center gap-2">
      <Avatar className="size-6 shrink-0">
        <AvatarFallback className="text-[10px]">{initials(project.pm.fullName)}</AvatarFallback>
      </Avatar>
      <span className="truncate text-xs text-foreground-muted">{project.pm.fullName}</span>
    </span>
  );
}

export function ProjectsTable({ projects }: { projects: ProjectListItem[] }) {
  return (
    <DataTable
      caption="Projects"
      rows={projects}
      getRowKey={(p) => p.id}
      rowHref={(p) => `/projects/${p.id}`}
      virtualize={
        projects.length > 40
          ? { estimateRowHeight: 60, maxHeight: "calc(100vh - 22rem)" }
          : undefined
      }
      columns={[
        {
          key: "project",
          header: "Project",
          cell: (p) => <ProjectIdentity project={p} />,
        },
        {
          key: "pin",
          header: "Pin",
          headerHidden: true,
          cell: (p) => <FavoriteButton project={p} />,
        },
        {
          key: "stage",
          header: "Stage",
          cell: (p) => <StatusBadge meta={PROJECT_STAGE_META} value={p.stage} />,
        },
        {
          key: "tags",
          header: "Tags",
          hideBelow: "xl",
          cell: (p) =>
            p.tags.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {p.tags.slice(0, 2).map((t) => (
                  <TagChip key={t} label={t} />
                ))}
              </span>
            ) : (
              <span className="text-xs text-foreground-subtle">—</span>
            ),
        },
        {
          key: "budget",
          header: "Budget used",
          hideBelow: "lg",
          cell: (p) => (
            <span className="block w-36">
              <BudgetMeter usedPaise={p.usedPaise} budgetPaise={p.budgetPaise} />
              <span className="mt-1.5 block whitespace-nowrap font-mono text-xs text-foreground-muted">
                <MoneyText paise={p.usedPaise} compact /> /{" "}
                <MoneyText paise={p.budgetPaise} compact />
              </span>
            </span>
          ),
        },
        {
          key: "deadline",
          header: "Deadline",
          hideBelow: "md",
          cell: (p) => <DeadlineCell project={p} />,
        },
        {
          key: "pm",
          header: "Manager",
          hideBelow: "lg",
          cell: (p) => <ManagerCell project={p} />,
        },
        {
          key: "actions",
          header: "Actions",
          headerHidden: true,
          numeric: true,
          cell: (p) => <ProjectActionsMenu project={p} />,
        },
      ]}
      // A phone gets a purpose-built row, not the desktop grid with four columns
      // hidden: name and status first, then the signals that drive action.
      renderCard={(p) => (
        <div className="rounded-xl border border-border bg-surface p-3">
          <div className="flex items-start justify-between gap-2">
            <a
              href={`/projects/${p.id}`}
              className="min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ProjectIdentity project={p} />
            </a>
            <span className="flex shrink-0 items-center gap-1">
              <FavoriteButton project={p} />
              <ProjectActionsMenu project={p} />
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusBadge meta={PROJECT_STAGE_META} value={p.stage} />
            <DeadlineCell project={p} />
            {p.pm && (
              <span className="truncate text-xs text-foreground-muted">{p.pm.fullName}</span>
            )}
          </div>
          <div className="mt-2 whitespace-nowrap font-mono text-xs text-foreground-muted">
            <MoneyText paise={p.usedPaise} compact /> / <MoneyText paise={p.budgetPaise} compact />{" "}
            <span className="font-sans">used</span>
          </div>
          {p.startDate && (
            <p className="mt-1 text-xs text-foreground-subtle">Started {formatDate(p.startDate)}</p>
          )}
        </div>
      )}
    />
  );
}
